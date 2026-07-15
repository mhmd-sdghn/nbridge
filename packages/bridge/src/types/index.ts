import type { MessagePriority } from "../constants/messagePriority";
import type {
  MessageTypes,
  PayloadFor,
  ResponseFor,
  SchemaRegistry,
} from "./schema";

/**
 * Platform types that the bridge can communicate with
 */
export type BridgePlatform = "android" | "ios" | "iframe" | "web";

/**
 * Message structure for bridge communication
 */
export interface BridgeMessage<T = unknown> {
  type: string;
  payload?: T;
  id?: string;
  timestamp?: number;
  /**
   * Protocol flag: payload is a compressed base64 string produced by the
   * sending side's CompressionManager. Set automatically — do not set by hand.
   */
  __compressed?: boolean;
}

/**
 * Response structure for bridge communication
 */
export interface BridgeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  id?: string;
}

/**
 * Handler function for incoming messages
 */
export type BridgeMessageHandler<T = unknown> = (
  payload: T,
  message: BridgeMessage<T>,
) => void | Promise<void>;

/**
 * Handler function with response capability
 */
export type BridgeMessageHandlerWithResponse<T = unknown, R = unknown> = (
  payload: T,
  message: BridgeMessage<T>,
) => R | Promise<R>;

/**
 * Subscription object returned when registering a handler
 */
export interface BridgeSubscription {
  unsubscribe: () => void;
}

/**
 * Options for sending messages
 */
export interface BridgeSendOptions {
  timeout?: number;
  expectResponse?: boolean;
  /**
   * Queue priority used when the message cannot be delivered immediately
   * (offline or adapter failure) and the offline queue is enabled.
   * @default "NORMAL"
   */
  priority?: "HIGH" | "NORMAL" | "LOW";
}

/**
 * Configuration for the bridge
 */
export interface BridgeConfig<
  TSchemas extends SchemaRegistry | undefined = undefined,
> {
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Default timeout for messages expecting responses (in ms)
   * @default 5000
   */
  defaultTimeout?: number;

  /**
   * Android WebView interface name
   * @default "AndroidBridge"
   */
  androidInterface?: string;

  /**
   * iOS WKWebView message handler name
   * @default "iosBridge"
   */
  iosHandler?: string;

  /**
   * Optional schema registry for type-safe messaging
   * When provided, enables auto-completion and runtime validation
   */
  schemas?: TSchemas;

  /**
   * Handshake configuration. When enabled, the bridge exchanges
   * handshake/ack messages with the other side and `isReady()` /
   * `waitForReady()` reflect a REAL connection instead of local init.
   * Requires the counterpart (native host or parent frame) to answer the
   * handshake — see docs for the native-side contract.
   */
  handshake?: HandshakeConfig;

  /**
   * Middleware configuration
   */
  middleware?: MiddlewareConfig;

  /**
   * Compression configuration
   */
  compression?: CompressionConfig;

  /**
   * Queue configuration
   */
  queue?: QueueConfig;

  /**
   * Batch configuration
   */
  batching?: BatchConfig;

  /**
   * Metrics configuration
   */
  metrics?: MetricsConfig;

  /**
   * DevTools configuration
   */
  devTools?: DevToolsConfig;

  /**
   * Enable message loopback in web environment (for testing)
   * @default false
   */
  webLoopback?: boolean;

  /**
   * Expected origin of the parent frame when running inside an iframe.
   * Used by IframeAdapter to restrict which origin messages are accepted from
   * and to set the targetOrigin when posting messages to the parent.
   * Omitting this falls back to source-only validation (window.parent check)
   * and wildcard send — configure this in production iframe deployments.
   */
  iframeParentOrigin?: string;
}

/**
 * Platform detection result
 */
export interface PlatformInfo {
  platform: BridgePlatform;
  isNative: boolean;
  userAgent: string;
}

/**
 * Next function type for middleware chain
 */
export type NextFunction = (message: BridgeMessage) => Promise<void>;

/**
 * Middleware context with additional information
 */
export interface MiddlewareContext {
  /** Direction of the message */
  direction: "outgoing" | "incoming";
  /** Timestamp when middleware execution started */
  timestamp: number;
  /** Bridge instance reference */
  bridge?: unknown;
}

/**
 * Middleware function type
 * Receives message, context, and next function
 * Can modify message, short-circuit chain, or call next()
 */
export type Middleware = (
  message: BridgeMessage,
  context: MiddlewareContext,
  next: NextFunction,
) => Promise<void>;

/**
 * Bridge manager interface
 */
export interface IBridgeManager {
  /**
   * Get current platform information
   */
  getPlatform(): PlatformInfo;

  /**
   * Send a message to the native platform
   */
  send<T = unknown>(
    type: string,
    payload?: T,
    options?: BridgeSendOptions,
  ): Promise<BridgeResponse>;

  /**
   * Send a message and wait for response
   */
  sendWithResponse<T = unknown, R = unknown>(
    type: string,
    payload?: T,
    timeout?: number,
  ): Promise<R>;

  /**
   * Register a handler for a specific message type
   */
  on<T = unknown>(
    type: string,
    handler: BridgeMessageHandler<T>,
  ): BridgeSubscription;

  /**
   * Register a handler that can send responses
   */
  onWithResponse<T = unknown, R = unknown>(
    type: string,
    handler: BridgeMessageHandlerWithResponse<T, R>,
  ): BridgeSubscription;

