import { isProtocolType, PROTOCOL } from "../constants/protocol";
import type {
  BatchStats,
  BridgeConfig,
  BridgeMessage,
  BridgeMessageHandler,
  BridgeMessageHandlerWithResponse,
  BridgeMetrics,
  BridgeResponse,
  BridgeSendOptions,
  BridgeSubscription,
  CompressionStats,
  IBridgeManager,
  MetricsListener,
  Middleware,
  PlatformInfo,
  QueueStats,
} from "../types";
import { MessagePriority } from "../types";
import type {
  MessageTypes,
  PayloadFor,
  ResponseFor,
  SchemaRegistry,
} from "../types/schema";
import {
  BridgeLogger,
  createMessage,
  isValidMessage,
  safeStringify,
} from "../utils/helpers";
import type { IPlatformAdapter } from "./adapters";
import { BatchManager } from "./BatchManager";
import { BridgeDevTools } from "./BridgeDevTools";
import { CompressionManager } from "./CompressionManager";
import { MessageHandler } from "./MessageHandler";
import { MessageQueue } from "./MessageQueue";
import { MetricsCollector } from "./MetricsCollector";
import { MiddlewareManager } from "./MiddlewareManager";
import { PlatformDetector } from "./PlatformDetector";
import { ResponseManager } from "./ResponseManager";
import { validateWithSchema } from "./validate";

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function wireSize(message: BridgeMessage): number {
  return new TextEncoder().encode(safeStringify(message)).length;
}

export class BridgeManager<
  TSchemas extends SchemaRegistry | undefined = undefined,
