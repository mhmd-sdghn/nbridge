/// <reference path="../types/window.d.ts" />
import type {
  BatchStats,
  BridgeConfig,
  BridgeMessage,
  BridgeMetrics,
  BridgeResponse,
  BridgeSendOptions,
  DevToolsConfig,
  DevToolsLog,
  DevToolsMessage,
  LogLevel,
  LogSource,
  QueueStats,
} from "../types";
import type { SchemaRegistry } from "../types/schema";
import { isProductionEnv } from "../utils/env";
import type { BridgeLogger } from "../utils/helpers";

type ConsoleMethod = "log" | "error" | "warn" | "info" | "debug";

/** Marker set on wrapped console methods so multiple bridge instances never stack interceptors. */
const INTERCEPTED = "__nbridge_devtools_intercepted__";

export class BridgeDevTools {
  private messages: DevToolsMessage[] = [];
  private logs: DevToolsLog[] = [];
  private enabled: boolean;
  private consoleIntercepted = false;
  private getMetrics?: () => BridgeMetrics | null;
  private getQueueStats?: () => QueueStats | null;
  private getBatchStats?: () => BatchStats | null;
  private getFullConfig?: () => BridgeConfig;
  private getSchemas?: () => SchemaRegistry | undefined;
  private sendFn?: (
    type: string,
    payload?: unknown,
    options?: BridgeSendOptions,
  ) => Promise<BridgeResponse>;
  private originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void>;

  constructor(
    private logger: BridgeLogger,
    private config: Required<DevToolsConfig>,
  ) {
    this.enabled = config.enabled;
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    if (this.enabled && typeof window !== "undefined") {
      if (isProductionEnv()) {
        // Don't patch console or collect logs in production builds — there
        // would be no inspection API to read them anyway.
        this.enabled = false;
        this.logger.warn(
          "BridgeDevTools: disabled in production builds. Build with NODE_ENV=development to enable.",
        );
        return;
      }
      this.initializeWindowAPI();
      this.interceptConsole();
      this.logger.info("DevTools enabled with console interception");
    }
  }

  /**
   * Toggle devtools collection at runtime. Disabling restores the console
   * and stops message/log collection; re-enabling re-intercepts.
   */
  public setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (enabled && isProductionEnv()) {
      this.logger.warn("BridgeDevTools: cannot enable in production builds");
      return;
    }

