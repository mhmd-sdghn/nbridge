---
layout: home

hero:
  name: "nBridge"
  text: "One bridge between your web app and every host"
  tagline: Type-safe, real-time messaging with Android WebViews, iOS WKWebViews, and iframes — promise-based, validated, observable.
  image:
    src: /logo.svg
    alt: nBridge
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mhmd-sdghn/nbridge

features:
  - icon: 🌉
    title: One API, four transports
    details: Android JavascriptInterface, iOS WKWebView message handlers, iframe postMessage, and a web loopback for local dev — auto-detected at runtime.
  - icon: 🛡️
    title: Bring your own validator
    details: Standard Schema support means zod 3.24+/4, valibot, or ArkType just work — or skip validation entirely. Zero forced dependencies.
  - icon: ⚡
    title: Promise-based request/response
    details: sendWithResponse() correlates replies by message id, with per-call timeouts. No callback spaghetti across the native boundary.
  - icon: 🤝
    title: A handshake that means it
    details: Opt-in handshake protocol — isReady() reflects that the other side actually answered, not just that your JavaScript loaded.
  - icon: 🧅
    title: Middleware, both directions
    details: An onion-model pipeline for outgoing and incoming messages, plus ten built-ins — logging, retry, throttle, encryption, and more.
  - icon: 📦
    title: Batching, compression, offline queue
    details: Opt-in message batching, deflate compression above a size threshold, and a priority queue that persists offline sends and replays on reconnect.
  - icon: ⚛️
    title: React, Next.js, DevTools
    details: Typed hooks via nbridge/react, WebView back-navigation via nbridge/next, and an in-page DevTools panel via nbridge/devtools.
  - icon: 📊
    title: Live metrics
    details: Messages per second, success rate, average response time, bytes over the wire — collected in-process and streamed to listeners.
---

## Show me code

Define messages once, get typed payloads and responses everywhere — with the validator you already use, or none at all.

::: code-group

```ts [zod]
import { z } from "zod";
import { createBridge, defineMessage } from "nbridge";

const schemas = {
  getUser: defineMessage({
    type: "getUser",
    payloadSchema: z.object({ id: z.string() }),
    responseSchema: z.object({ name: z.string(), email: z.string() }),
  }),
};

const bridge = createBridge({ schemas });

// Typed + validated at runtime
const user = await bridge.sendWithResponse("getUser", { id: "42" });
console.log(user.name);
```

```ts [valibot]
import * as v from "valibot";
import { createBridge, defineMessage } from "nbridge";

const schemas = {
  getUser: defineMessage({
    type: "getUser",
    payloadSchema: v.object({ id: v.string() }),
    responseSchema: v.object({ name: v.string(), email: v.string() }),
  }),
};

const bridge = createBridge({ schemas });

const user = await bridge.sendWithResponse("getUser", { id: "42" });
console.log(user.name);
```

```ts [no validator]
import { createBridge } from "nbridge";

const bridge = createBridge();

// Fire-and-forget
await bridge.send("analytics", { event: "page_view" });

// Request/response, correlated by message id
const user = await bridge.sendWithResponse<
  { id: string },
  { name: string; email: string }
>("getUser", { id: "42" });

// Listen for messages from the host
bridge.on("themeChanged", (payload) => {
  console.log("Native says:", payload);
});
```

:::