  /**
   * Remove a specific handler
   */
  off<T = unknown>(type: string, handler?: BridgeMessageHandler<T>): void;

  /**
   * Remove all handlers for a message type
   */
  removeAllListeners(type?: string): void;

  /**
   * Check if the bridge is ready
   */
  isReady(): boolean;

  /**
   * Wait for the bridge to be ready
   */
  waitForReady(timeout?: number): Promise<void>;

  /**
   * Destroy the bridge and clean up resources
   */
  destroy(): void;
}

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  /** Enable middleware system (default: true) */
  enabled: boolean;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  enabled: boolean;
  maxSize: number;
  persist: boolean;
  storageKey: string;
  autoFlush: boolean;
  flushInterval: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  size: number;
  pending: number;
  failed: number;
  completed: number;
}

/**
 * Queued message with metadata
 */
export interface QueuedMessage {
  message: BridgeMessage;
  retries: number;
  priority: MessagePriority;
  options?: BridgeSendOptions;
  timestamp?: number;
  attempts?: number;
}

/**
 * Handshake configuration
 */
export interface HandshakeConfig {
  /**
   * Enable the handshake protocol. Off by default for compatibility with
   * native hosts that don't implement it; when off, the bridge reports
   * ready as soon as local initialization completes (legacy behavior).
   * @default false
   */
  enabled: boolean;
  /**
   * How long to keep retrying the handshake before waitForReady() rejects.
   * @default 10000
   */
  timeout?: number;
  /**
   * Interval between handshake retries while unacknowledged.
   * @default 500
   */
  retryInterval?: number;
}

/**
 * Batch configuration
 */
export interface BatchConfig {
  enabled: boolean;
  maxSize: number;
  maxWait: number;
}

/**
 * Batch statistics
 */
export interface BatchStats {
  pending: number;
  sent: number;
  failed: number;
  totalBatches: number;
}

/**
 * Batched message
 */
export interface BatchedMessage {
  type: string;
  payload?: unknown;
  messages?: Array<{ type: string; payload?: unknown }>;
  batchId?: string;
  timestamp?: number;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  enabled: boolean;
  updateInterval: number;
  detailedTiming: boolean;
}

/**
 * Bridge metrics
 */
export interface BridgeMetrics {
  messagesSent: number;
  messagesReceived: number;
  messagesFailed: number;
  timeouts: number;
  averageResponseTime: number;
  successRate: number;
  messagesPerSecond: number;
  peakMessagesPerSecond: number;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * Metrics listener
 */
export type MetricsListener = (metrics: BridgeMetrics) => void;

/**
 * Compression configuration
 */
export interface CompressionConfig {
  enabled: boolean;
  algorithm: "gzip" | "deflate" | "br";
  threshold: number;
  trackStats?: boolean;
}

/**
 * Compression statistics
 */
export interface CompressionStats {
  totalCompressed: number;
  bytesBeforeCompression: number;
  bytesAfterCompression: number;
  averageCompressionRatio: number;
}

/**
 * Log destination options
 */
export type LogDestination = "console" | "devtools" | "both" | "none";

/**
 * Log level types
 */
export type LogLevel = "log" | "warn" | "error" | "info";

/**
 * Log source type
 */
export type LogSource = "bridge" | "console";

/**
 * DevTools log entry
 */
export interface DevToolsLog {
  level: LogLevel;
  message: unknown[];
  timestamp: number;
  source: LogSource;
}

/**
 * DevTools configuration
 */
export interface DevToolsConfig {
  enabled: boolean;
  /**
   * Maximum number of bridge messages to keep in history
   * @default 50
   */
  maxMessageHistory: number;
  /**
   * Where to output logs
   * - "console": Only browser console
   * - "devtools": Only DevTools logs tab
   * - "both": Both console and DevTools
   * - "none": Disable logging
   * @default "devtools"
   */
  logDestination?: LogDestination;
  /**
   * Maximum number of console log entries to keep in DevTools
   * @default 100
   */
  maxConsoleLogEntries?: number;
}

/**
 * DevTools message
 */
export interface DevToolsMessage extends BridgeMessage {
  __devtools: {
    direction: "sent" | "received";
    timestamp: number;
  };
}

/**
 * Schema-related conditional types for optional type safety
 */

/**
 * Conditional event type - string if no schemas, MessageTypes if schemas provided
 */
export type EventType<TSchemas extends SchemaRegistry | undefined> =
  TSchemas extends SchemaRegistry ? MessageTypes<TSchemas> : string;

/**
 * Conditional payload type - unknown if no schemas, typed if schemas provided
 */
export type PayloadType<
  TSchemas extends SchemaRegistry | undefined,
  TEventType extends string,
> = TSchemas extends SchemaRegistry
  ? TEventType extends MessageTypes<TSchemas>
    ? PayloadFor<TSchemas, TEventType>
    : never
  : unknown;

/**
 * Conditional response type - unknown if no schemas, typed if schemas provided
 */
export type ResponseType<
  TSchemas extends SchemaRegistry | undefined,
  TEventType extends string,
> = TSchemas extends SchemaRegistry
  ? TEventType extends MessageTypes<TSchemas>
    ? ResponseFor<TSchemas, TEventType>
    : never
  : unknown;
