# BridgeManager

The class behind every bridge. Obtain one via:

```ts
import { BridgeManager, createBridge, getBridge } from "nbridge";

const a = createBridge(config);       // new independent instance
const b = getBridge(config);          // lazily-created module singleton
const c = new BridgeManager(config);  // same as createBridge
```

When a `schemas` registry is supplied, `send`, `sendWithResponse`, `on`, and `onWithResponse` are typed against it: message types autocomplete, payloads and responses are inferred, and runtime validation applies. Without schemas they accept `string` types and `unknown` payloads.

## Sending

### `send(type, payload?, options?)`

Fire-and-forget (or, with `expectResponse`, the low-level request form). Runs payload schema validation, then batching (fire-and-forget only), middleware, compression, and the adapter.

```ts
const result = await bridge.send("analytics", { event: "view" });
// { success: true, id: "1751712345678-x3k9q2f" }

await bridge.send("paymentDone", payload, { priority: "HIGH" }); // queue priority
const res = await bridge.send("getUser", { id: "1" }, { expectResponse: true, timeout: 8000 });
// res: { success: true, data: {...}, id: "..." }
```

`BridgeSendOptions`: `timeout?: number`, `expectResponse?: boolean`, `priority?: "HIGH" | "NORMAL" | "LOW"` (queue priority, default `"NORMAL"`).

Rejects on validation failure (`BridgeValidationError`), middleware error, or adapter failure (unless the [offline queue](/guide/features/offline-queue) absorbs it).

### `sendWithResponse(type, payload?, timeout?)`

Send and await the correlated reply. Resolves with the reply's payload, validated against `responseSchema` when registered. Rejects on timeout (`Request timed out after Nms`).

```ts
const user = await bridge.sendWithResponse("getUser", { id: "42" }, 10_000);
```

## Receiving

### `on(type, handler)`

Register a handler for incoming messages of a type. Returns a subscription.

```ts
const sub = bridge.on("themeChanged", (payload, message) => { /* ... */ });
sub.unsubscribe();
```

### `onWithResponse(type, handler)`

Register a responder. The handler's return value is sent back as `<type>_response` (correlated by the incoming message id); a thrown error is sent as `<type>_error` with `{ error: string }`.

```ts
bridge.onWithResponse("getCart", async () => ({ items: await loadItems() }));
```

### `off(type, handler?)`

Remove a specific handler, or all handlers for the type when `handler` is omitted.

### `removeAllListeners(type?)`

Remove all handlers for a type — or every handler on the bridge when called with no argument.

## Readiness

### `isReady()`

`true` once initialization completed — with the [handshake](/guide/core-concepts#lifecycle-and-readiness) enabled, only after the counterpart acknowledged.

### `waitForReady(timeout = 10000)`

Resolves when ready; rejects on handshake timeout, wait timeout (`Bridge initialization timed out`), or destruction.

```ts
await bridge.waitForReady();
```

## Middleware

### `use(middleware)` / `addMiddleware(middleware)`

Append a middleware to the chain (both names are equivalent). See [Middleware](/guide/middleware).

### `getMiddlewareCount()`

Number of registered middleware.

## Platform

### `getPlatform()`

```ts
bridge.getPlatform();
// { platform: "android" | "ios" | "iframe" | "web", isNative: boolean, userAgent: string }
```

## Offline queue

| Method | Returns | Notes |
| --- | --- | --- |
| `getQueueStats()` | `QueueStats \| null` | `{ size, pending, failed, completed }`; `null` when the queue is disabled. |
| `flushQueue()` | `Promise<void>` | Replay queued messages now (straight to the adapter — middleware does not run twice). |
| `clearQueue()` | `void` | Drop all queued messages. |

## Batching

| Method | Returns | Notes |
| --- | --- | --- |
| `getBatchStats()` | `BatchStats \| null` | `{ pending, sent, failed, totalBatches }`; `null` when batching is disabled. |
| `batch()` | `Promise<void>` | Flush pending batched messages to the wire immediately. |

## Compression

| Method | Returns | Notes |
| --- | --- | --- |
| `getCompressionStats()` | `CompressionStats \| null` | `{ totalCompressed, bytesBeforeCompression, bytesAfterCompression, averageCompressionRatio }`; `null` when disabled. |
| `isCompressionEnabled()` | `boolean` | |

## Metrics

| Method | Returns | Notes |
| --- | --- | --- |
| `getMetrics()` | `BridgeMetrics \| null` | Snapshot; `null` when metrics are disabled. |
| `onMetricsUpdate(listener)` | `() => void` | Subscribe to periodic updates; returns an unsubscribe function. |

## Schemas

| Method | Returns | Notes |
| --- | --- | --- |
| `getSchema(type)` | `MessageSchema \| null` | The registered schema for a type. |
| `hasSchemas()` | `boolean` | Whether a registry was supplied. |
| `getAllSchemas()` | the registry | |

## DevTools & logging

| Method | Notes |
| --- | --- |
| `isDevToolsEnabled()` | Whether the DevTools collector is active. |
| `getDevTools()` | The `BridgeDevTools` collector, or `null`. |
| `log(...args)` / `warn(...args)` / `error(...args)` / `info(...args)` | Log through the bridge's router (`devTools.logDestination` decides console vs. panel). Non-error levels require `debug: true`. |

## Teardown

### `destroy()`

Tears everything down: removes adapter listeners and the `window.sendBridgeMessage` global, rejects pending responses and ready-waiters, clears handlers, middleware, queue, batcher, metrics, and DevTools state. The instance is not reusable afterwards.

```ts
bridge.destroy();
```
