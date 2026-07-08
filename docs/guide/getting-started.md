# Getting Started

nBridge gives your web app one API for talking to whatever hosts it — an Android WebView, an iOS WKWebView, or a parent page around an iframe. It detects the transport at runtime, correlates requests with responses, and (optionally) validates every payload with the schema library you already use.

::: warning Experimental
nBridge is experimental and under active development — APIs may change between versions. ESM-only.
:::

## Installation

```sh
npm i nbridge
```

React (`nbridge/react`), Next.js (`nbridge/next`), and DevTools (`nbridge/devtools`) entry points are included — React and Next.js are optional peer dependencies, only needed if you use those entry points.

## Five-minute quickstart

### 1. Create a bridge

```ts
// src/lib/bridge.ts
import { createBridge } from "nbridge";

export const bridge = createBridge({
  debug: true, // log activity while developing
});
```

The platform is detected automatically: if `window.AndroidBridge` exists you are on Android, if `window.webkit.messageHandlers.iosBridge` exists you are on iOS, if the page runs inside an iframe you get the postMessage transport, otherwise plain web.

::: tip Singleton
Prefer one bridge per app. `getBridge(config)` returns a lazily-created singleton if you need global access:

```ts
import { getBridge } from "nbridge";
const bridge = getBridge({ debug: true });
```
:::

### 2. Send a message

```ts
// Fire-and-forget — resolves as soon as the message is handed to the transport
await bridge.send("analytics", { event: "checkout_started" });
```

### 3. Ask a question, await the answer

```ts
// Sends { type: "getUser", id, payload } and waits for the host to reply
// with { type: "getUser_response", id, payload } — correlated by id.
const user = await bridge.sendWithResponse("getUser", { id: "42" });
```

Requests time out after `defaultTimeout` (5000 ms) unless you pass a third argument:

```ts
const user = await bridge.sendWithResponse("getUser", { id: "42" }, 10_000);
```

### 4. Listen for messages from the host

```ts
const subscription = bridge.on("themeChanged", (payload) => {
  applyTheme(payload);
});

// later
subscription.unsubscribe();
```

The host can also ask *you* questions — return a value and nBridge sends the response automatically:

```ts
bridge.onWithResponse("getLocation", async () => {
  const pos = await getCurrentPosition();
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
});
```

### 5. Add type safety (optional, recommended)

```ts
import { z } from "zod";
import { createBridge, defineMessage } from "nbridge";

const schemas = {
  getUser: defineMessage({
    type: "getUser",
    payloadSchema: z.object({ id: z.string() }),
    responseSchema: z.object({ name: z.string() }),
  }),
};

export const bridge = createBridge({ schemas });

// ✅ typed and runtime-validated
const user = await bridge.sendWithResponse("getUser", { id: "42" });

// ❌ compile error: unknown message type / wrong payload shape
// await bridge.sendWithResponse("getUsr", { id: 42 });
```

Any [Standard Schema](https://standardschema.dev) validator works — zod 3.24+/4, valibot, ArkType. See [Schemas & Validation](/guide/schemas).

## Developing without a native host

In a plain browser tab there is no host, so `send()` **throws** by design. For local development, enable loopback mode — messages you send are delivered back to your own handlers:

```ts
const bridge = createBridge({ webLoopback: true });

bridge.on("ping", (payload) => console.log("echoed:", payload));
await bridge.send("ping", { hello: "world" });
```

See [Plain Web](/guide/platforms/web) for details.

## Wiring up the native side

The web side is now done. Your host needs a few lines to receive and send messages:

- [Android WebView setup](/guide/platforms/android) — Kotlin
- [iOS WKWebView setup](/guide/platforms/ios) — Swift
- [Iframe parent setup](/guide/platforms/iframe) — plain JS on the parent page

The complete wire contract (message shape, response convention, handshake, batching, compression) lives in the [Wire Protocol reference](/reference/protocol).

## Next steps

- [Core Concepts](/guide/core-concepts) — messages, transports, lifecycle
- [Request & Response](/guide/request-response) — timeouts, errors, patterns
- [React](/guide/react) — `createBridgeHooks` and eleven typed hooks
- [DevTools](/guide/devtools) — inspect traffic in-page with Ctrl+Shift+B
