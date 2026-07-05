# Core Concepts

## Messages

Everything that crosses the bridge is a `BridgeMessage`:

```ts
interface BridgeMessage<T = unknown> {
  type: string;        // what kind of message this is
  payload?: T;         // the data
  id?: string;         // set automatically — used for request/response correlation
  timestamp?: number;  // set automatically
  __compressed?: boolean; // protocol flag, set automatically — never set by hand
}
```

`bridge.send()` and friends create the message for you (via `createMessage`), assigning a unique `id` and `timestamp`. You only ever deal with `type` and `payload`.

There are two messaging styles:

| Style | Web API | What the host does |
| --- | --- | --- |
| Event (fire-and-forget) | `send(type, payload)` | Handles it; no reply needed |
| Request/response | `sendWithResponse(type, payload)` | Replies with `{ type: "<type>_response", id, payload }` |

And both work in the other direction: the host emits events you receive with `on()`, and it can make requests you answer with `onWithResponse()`.

## Transports and auto-detection

At construction, nBridge picks one of four adapters:

1. **Android** — `window.<androidInterface>` exists (default `"AndroidBridge"`, injected by `addJavascriptInterface`). Outgoing messages go to `AndroidBridge.postMessage(jsonString)`.
2. **iOS** — `window.webkit.messageHandlers.<iosHandler>` exists (default `"iosBridge"`). Outgoing messages go to `webkit.messageHandlers.iosBridge.postMessage(object)`.
3. **Iframe** — the page runs inside an iframe (`window.self !== window.top`). Messages are exchanged with `window.parent` via `postMessage`, origin-checked when `iframeParentOrigin` is set.
4. **Web** — none of the above. `send()` throws unless `webLoopback: true` is enabled for local development.

Native bridges are checked first, so a WebView that happens to render your page inside an iframe still uses the native transport.

On Android and iOS, incoming messages arrive through a global function nBridge attaches at initialization — the native side calls it with a JSON string:

```js
window.sendBridgeMessage(jsonString);
```

Inspect what was detected:

```ts
const { platform, isNative, userAgent } = bridge.getPlatform();
// platform: "android" | "ios" | "iframe" | "web"
```

Standalone utilities are exported too: `detectPlatform()`, `getPlatformInfo()`, `isAndroid()`, `isIOS()`, `isIframe()`, `hasAndroidBridge()`, `hasIOSBridge()`.

## Lifecycle and readiness

A bridge is live from the moment `createBridge()` returns — handlers can be registered and messages sent immediately. What "ready" means depends on the handshake setting:

### Without handshake (default)

`isReady()` flips to `true` as soon as local initialization completes. This is compatible with any host, but it only tells you *your* side is set up — not that anyone is listening.

### With handshake — `ready` means the other side answered

```ts
const bridge = createBridge({
  handshake: {
    enabled: true,
    timeout: 10_000,      // give up after 10s (default)
    retryInterval: 500,   // resend every 500ms until acknowledged (default)
  },
});

try {
  await bridge.waitForReady();
  // A real counterpart acknowledged the handshake.
} catch (err) {
  // "nBridge handshake timed out after 10000ms — is the native side listening?"
}
```

Under the hood the web side sends `{ type: "__nbridge_handshake__" }` every `retryInterval` ms until it receives `{ type: "__nbridge_handshake_ack__" }`. The native side may also initiate the handshake — nBridge acks it automatically and marks itself ready.

::: warning Requires host support
The handshake only succeeds if the host replies to `__nbridge_handshake__` with `__nbridge_handshake_ack__`. That is one `if` statement on the native side — see the [Wire Protocol](/reference/protocol#handshake). It is off by default so nBridge works against hosts that predate it.
:::

### Teardown

```ts
bridge.destroy();
```

Removes adapter listeners and the `window.sendBridgeMessage` hook, rejects all pending responses and ready-waiters, clears handlers, middleware, queue, batcher, metrics, and DevTools state.

## The message pipeline

Outgoing, in order:

1. **Schema validation** — if a schema is registered for the type ([Schemas](/guide/schemas))
2. **Batching** — fire-and-forget messages are buffered when enabled ([Batching](/guide/features/batching))
3. **Middleware chain** — outgoing direction ([Middleware](/guide/middleware))
4. **Compression** — large payloads deflated when enabled ([Compression](/guide/features/compression))
5. **Adapter** — hand off to the platform; failures fall into the [Offline Queue](/guide/features/offline-queue) when enabled

Incoming, in order:

1. **Protocol handling** — handshake messages are answered and never reach your code
2. **Decompression** — `__compressed` payloads are inflated automatically, always
3. **Middleware chain** — incoming direction
4. **Batch unpacking** — `__nbridge_batch__` envelopes are split into individual messages
5. **Response correlation** — `*_response` / `*_error` messages settle pending requests
6. **Dispatch** — your `on()` / `onWithResponse()` handlers run
