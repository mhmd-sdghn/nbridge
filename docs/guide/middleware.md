# Middleware

Every message — outgoing and incoming — can flow through a middleware chain. Middleware can observe, transform, delay, retry, or block messages.

## The onion model

A middleware receives the message, a context, and `next`. Calling `next(message)` passes control inward; code after `await next()` runs on the way back out — like layers of an onion:

```ts
import type { Middleware } from "nbridge";

const timing: Middleware = async (message, context, next) => {
  const start = performance.now();     // ── entering the onion
  await next(message);                 //    inner layers + delivery/dispatch
  const ms = performance.now() - start; // ── unwinding
  console.log(`${context.direction} ${message.type} took ${ms.toFixed(1)}ms`);
};

bridge.use(timing);
```

```ts
interface MiddlewareContext {
  direction: "outgoing" | "incoming";
  timestamp: number;   // when the chain started
  bridge?: unknown;    // the BridgeManager instance
}
```

Rules of the game:

- **Register order = execution order.** `bridge.use(a); bridge.use(b)` runs `a` then `b` on the way in, `b` then `a` on the way back.
- **Transform** by passing a modified message to `next({...message, payload: ... })`.
- **Block** by *not* calling `next()` — the message is silently dropped.
- **Fail** by throwing — an outgoing throw rejects the `send()` promise (and falls into the [offline queue](/guide/features/offline-queue) when enabled).
- **Both directions.** The same chain runs for outgoing and incoming messages; branch on `context.direction` when behavior should differ.
- **Protocol messages skip it.** Handshake messages are handled before middleware; queued messages being replayed also skip the chain so stamping middleware does not run twice.

Middleware is on by default; disable the whole system with `middleware: { enabled: false }`.

## The ten built-ins

All are factory functions importable from `nbridge`:

```ts
import {
  loggingMiddleware,
  timingMiddleware,
  validationMiddleware,
  transformMiddleware,
  filterMiddleware,
  retryMiddleware,
  throttleMiddleware,
  encryptionMiddleware,
  metadataMiddleware,
  debugMiddleware,
} from "nbridge";
```

### `loggingMiddleware(prefix = "Bridge")`

Logs every message with its direction to the console.

```ts
bridge.use(loggingMiddleware("MyApp"));
// [MyApp] OUTGOING - getUser {...}
```

### `timingMiddleware(onTiming?)`

Measures how long the rest of the chain (including delivery/dispatch) takes.

```ts
bridge.use(
  timingMiddleware((type, duration, direction) => {
    analytics.track("bridge_timing", { type, duration, direction });
  }),
);
```

### `validationMiddleware(validator)`

Structural gate for every message. Return `false` (generic error), an error `string`, or `true` to pass.

```ts
bridge.use(
  validationMiddleware((message) => {
    if (message.type.length > 64) return "Message type too long";
    return true;
  }),
);
```

### `transformMiddleware(transform)`

Rewrite messages in flight; may be async.

```ts
bridge.use(
  transformMiddleware((message, direction) =>
    direction === "outgoing"
      ? { ...message, payload: { ...(message.payload as object), appVersion: "1.4.2" } }
      : message,
  ),
);
```

### `filterMiddleware(filter)`

Drop messages that fail the predicate — no error, no delivery.

```ts
// Never forward debug chatter to production hosts
bridge.use(filterMiddleware((message) => !message.type.startsWith("debug:")));
```

### `retryMiddleware(maxRetries = 3, delayMs = 1000)`

Re-runs the inner chain when it throws, with linear backoff (`delayMs * attempt`). Rethrows after the last attempt.

```ts
bridge.use(retryMiddleware(3, 500));
```

### `throttleMiddleware(messagesPerSecond)`

Rate-limits the chain by delaying messages that arrive too quickly.

```ts
bridge.use(throttleMiddleware(20)); // at most ~20 messages/second
```

### `encryptionMiddleware(encrypt, decrypt)`

Encrypts outgoing payloads (wrapped as `{ encrypted: string }`) and decrypts incoming ones. You supply both functions; they may be async.

```ts
bridge.use(
  encryptionMiddleware(
    async (data) => aesEncrypt(JSON.stringify(data)),
    async (blob) => JSON.parse(await aesDecrypt(blob)),
  ),
);
```

::: warning
The native side must apply the mirror-image transformation, and unencrypted incoming payloads pass through untouched. This is a convenience hook, not a security review.
:::

### `metadataMiddleware(metadata)`

Stamps `__metadata` onto every plain-object payload. Accepts a static object or a factory for per-message values.

```ts
bridge.use(
  metadataMiddleware(() => ({
    sessionId,
    sentAt: Date.now(),
  })),
);
```

Non-object payloads (strings, arrays, numbers) are left untouched.

### `debugMiddleware(enabled = true)`

`console.group` per message with the full message, context, timestamp, execution time, and any error. Noisy by design — development only.

```ts
bridge.use(debugMiddleware(import.meta.env.DEV));
```

## Composing

Order matters. A sensible production stack:

```ts
bridge.use(filterMiddleware((m) => allowedTypes.has(m.type))); // gate first
bridge.use(metadataMiddleware(() => ({ sessionId })));          // then stamp
bridge.use(retryMiddleware(2, 300));                            // retry around delivery
bridge.use(timingMiddleware(reportTiming));                     // measure everything inside
```