    this.enabled = enabled;
    if (enabled) {
      this.initializeWindowAPI();
      this.interceptConsole();
    } else {
      this.restoreConsole();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private initializeWindowAPI(): void {
    if (typeof window === "undefined") return;
    window.__BRIDGE_DEVTOOLS__ = {
      getMessages: () => this.getMessages(),
      getLogs: () => this.getLogs(),
      getMetrics: () => this.getMetricsInternal(),
      getQueueStats: () => this.getQueueStatsInternal(),
      getBatchStats: () => this.getBatchStatsInternal(),
      getConfig: () => this.getConfigInternal(),
      getSchemas: () => this.getSchemas?.(),
      send: (type, payload, options) => {
        if (!this.sendFn) {
          return Promise.reject(new Error("Send function not connected"));
        }
        return this.sendFn(type, payload, options);
      },
      clear: () => this.clear(),
      clearLogs: () => this.clearLogs(),
      setEnabled: (enabled: boolean) => this.setEnabled(enabled),
    };
  }

  private interceptConsole(): void {
    if (this.consoleIntercepted) return;

    const interceptMethod = (method: ConsoleMethod, level: LogLevel) => {
      const current = console[method] as ((...args: unknown[]) => void) & {
        [INTERCEPTED]?: boolean;
      };
      if (current[INTERCEPTED]) {
        // Another bridge instance already intercepts this method — don't
        // stack a second wrapper (it would duplicate every entry).
        return;
      }

      const wrapped = (...args: unknown[]) => {
        this.originalConsole[method](...args);
        if (this.enabled) {
          this.addLog(level, args, Date.now(), "console");
        }
      };
      (wrapped as { [INTERCEPTED]?: boolean })[INTERCEPTED] = true;
      console[method] = wrapped;
    };

    interceptMethod("log", "log");
    interceptMethod("error", "error");
    interceptMethod("warn", "warn");
    interceptMethod("info", "info");
    interceptMethod("debug", "log");
    this.consoleIntercepted = true;
  }

  private restoreConsole(): void {
    if (!this.consoleIntercepted) return;
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
    console.debug = this.originalConsole.debug;
    this.consoleIntercepted = false;
  }

  public setMetricsProvider(getMetrics: () => BridgeMetrics | null): void {
    this.getMetrics = getMetrics;
  }

  public setQueueStatsProvider(getQueueStats: () => QueueStats | null): void {
    this.getQueueStats = getQueueStats;
  }

  public setBatchStatsProvider(getBatchStats: () => BatchStats | null): void {
    this.getBatchStats = getBatchStats;
  }

  public setConfigProvider(getConfig: () => BridgeConfig): void {
    this.getFullConfig = getConfig;
  }

  public setSchemasProvider(
    getSchemas: () => SchemaRegistry | undefined,
  ): void {
    this.getSchemas = getSchemas;
  }

  public setSendFunction(
    send: (
      type: string,
      payload?: unknown,
      options?: BridgeSendOptions,
    ) => Promise<BridgeResponse>,
  ): void {
    this.sendFn = send;
  }

  public logSent(message: BridgeMessage): void {
    if (!this.enabled) return;

    this.logMessage(message, "sent");
  }

  public logReceived(message: BridgeMessage): void {
    if (!this.enabled) return;

    this.logMessage(message, "received");
  }

  private logMessage(
    message: BridgeMessage,
    direction: "sent" | "received",
  ): void {
    const devToolsMessage: DevToolsMessage = {
      ...message,
      __devtools: {
        direction,
        timestamp: Date.now(),
      },
    };

    this.messages.push(devToolsMessage);

    // Enforce max message history limit
    if (this.messages.length > this.config.maxMessageHistory) {
      this.messages.shift();
    }

    this.logger.log(`DevTools: ${direction} message`, message.type);
  }

  public getMessages(): DevToolsMessage[] {
    return [...this.messages];
  }

  public getMaxMessageHistory(): number {
    return this.config.maxMessageHistory;
  }

  public addLog(
    level: LogLevel,
    message: unknown[],
    timestamp: number,
    source: LogSource = "bridge",
  ): void {
    if (!this.enabled) return;

    const logEntry: DevToolsLog = {
      level,
      message,
      timestamp,
      source,
    };

    this.logs.push(logEntry);

    const maxConsoleLogEntries = this.config.maxConsoleLogEntries || 100;
    if (this.logs.length > maxConsoleLogEntries) {
      this.logs.shift();
    }
  }

  public getLogs(): DevToolsLog[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
    this.logger.info("DevTools: cleared log history");
  }

  private getMetricsInternal(): BridgeMetrics | null {
    return this.getMetrics?.() ?? null;
  }

  private getQueueStatsInternal(): QueueStats | null {
    return this.getQueueStats?.() ?? null;
  }

  private getBatchStatsInternal(): BatchStats | null {
    return this.getBatchStats?.() ?? null;
  }

  private getConfigInternal(): BridgeConfig {
    return this.getFullConfig?.() ?? {};
  }

  public clear(): void {
    this.messages = [];
    this.logger.info("DevTools: cleared message history");
  }

  public destroy(): void {
    this.clear();
    this.logs = [];
    this.restoreConsole();

    if (typeof window !== "undefined" && window.__BRIDGE_DEVTOOLS__) {
      delete window.__BRIDGE_DEVTOOLS__;
    }

    this.logger.info("DevTools destroyed");
  }
}
