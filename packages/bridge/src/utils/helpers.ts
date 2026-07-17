import type { BridgeMessage, LogDestination, LogLevel } from "../types";

export type LogCallback = (
  level: LogLevel,
  message: unknown[],
  timestamp: number,
) => void;

export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function createMessage<T = unknown>(
  type: string,
  payload?: T,
  id?: string,
): BridgeMessage<T> {
  return {
    type,
    payload,
    id: id || generateMessageId(),
    timestamp: Date.now(),
    __nbridge: 1,
  };
}

export function isValidMessage(value: unknown): value is BridgeMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as BridgeMessage).type !== "string"
  ) {
    return false;
  }
  const id = (value as BridgeMessage).id;
  return id === undefined || typeof id === "string";
}

/**
 * Stricter check for postMessage-based transports (iframe/web): requires the
 * `__nbridge` discriminator so unrelated same-window `{ type: ... }` traffic
 * (devservers, analytics SDKs, extensions) is never dispatched into bridge
 * handlers. Native WebView transports keep the lenient `isValidMessage` for
 * backward compatibility with existing hosts.
 */
export function isBridgeEnvelope(value: unknown): value is BridgeMessage {
  return isValidMessage(value) && (value as BridgeMessage).__nbridge === 1;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error("Failed to stringify value:", error);
    return "{}";
  }
}

export function safeParse<T = unknown>(value: string | unknown): T | null {
  try {
    if (typeof value === "string") {
      return JSON.parse(value) as T;
    }
    return value as T;
  } catch (error) {
    console.error("Failed to parse value:", error);
    return null;
  }
}

export type SendBridgeMessageFn = (messageJson: string | BridgeMessage) => void;

export function attachSendBridgeMessageFnToWindow(
  onMessage: (message: BridgeMessage) => void,
  logger?: BridgeLogger,
): SendBridgeMessageFn {
  const existing = (window as unknown as Record<string, unknown>)
    .sendBridgeMessage;
  if (existing && typeof existing === "function") {
    logger?.warn(
      "[nbridge] window.sendBridgeMessage already exists; overwriting (previous bridge instance will stop receiving messages)",
    );
  }

  const fn = (messageJson: string | BridgeMessage) => {
    try {
      const message = safeParse<BridgeMessage>(messageJson);
      if (!message || !isValidMessage(message)) {
        logger?.warn("Invalid message:", messageJson);
        return;
      }
      onMessage(message);
    } catch (e) {
      logger?.error("Bridge receive error:", e);
    }
  };

  (window as unknown as Record<string, unknown>).sendBridgeMessage = fn;
  return fn;
}

export class BridgeLogger {
  private logCallback?: LogCallback;

  constructor(
    private debug: boolean,
    private logDestination: LogDestination = "devtools",
  ) {}

  setLogCallback(callback: LogCallback): void {
    this.logCallback = callback;
  }

  private route(level: LogLevel, ...args: unknown[]): void {
    const shouldLog = this.debug || level === "error"; // Always log errors
    if (!shouldLog) return;

    const timestamp = Date.now();
    const message = ["[Bridge]", ...args];

    switch (this.logDestination) {
      case "console":
        this.logToConsole(level, message);
        break;
      case "devtools":
        if (this.logCallback) {
          this.logCallback(level, message, timestamp);
        } else if (level === "error") {
          // No devtools collector registered (devTools disabled): errors must
          // still surface somewhere, otherwise the default config swallows
          // every failure the library catches.
          this.logToConsole(level, message);
        }
        break;
      case "both":
        this.logToConsole(level, message);
        if (this.logCallback) {
          this.logCallback(level, message, timestamp);
        }
        break;
      case "none":
        // Do nothing
        break;
    }
  }

  private logToConsole(level: LogLevel, message: unknown[]): void {
    switch (level) {
      case "log":
        console.log(...message);
        break;
      case "warn":
        console.warn(...message);
        break;
      case "error":
        console.error(...message);
        break;
      case "info":
        console.info(...message);
        break;
    }
  }

  log(...args: unknown[]): void {
    this.route("log", ...args);
  }

  warn(...args: unknown[]): void {
    this.route("warn", ...args);
  }

  error(...args: unknown[]): void {
    this.route("error", ...args);
  }

  info(...args: unknown[]): void {
    this.route("info", ...args);
  }
}
