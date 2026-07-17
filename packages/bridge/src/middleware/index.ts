/**
 * Built-in middleware utilities
 * Pre-built middleware for common use cases
 */

import type { BridgeMessage, Middleware } from "../types";

/**
 * Logging middleware
 * Logs all incoming and outgoing messages
 */
export function loggingMiddleware(prefix = "Bridge"): Middleware {
  return async (message, context, next) => {
    console.log(
      `[${prefix}] ${context.direction.toUpperCase()} - ${message.type}`,
      message,
    );
    await next(message);
  };
}

/**
 * Timing middleware
 * Measures and logs execution time for messages
 */
export function timingMiddleware(
  onTiming?: (type: string, duration: number, direction: string) => void,
): Middleware {
  return async (message, context, next) => {
    const start = performance.now();
    await next(message);
    const duration = performance.now() - start;

    if (onTiming) {
      onTiming(message.type, duration, context.direction);
    } else {
      console.log(
        `[Timing] ${context.direction} ${message.type}: ${duration.toFixed(2)}ms`,
      );
    }
  };
}

/**
 * Validation middleware
 * Validates messages before they are sent/received
 */
export function validationMiddleware(
  validator: (message: BridgeMessage) => boolean | string,
): Middleware {
  return async (message, _context, next) => {
    const result = validator(message);

    if (result === false) {
      throw new Error(`Message validation failed for type: ${message.type}`);
    }

    if (typeof result === "string") {
      throw new Error(result);
    }

    await next(message);
  };
}

/**
 * Transform middleware
 * Transforms messages before they are sent/received
 */
export function transformMiddleware(
  transform: (
    message: BridgeMessage,
    direction: "outgoing" | "incoming",
  ) => BridgeMessage | Promise<BridgeMessage>,
): Middleware {
  return async (message, context, next) => {
    const transformed = await transform(message, context.direction);
    await next(transformed);
  };
}

/**
 * Filter middleware
 * Blocks messages that don't match the filter
 */
export function filterMiddleware(
  filter: (message: BridgeMessage, direction: string) => boolean,
): Middleware {
  return async (message, context, next) => {
    if (filter(message, context.direction)) {
      await next(message);
    }
    // Message blocked - don't call next
  };
}

/**
 * Retry middleware.
 *
 * On failure it calls `next()` again, which re-runs the rest of the chain from
 * this position. Register it LAST (closest to the transport) so a retry re-runs
 * only the transport, not the middlewares before it. Outgoing-only: retrying an
 * inbound message would re-run downstream handlers and duplicate side effects.
 */
export function retryMiddleware(maxRetries = 3, delayMs = 1000): Middleware {
  return async (message, context, next) => {
    if (context.direction !== "outgoing") {
      await next(message);
      return;
    }

    let attempt = 0;
    for (;;) {
      try {
        await next(message);
        return; // Success
      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          throw error; // Max retries exceeded
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  };
}

/**
 * Throttle middleware
 * Limits the rate of messages. Burst-safe: N concurrent messages are spaced
 * `minInterval` apart rather than all measuring the same stale timestamp and
 * releasing together.
 */
export function throttleMiddleware(messagesPerSecond: number): Middleware {
  const minInterval = 1000 / messagesPerSecond;
  // The timestamp the NEXT message is allowed to go out. Reserving a slot
  // synchronously (before the await) serializes concurrent callers.
  let nextAllowedTime = 0;

  return async (message, _context, next) => {
    const now = Date.now();
    const scheduledTime = Math.max(now, nextAllowedTime);
    nextAllowedTime = scheduledTime + minInterval;

    const delay = scheduledTime - now;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await next(message);
  };
}

/**
 * Encryption middleware
 * Encrypts outgoing messages, decrypts incoming messages
 */
const ENCRYPTED_MARKER = "__nbridgeEncrypted";

export function encryptionMiddleware(
  encrypt: (data: unknown) => Promise<string> | string,
  decrypt: (encrypted: string) => Promise<unknown> | unknown,
): Middleware {
  return async (message, context, next) => {
    if (context.direction === "outgoing") {
      const encrypted = await encrypt(message.payload);
      await next({
        ...message,
        // Tagged envelope so the incoming side only decrypts envelopes this
        // middleware produced, never an arbitrary user payload that happens to
        // have an `encrypted` field.
        payload: { [ENCRYPTED_MARKER]: true, encrypted },
      });
    } else {
      const payload = message.payload as
        | { [ENCRYPTED_MARKER]?: unknown; encrypted?: string }
        | null
        | undefined;
      if (
        payload &&
        typeof payload === "object" &&
        payload[ENCRYPTED_MARKER] === true &&
        typeof payload.encrypted === "string"
      ) {
        const decrypted = await decrypt(payload.encrypted);
        await next({
          ...message,
          payload: decrypted,
        });
      } else {
        await next(message);
      }
    }
  };
}

/**
 * Metadata middleware
 * Adds metadata to all messages
 */
export function metadataMiddleware(
  metadata: Record<string, unknown> | (() => Record<string, unknown>),
): Middleware {
  return async (message, _context, next) => {
    const meta = typeof metadata === "function" ? metadata() : metadata;

    const isPlainObject =
      typeof message.payload === "object" &&
      message.payload !== null &&
      !Array.isArray(message.payload);

    await next({
      ...message,
      payload: isPlainObject
        ? { ...(message.payload as Record<string, unknown>), __metadata: meta }
        : message.payload,
    });
  };
}

/**
 * Debug middleware
 * Logs detailed debug information
 */
export function debugMiddleware(enabled = true): Middleware {
  return async (message, context, next) => {
    if (!enabled) {
      await next(message);
      return;
    }

    console.group(`[Debug] ${context.direction} - ${message.type}`);
    console.log("Message:", message);
    console.log("Context:", context);
    console.log("Timestamp:", new Date(context.timestamp).toISOString());

    const start = performance.now();
    try {
      await next(message);
      const duration = performance.now() - start;
      console.log(`Execution time: ${duration.toFixed(2)}ms`);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    } finally {
      console.groupEnd();
    }
  };
}
