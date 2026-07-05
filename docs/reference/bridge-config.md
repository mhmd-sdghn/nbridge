# Bridge Config

Everything `createBridge(config)`, `getBridge(config)`, and `new BridgeManager(config)` accept. All keys are optional.

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  debug: true,
  defaultTimeout: 5000,
  handshake: { enabled: true },
  // ...
});
```

## Top-level keys

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `debug` | `boolean` | `false` | Enable debug logging (errors always log regardless). |
| `defaultTimeout` | `number` | `5000` | Timeout in ms for messages expecting responses. |
| `androidInterface` | `string` | `"AndroidBridge"` | Name of the Android `JavascriptInterface` on `window`. |
| `iosHandler` | `string` | `"iosBridge"` | Name of the WKWebView message handler under `webkit.messageHandlers`. |
| `schemas` | `SchemaRegistry` | `undefined` | Message schema registry — enables typed, validated messaging. See [Schemas](/guide/schemas). |
| `handshake` | `HandshakeConfig` | see below | Real-connection handshake. See [Core Concepts](/guide/core-concepts#lifecycle-and-readiness). |
| `middleware` | `MiddlewareConfig` | `{ enabled: true }` | Middleware system toggle. See [Middleware](/guide/middleware). |
| `compression` | `CompressionConfig` | see below | Deflate compression for large payloads. See [Compression](/guide/features/compression). |
| `queue` | `QueueConfig` | see below | Offline queue. See [Offline Queue](/guide/features/offline-queue). |
| `batching` | `BatchConfig` | see below | Message batching. See [Batching](/guide/features/batching). |
| `metrics` | `MetricsConfig` | see below | Live metrics collection. See [Metrics](/guide/features/metrics). |
| `devTools` | `DevToolsConfig` | see below | In-page DevTools collection. See [DevTools](/guide/devtools). |
| `webLoopback` | `boolean` | `false` | Echo transport on plain web, for local development. See [Plain Web](/guide/platforms/web). |
| `iframeParentOrigin` | `string` | `undefined` | Expected parent-frame origin — restricts accepted origins and sets the `postMessage` target origin. **Set in production iframe deployments.** |

::: warning Partial vs. full sub-configs
`handshake` and `compression` are merged field-by-field with defaults. `queue`, `batching`, `metrics`, and `devTools` replace the default block, and their types mark most fields required — pass the complete object as shown below.
:::

## `handshake`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Exchange handshake/ack with the host so `isReady()` reflects a real connection. Requires host support. |
| `timeout` | `number` | `10000` | Give up (and reject `waitForReady()`) after this many ms. |
| `retryInterval` | `number` | `500` | Resend the handshake every N ms until acknowledged. |

## `middleware`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Run registered middleware on outgoing and incoming messages. |

## `compression`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Compress outgoing payloads. Incoming compressed payloads are always decompressed, regardless. |
| `algorithm` | `"gzip" \| "deflate" \| "br"` | `"deflate"` | Keep `"deflate"` — it is the only wire format the current implementation produces. |
| `threshold` | `number` | `1024` | Minimum JSON payload size in bytes before compression kicks in. |
| `trackStats` | `boolean` | `true` | Record `getCompressionStats()` data. |

## `queue`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Park undeliverable messages instead of failing. |
| `maxSize` | `number` | `100` | Total queued messages across all priorities; overflow is dropped with a warning. |
| `persist` | `boolean` | `false` | Save the queue to `localStorage` and restore on next load. |
| `storageKey` | `string` | `"nbridge-queue"` | `localStorage` key used when `persist` is on. |
| `autoFlush` | `boolean` | `true` | Retry delivery on an interval. |
| `flushInterval` | `number` | `5000` | Auto-flush interval in ms. |

## `batching`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Buffer fire-and-forget messages into `__nbridge_batch__` envelopes. Requires host support. |
| `maxSize` | `number` | `10` | Flush when this many messages are buffered. |
| `maxWait` | `number` | `100` | Flush this many ms after the first buffered message. |

## `metrics`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Collect live traffic metrics. |
| `updateInterval` | `number` | `1000` | Recompute and notify `onMetricsUpdate` listeners every N ms. |
| `detailedTiming` | `boolean` | `false` | Keep per-message timing detail. |

## `devTools`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Record message history and logs for the DevTools panel. Automatically disabled in production builds (`NODE_ENV=production`). |
| `maxMessageHistory` | `number` | `50` | Bridge messages kept in the history tab. |
| `logDestination` | `"console" \| "devtools" \| "both" \| "none"` | `"devtools"` | Where bridge logs are routed. |
| `maxConsoleLogEntries` | `number` | `100` | Console entries mirrored into the panel. |

## Fully-loaded example

```ts
import { createBridge } from "nbridge";
import { schemas } from "./schemas";

export const bridge = createBridge({
  debug: process.env.NODE_ENV !== "production",
  defaultTimeout: 5000,
  androidInterface: "AndroidBridge",
  iosHandler: "iosBridge",
  schemas,
  handshake: { enabled: true, timeout: 10_000, retryInterval: 500 },
  middleware: { enabled: true },
  compression: { enabled: true, algorithm: "deflate", threshold: 1024 },
  queue: {
    enabled: true,
    maxSize: 100,
    persist: true,
    storageKey: "nbridge-queue",
    autoFlush: true,
    flushInterval: 5000,
  },
  batching: { enabled: true, maxSize: 10, maxWait: 100 },
  metrics: { enabled: true, updateInterval: 1000, detailedTiming: false },
  devTools: {
    enabled: process.env.NODE_ENV !== "production",
    maxMessageHistory: 50,
    logDestination: "devtools",
    maxConsoleLogEntries: 100,
  },
  webLoopback: false,
  iframeParentOrigin: "https://host.example.com",
});
```
