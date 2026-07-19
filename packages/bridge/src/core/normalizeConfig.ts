import type {
  BatchConfig,
  BridgeConfig,
  CompressionConfig,
  DevToolsConfig,
  HandshakeConfig,
  MetricsConfig,
  MiddlewareConfig,
  QueueConfig,
} from "../types";
import type { SchemaRegistry } from "../types/schema";

/** Shared timing defaults referenced from multiple modules. */
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10000;
export const DEFAULT_HANDSHAKE_RETRY_MS = 500;
export const DEFAULT_READY_TIMEOUT_MS = 10000;
export const DEFAULT_QUEUE_MAX_RETRIES = 3;

export type ResolvedQueueConfig = Required<QueueConfig>;
export type ResolvedBatchConfig = Required<BatchConfig>;
export type ResolvedMetricsConfig = Required<MetricsConfig>;
export type ResolvedCompressionConfig = Required<CompressionConfig>;
export type ResolvedDevToolsConfig = Required<DevToolsConfig>;
export type ResolvedHandshakeConfig = Required<HandshakeConfig>;
export type ResolvedMiddlewareConfig = Required<MiddlewareConfig>;

/**
 * Fully-resolved bridge configuration: every field present, every sub-config
 * merged field-by-field with the documented defaults. `iframeParentOrigin`
 * stays optional by design (absence means "not configured").
 */
export interface ResolvedBridgeConfig<
  TSchemas extends SchemaRegistry | undefined = undefined,
> {
  debug: boolean;
  defaultTimeout: number;
  androidInterface: string;
  iosHandler: string;
  schemas: TSchemas;
  handshake: ResolvedHandshakeConfig;
  middleware: ResolvedMiddlewareConfig;
  compression: ResolvedCompressionConfig;
  queue: ResolvedQueueConfig;
  batching: ResolvedBatchConfig;
  metrics: ResolvedMetricsConfig;
  devTools: ResolvedDevToolsConfig;
  webLoopback: boolean;
  iframeParentOrigin: string | undefined;
}

/**
 * Normalize a user-supplied BridgeConfig into a fully-resolved config.
 * Every sub-config is merged field-by-field so `{ enabled: true }` gets the
 * documented defaults for everything else.
 */
export function normalizeConfig<
  TSchemas extends SchemaRegistry | undefined = undefined,
>(config: BridgeConfig<TSchemas> = {}): ResolvedBridgeConfig<TSchemas> {
  return {
    debug: config.debug ?? false,
    defaultTimeout: config.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
    androidInterface: config.androidInterface ?? "AndroidBridge",
    iosHandler: config.iosHandler ?? "iosBridge",
    schemas: config.schemas as TSchemas,
    handshake: {
      enabled: config.handshake?.enabled ?? false,
      timeout: config.handshake?.timeout ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
      retryInterval:
        config.handshake?.retryInterval ?? DEFAULT_HANDSHAKE_RETRY_MS,
    },
    middleware: {
      enabled: config.middleware?.enabled ?? true,
    },
    compression: {
      enabled: config.compression?.enabled ?? false,
      threshold: config.compression?.threshold ?? 1024,
      trackStats: config.compression?.trackStats ?? true,
    },
    queue: {
      enabled: config.queue?.enabled ?? false,
      maxSize: config.queue?.maxSize ?? 100,
      persist: config.queue?.persist ?? false,
      storageKey: config.queue?.storageKey ?? "nbridge-queue",
      autoFlush: config.queue?.autoFlush ?? true,
      flushInterval: config.queue?.flushInterval ?? 5000,
      maxRetries: config.queue?.maxRetries ?? DEFAULT_QUEUE_MAX_RETRIES,
    },
    batching: {
      enabled: config.batching?.enabled ?? false,
      maxSize: config.batching?.maxSize ?? 10,
      maxWait: config.batching?.maxWait ?? 100,
    },
    metrics: {
      enabled: config.metrics?.enabled ?? false,
      updateInterval: config.metrics?.updateInterval ?? 1000,
      detailedTiming: config.metrics?.detailedTiming ?? false,
    },
    devTools: {
      enabled: config.devTools?.enabled ?? false,
      maxMessageHistory: config.devTools?.maxMessageHistory ?? 50,
      logDestination: config.devTools?.logDestination ?? "devtools",
      maxConsoleLogEntries: config.devTools?.maxConsoleLogEntries ?? 100,
    },
    webLoopback: config.webLoopback ?? false,
    iframeParentOrigin: config.iframeParentOrigin,
  };
}
