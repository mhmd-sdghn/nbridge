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
 * Retry middleware
 * Retries failed messages (outgoing only)
 */
export function retryMiddleware(maxRetries = 3, delayMs = 1000): Middleware {
  return async (message, _context, next) => {
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        await next(message);
        return; // Success
      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          throw error; // Max retries exceeded
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  };
}

/**
 * Throttle middleware
 * Limits the rate of messages
 */
export function throttleMiddleware(messagesPerSecond: number): Middleware {
  let lastMessageTime = 0;
  const minInterval = 1000 / messagesPerSecond;

  return async (message, _context, next) => {
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;

    if (timeSinceLastMessage < minInterval) {
      // Wait before sending
      await new Promise((resolve) =>
        setTimeout(resolve, minInterval - timeSinceLastMessage),
      );
    }

    lastMessageTime = Date.now();
    await next(message);
  };
}

/**
 * Encryption middleware
 * Encrypts outgoing messages, decrypts incoming messages
 */
export function encryptionMiddleware(
  encrypt: (data: unknown) => Promise<string> | string,
  decrypt: (encrypted: string) => Promise<unknown> | unknown,
): Middleware {
  return async (message, context, next) => {
    if (context.direction === "outgoing") {
      // Encrypt payload
      const encrypted = await encrypt(message.payload);
      await next({
        ...message,
        payload: { encrypted },
      });
    } else {
      // Decrypt payload
      if (
        message.payload &&
        typeof message.payload === "object" &&
        "encrypted" in message.payload
      ) {
        const decrypted = await decrypt(
          (message.payload as { encrypted: string }).encrypted,
        );
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