> implements IBridgeManager
{
  private adapter: IPlatformAdapter;
  private messageHandler: MessageHandler;
  private responseManager: ResponseManager;
  private middlewareManager: MiddlewareManager;
  /**
   * Always constructed so that INCOMING compressed payloads can be
   * decompressed even when outgoing compression is disabled locally.
   */
  private readonly compressionManager: CompressionManager;
  private readonly messageQueue: MessageQueue | null = null;
  private readonly batchManager: BatchManager | null = null;
  private readonly metricsCollector: MetricsCollector | null = null;
  private readonly devTools: BridgeDevTools | null = null;
  private platformDetector: PlatformDetector;
  private readonly logger: BridgeLogger;
  private config: Required<BridgeConfig<TSchemas>>;
  private readonly schemas?: TSchemas;

  private ready = false;
  private destroyed = false;
  private readyError: Error | null = null;
  private readyWaiters: ReadyWaiter[] = [];
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineListener: (() => void) | null = null;

  constructor(config: BridgeConfig<TSchemas> = {}) {
    this.schemas = config.schemas;

    this.config = {
      debug: config.debug ?? false,
      defaultTimeout: config.defaultTimeout ?? 5000,
      androidInterface: config.androidInterface ?? "AndroidBridge",
      iosHandler: config.iosHandler ?? "iosBridge",
      schemas: config.schemas as TSchemas,
      handshake: {
        enabled: config.handshake?.enabled ?? false,
        timeout: config.handshake?.timeout ?? 10000,
        retryInterval: config.handshake?.retryInterval ?? 500,
      },
      middleware: config.middleware ?? { enabled: true },
      compression: {
        enabled: config.compression?.enabled ?? false,
        algorithm: config.compression?.algorithm ?? "deflate",
        threshold: config.compression?.threshold ?? 1024,
        trackStats: config.compression?.trackStats ?? true,
      },
      queue: config.queue ?? {
        enabled: false,
        maxSize: 100,
        persist: false,
        storageKey: "nbridge-queue",
        autoFlush: true,
        flushInterval: 5000,
      },
      batching: config.batching ?? {
        enabled: false,
        maxSize: 10,
        maxWait: 100,
      },
      metrics: config.metrics ?? {
        enabled: false,
        updateInterval: 1000,
        detailedTiming: false,
      },
      devTools: config.devTools ?? {
        enabled: false,
        maxMessageHistory: 50,
        logDestination: "devtools",
        maxConsoleLogEntries: 100,
      },
      webLoopback: config.webLoopback ?? false,
      // intentionally undefined when not configured; IframeAdapter handles this
      iframeParentOrigin: config.iframeParentOrigin as string,
    };

    const logDestination = this.config.devTools.logDestination || "devtools";
    this.logger = new BridgeLogger(this.config.debug, logDestination);
    this.messageHandler = new MessageHandler(this.logger);
    this.responseManager = new ResponseManager(
      this.logger,
      this.config.defaultTimeout,
    );
    this.middlewareManager = new MiddlewareManager(this.logger);

    this.compressionManager = new CompressionManager(
      this.logger,
      this.config.compression as Required<typeof this.config.compression>,
    );

    if (this.config.queue.enabled) {
      this.messageQueue = new MessageQueue(
        this.logger,
        this.config.queue as Required<typeof this.config.queue>,
      );
    }

    if (this.config.batching.enabled) {
      this.batchManager = new BatchManager(
        this.logger,
        this.config.batching as Required<typeof this.config.batching>,
      );
      this.batchManager.setFlushCallback(async (batch) => {
        await this.sendOutgoing(batch);
      });
    }

    if (this.config.metrics.enabled) {
      this.metricsCollector = new MetricsCollector(
        this.logger,
        this.config.metrics as Required<typeof this.config.metrics>,
      );
    }

    if (this.config.devTools.enabled) {
      this.devTools = new BridgeDevTools(
        this.logger,
        this.config.devTools as Required<typeof this.config.devTools>,
      );

      this.logger.setLogCallback((level, message, timestamp) => {
        this.devTools?.addLog(level, message, timestamp);
      });

      if (this.metricsCollector) {
        const metricsCollector = this.metricsCollector;
        this.devTools.setMetricsProvider(() => metricsCollector.getMetrics());
      }

      if (this.messageQueue) {
        const messageQueue = this.messageQueue;
        this.devTools.setQueueStatsProvider(() => messageQueue.getStats());
      }

      if (this.batchManager) {
        const batchManager = this.batchManager;
        this.devTools.setBatchStatsProvider(() => batchManager.getStats());
      }

      this.devTools.setConfigProvider(() => this.config as BridgeConfig);
      this.devTools.setSchemasProvider(
        () => this.schemas as SchemaRegistry | undefined,
      );
      this.devTools.setSendFunction((type, payload, options) =>
        this.send(type, payload, options),
      );
    }

    if (this.metricsCollector) {
      const collector = this.metricsCollector;
      this.responseManager.setTimeoutCallback((id) =>
        collector.recordTimeout(id),
      );
    }

    if (this.messageQueue) {
      const queue = this.messageQueue;
      queue.setFlushCallback(() => this.flushQueue());
    }

    this.platformDetector = new PlatformDetector(
      this.config.androidInterface,
      this.config.iosHandler,
      this.config.webLoopback,
      this.logger,
      config.iframeParentOrigin,
    );

    this.adapter = this.platformDetector.createAdapter();

    this.initialize();
  }

  private initialize(): void {
    if (typeof window === "undefined") {
      this.logger.warn("Window is undefined, bridge not available");
      return;
    }

    this.logger.info(
      `Initializing bridge for platform: ${this.adapter.getPlatformType()}`,
    );

    this.adapter.initialize((message) => {
      this.handleIncomingMessage(message).catch((error) => {
        this.logger.error("Failed to process incoming message:", error);
      });
    });

    if (this.messageQueue) {
      this.onlineListener = () => {
        this.logger.info("Back online — flushing queued messages");
        this.flushQueue().catch((error) => {
          this.logger.error("Queue flush after reconnect failed:", error);
        });
      };
      window.addEventListener("online", this.onlineListener);
    }

    if (this.config.handshake.enabled) {
      this.startHandshake();
    } else {
      this.markReady();
      this.logger.info("Bridge initialized (handshake disabled)");
    }
  }

  // ── Readiness / handshake ─────────────────────────────────────────────────

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.readyWaiters = [];
  }

  private failReady(error: Error): void {
    this.readyError = error;
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.readyWaiters = [];
  }

  private startHandshake(): void {
    const { timeout = 10000, retryInterval = 500 } = this.config.handshake;
    const startedAt = Date.now();

    const attempt = () => {
      if (this.ready || this.destroyed) return;

      if (Date.now() - startedAt >= timeout) {
        this.logger.error(`Handshake timed out after ${timeout}ms`);
        this.failReady(
          new Error(
            `nBridge handshake timed out after ${timeout}ms — is the native side listening?`,
          ),
        );
        return;
      }

      try {
        this.adapter.send(createMessage(PROTOCOL.HANDSHAKE));
      } catch (error) {
        this.logger.log("Handshake attempt failed, will retry:", error);
      }

      this.handshakeTimer = setTimeout(attempt, retryInterval);
    };

    attempt();
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async waitForReady(timeout = 10000): Promise<void> {
    if (this.ready) return;
    if (this.readyError) throw this.readyError;
    if (this.destroyed) throw new Error("Bridge destroyed");

    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
          reject(new Error("Bridge initialization timed out"));
        }, timeout),
      };
      this.readyWaiters.push(waiter);
    });
  }

  // ── Incoming pipeline ─────────────────────────────────────────────────────

  private async handleIncomingMessage(message: BridgeMessage): Promise<void> {
    // Protocol messages are handled before middleware and never dispatched.
    if (message.type === PROTOCOL.HANDSHAKE) {
      try {
        this.adapter.send(createMessage(PROTOCOL.HANDSHAKE_ACK));
      } catch (error) {
        this.logger.error("Failed to acknowledge handshake:", error);
      }
      this.markReady();
      return;
    }
    if (message.type === PROTOCOL.HANDSHAKE_ACK) {
      this.markReady();
      return;
    }

    this.logger.log("Received message:", message);
    this.devTools?.logReceived(message);
    this.metricsCollector?.recordReceived(
      message.id ?? message.type,
      wireSize(message),
    );

    let incoming = message;
    if (incoming.__compressed && typeof incoming.payload === "string") {
      const payload = this.compressionManager.decompress(incoming.payload);
      incoming = { ...incoming, payload, __compressed: undefined };
    }

    if (this.config.middleware?.enabled) {
      await this.middlewareManager.executeIncoming(
        incoming,
        async (processedMessage) => {
          await this.processIncomingMessage(processedMessage);
        },
        this,
      );
    } else {
      await this.processIncomingMessage(incoming);
    }
  }

  private async processIncomingMessage(message: BridgeMessage): Promise<void> {
    if (message.type === PROTOCOL.BATCH) {
      const entries = (message.payload as { messages?: BridgeMessage[] })
        ?.messages;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (isValidMessage(entry)) {
            await this.processIncomingMessage(entry);
          }
        }
      }
      return;
    }

    const isResponse =
      message.type.endsWith("_response") || message.type.endsWith("_error");

    if (isResponse && message.id && this.responseManager.has(message.id)) {
      this.responseManager.resolve(message.id, message.payload);
      return;
    }
    await this.messageHandler.dispatch(message);
  }

  public getPlatform(): PlatformInfo {
    return this.platformDetector.getPlatformInfo();
  }

  // ── Outgoing pipeline ─────────────────────────────────────────────────────

  /**
   * Send a message to the platform (typed version when schemas provided)
   */
  public async send<
    K extends TSchemas extends SchemaRegistry ? MessageTypes<TSchemas> : never,
  >(
    type: K,
    payload: TSchemas extends SchemaRegistry ? PayloadFor<TSchemas, K> : never,
    options?: BridgeSendOptions,
  ): Promise<BridgeResponse>;

  /**
   * Send a message to the platform (untyped version for fallback)
   */
  public async send<T = unknown>(
    type: string,
    payload?: T,
    options?: BridgeSendOptions,
  ): Promise<BridgeResponse>;

  /**
   * Send a message to the platform (implementation)
   */
  public async send<T = unknown>(
    type: string,
    payload?: T,
    options: BridgeSendOptions = {},
  ): Promise<BridgeResponse> {
    let outgoingPayload: unknown = payload;

    if (this.schemas && type in this.schemas) {
      const schema = this.schemas[type];
      if (schema?.payloadSchema) {
        outgoingPayload = await validateWithSchema(
          schema.payloadSchema,
          payload,
          type,
          "payload",
        );
      }
    }

    const message = createMessage(type, outgoingPayload);

    if (options.expectResponse) {
      const timeout = options.timeout ?? this.config.defaultTimeout;

      if (!message.id) {
        throw new Error(
          `Cannot await response for "${type}": message has no ID`,
        );
      }

      const responsePromise = this.responseManager.register(
        message.id,
        timeout,
      );

      try {
        await this.sendOutgoing(message, options);
      } catch (error) {
        this.responseManager.reject(
          message.id,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }

      return responsePromise;
    }

    // Fire-and-forget messages are batchable.
    if (this.batchManager && !isProtocolType(type)) {
      this.batchManager.add(message);
      return { success: true, id: message.id };
    }

    await this.sendOutgoing(message, options);
    return {
      success: true,
      id: message.id,
    };
  }

  /**
   * Send message and wait for response (typed version)
   */
  public async sendWithResponse<
    K extends TSchemas extends SchemaRegistry ? MessageTypes<TSchemas> : never,
  >(
    type: K,
    payload: TSchemas extends SchemaRegistry ? PayloadFor<TSchemas, K> : never,
    timeout?: number,
  ): Promise<
    TSchemas extends SchemaRegistry ? ResponseFor<TSchemas, K> : unknown
  >;

  /**
   * Send message and wait for response (untyped version)
   */
  public async sendWithResponse<T = unknown, R = unknown>(
    type: string,
    payload?: T,
    timeout?: number,
  ): Promise<R>;

  /**
   * Send message and wait for response (implementation)
   */
  public async sendWithResponse<T = unknown, R = unknown>(
    type: string,
    payload?: T,
    timeout?: number,
  ): Promise<R> {
    const response = await this.send(type, payload, {
      expectResponse: true,
      timeout,
    });

    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }

    let data = response.data as R;

    if (this.schemas && type in this.schemas) {
      const schema = this.schemas[type];
      if (schema?.responseSchema) {
        data = (await validateWithSchema(
          schema.responseSchema,
          data,
          type,
          "response",
        )) as R;
      }
    }

    return data;
  }

  /**
   * Runs the outgoing middleware chain, then hands off to the adapter.
   * On adapter failure (or while offline) the message is parked in the
   * offline queue when one is configured; otherwise the error propagates.
   */
  private async sendOutgoing(
    message: BridgeMessage,
    options?: BridgeSendOptions,
  ): Promise<void> {
    if (
      this.messageQueue &&
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      !isProtocolType(message.type)
    ) {
      this.enqueue(message, options);
      return;
    }

    try {
      if (this.config.middleware?.enabled) {
        await this.middlewareManager.executeOutgoing(
          message,
          async (processedMessage) => {
            this.sendMessageToAdapter(processedMessage);
          },
          this,
        );
      } else {
        this.sendMessageToAdapter(message);
      }
    } catch (error) {
      this.metricsCollector?.recordFailed(message.id ?? message.type);

      if (this.messageQueue && !isProtocolType(message.type)) {
        this.logger.warn(
          `Send failed for "${message.type}" — queued for retry`,
        );
        this.enqueue(message, options);
        return;
      }

      throw error;
    }
  }

  private enqueue(message: BridgeMessage, options?: BridgeSendOptions): void {
    const priority =
      options?.priority === "HIGH"
        ? MessagePriority.HIGH
        : options?.priority === "LOW"
          ? MessagePriority.LOW
          : MessagePriority.NORMAL;
    this.messageQueue?.enqueue(message, options, priority);
  }

  private sendMessageToAdapter(message: BridgeMessage): void {
    const wireMessage = this.maybeCompress(message);
    try {
      this.adapter.send(wireMessage);
      this.logger.log("Sent message:", wireMessage);
      this.devTools?.logSent(wireMessage);
      this.metricsCollector?.recordSent(
        message.id ?? message.type,
        wireSize(wireMessage),
      );
    } catch (error) {
      this.logger.error("Failed to send message:", error);
      throw error;
    }
  }

  private maybeCompress(message: BridgeMessage): BridgeMessage {
    if (
      !this.config.compression.enabled ||
      message.payload === undefined ||
      message.__compressed
    ) {
      return message;
    }

    const compressed = this.compressionManager.compress(message.payload);
    if (compressed === null) {
      return message;
    }

    return { ...message, payload: compressed, __compressed: true };
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Register message handler (typed version)
   */
  public on<
    K extends TSchemas extends SchemaRegistry ? MessageTypes<TSchemas> : never,
  >(
    type: K,
    handler: BridgeMessageHandler<
      TSchemas extends SchemaRegistry ? PayloadFor<TSchemas, K> : never
    >,
  ): BridgeSubscription;

  /**
   * Register message handler (untyped version)
   */
  public on<T = unknown>(
    type: string,
    handler: BridgeMessageHandler<T>,
  ): BridgeSubscription;

  /**
   * Register message handler (implementation)
   */
  public on<T = unknown>(
    type: string,
    handler: BridgeMessageHandler<T>,
  ): BridgeSubscription {
    return this.messageHandler.register(type, handler);
  }

  /**
   * Register handler with response capability (typed version)
   */
  public onWithResponse<
    K extends TSchemas extends SchemaRegistry ? MessageTypes<TSchemas> : never,
  >(
    type: K,
    handler: BridgeMessageHandlerWithResponse<
      TSchemas extends SchemaRegistry ? PayloadFor<TSchemas, K> : never,
      TSchemas extends SchemaRegistry ? ResponseFor<TSchemas, K> : unknown
    >,
  ): BridgeSubscription;

  /**
   * Register handler with response capability (untyped version)
   */
  public onWithResponse<T = unknown, R = unknown>(
    type: string,
    handler: BridgeMessageHandlerWithResponse<T, R>,
  ): BridgeSubscription;

  /**
   * Register handler with response capability (implementation)
   */
  public onWithResponse<T = unknown, R = unknown>(
    type: string,
    handler: BridgeMessageHandlerWithResponse<T, R>,
  ): BridgeSubscription {
    const wrappedHandler: BridgeMessageHandler<T> = async (
      payload,
      message,
    ) => {
      try {
        const result = await handler(payload, message);

        if (message.id) {
          const responseMessage = createMessage(
            `${type}_response`,
            result,
            message.id,
          );
          await this.sendOutgoing(responseMessage);
        }
      } catch (error) {
        this.logger.error(`Error in handler for "${type}":`, error);

        if (message.id) {
          const errorMessage = createMessage(
            `${type}_error`,
            {
              error: error instanceof Error ? error.message : "Unknown error",
            },
            message.id,
          );
          await this.sendOutgoing(errorMessage);
        }
      }
    };

    return this.messageHandler.register(type, wrappedHandler);
  }

  // biome-ignore lint/suspicious/noExplicitAny: Need to accept handlers of different types
  public off(type: string, handler?: BridgeMessageHandler<any>): void {
    this.messageHandler.unregister(type, handler);
  }

  public removeAllListeners(type?: string): void {
    this.messageHandler.clear(type);
  }

  // ── Middleware ────────────────────────────────────────────────────────────

  public use(middleware: Middleware): void {
    this.middlewareManager.use(middleware);
  }

  public addMiddleware(middleware: Middleware): void {
    this.use(middleware);
  }

  public getMiddlewareCount(): number {
    return this.middlewareManager.count();
  }

  // ── Feature accessors ─────────────────────────────────────────────────────

  public getCompressionStats(): CompressionStats | null {
    return this.config.compression.enabled
      ? this.compressionManager.getStats()
      : null;
  }

  public isCompressionEnabled(): boolean {
    return this.config.compression.enabled;
  }

  public getQueueStats(): QueueStats | null {
    return this.messageQueue?.getStats() ?? null;
  }

  public async flushQueue(): Promise<void> {
    if (this.messageQueue) {
      await this.messageQueue.flush(async (message) => {
        // Queued messages already passed validation and middleware once;
        // deliver them straight to the adapter so a middleware chain that
        // stamps metadata does not run twice.
        this.sendMessageToAdapter(message);
      });
    }
  }

  public clearQueue(): void {
    this.messageQueue?.clear();
  }

  public getBatchStats(): BatchStats | null {
    return this.batchManager?.getStats() ?? null;
  }

  /**
   * Flush any pending batched messages to the wire immediately.
   */
  public async batch(): Promise<void> {
    this.batchManager?.flush();
  }

  public getMetrics(): BridgeMetrics | null {
    return this.metricsCollector?.getMetrics() ?? null;
  }

  public onMetricsUpdate(listener: MetricsListener): () => void {
    if (this.metricsCollector) {
      this.metricsCollector.addListener(listener);
      return () => this.metricsCollector?.removeListener(listener);
    }
    return () => {};
  }

  public isDevToolsEnabled(): boolean {
    return this.devTools !== null;
  }

  public getDevTools(): BridgeDevTools | null {
    return this.devTools;
  }

  // ── Schemas ───────────────────────────────────────────────────────────────

  public getSchema<K extends string>(type: K) {
    if (this.schemas && type in this.schemas) {
      return this.schemas[type];
    }
    return null;
  }

  public hasSchemas(): boolean {
    return this.schemas !== undefined && this.schemas !== null;
  }

  public getAllSchemas() {
    return this.schemas;
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  /**
   * Log a message to DevTools/console (based on logDestination config)
   */
  public log(...args: unknown[]): void {
    this.logger.log(...args);
  }

  /**
   * Log a warning to DevTools/console (based on logDestination config)
   */
  public warn(...args: unknown[]): void {
    this.logger.warn(...args);
  }

  /**
   * Log an error to DevTools/console (based on logDestination config)
   */
  public error(...args: unknown[]): void {
    this.logger.error(...args);
  }

  /**
   * Log an info message to DevTools/console (based on logDestination config)
   */
  public info(...args: unknown[]): void {
    this.logger.info(...args);
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  public destroy(): void {
    this.logger.info("Destroying bridge");

    this.destroyed = true;

    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }

    if (this.onlineListener && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }

    this.failReady(new Error("Bridge destroyed"));

    this.adapter.destroy();

    this.messageHandler.clear();
    this.responseManager.clear();
    this.middlewareManager.clear();

    this.compressionManager.destroy();
    this.messageQueue?.destroy();
    this.batchManager?.destroy();
    this.metricsCollector?.destroy();
    this.devTools?.destroy();

    this.ready = false;

    this.logger.info("Bridge destroyed");
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Global instance needs to accept any schema type
let bridgeInstance: BridgeManager<any> | null = null;

export function getBridge<
  TSchemas extends SchemaRegistry | undefined = undefined,
>(config?: BridgeConfig<TSchemas>): BridgeManager<TSchemas> {
  if (!bridgeInstance) {
    bridgeInstance = new BridgeManager(config);
  }
  return bridgeInstance as BridgeManager<TSchemas>;
}

export function createBridge<
  TSchemas extends SchemaRegistry | undefined = undefined,
>(config?: BridgeConfig<TSchemas>): BridgeManager<TSchemas> {
  return new BridgeManager(config);
}
