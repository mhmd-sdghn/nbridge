# Plain Web

A plain browser tab — no Android interface, no WKWebView handler, no parent frame — has **no host to talk to**. nBridge treats this honestly rather than pretending.

## The honest failure

Without a host, `send()` **throws**:

```
nBridge: no native bridge or parent frame found for message "getUser".
Running in a plain browser tab? Enable `webLoopback: true` for local development,
or open the page inside a WebView/iframe host.
```

This is deliberate. Silently dropping messages would make `send()` report success while `sendWithResponse()` times out mysteriously — the least debuggable failure mode there is. If your app must run both embedded and standalone, branch on the platform:

```ts
import { createBridge } from "nbridge";

const bridge = createBridge();
const { isNative, platform } = bridge.getPlatform();

if (platform !== "web") {
  await bridge.send("appOpened", { at: Date.now() });
} else {
  // standalone browser — use your web fallback (e.g. fetch)
}
```

## Loopback mode for local development

`webLoopback: true` turns the web adapter into an echo transport: outgoing messages are posted back to the same window and dispatched to your **own** handlers, simulating a host:

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  webLoopback: import.meta.env.DEV, // never in production
  debug: true,
});

// Simulate the host answering a request:
bridge.onWithResponse("getUser", ({ id }) => ({
  name: `Fake user ${id}`,
  email: "dev@example.com",
}));

// Elsewhere in your app — works exactly like it will in the WebView:
const user = await bridge.sendWithResponse("getUser", { id: "42" });
console.log(user.name); // "Fake user 42"
```

Because the loop passes through the full incoming pipeline, this exercises middleware, schema validation, response correlation, and DevTools exactly as a real host would.

::: tip Handshake works too
With `handshake: { enabled: true }`, the loopback echoes your `__nbridge_handshake__` back to you, your bridge acks it, and `waitForReady()` resolves — so the same config runs in dev and in the WebView.
:::

::: warning Loopback is not a mock host
Everything you send comes back to *you*. If you register `on("analytics", …)` for messages you also send, it will fire in loopback but not in production (where the native side consumes them). Keep host-simulation handlers clearly separated, e.g. in a `devHost.ts` imported only in development.
:::

## Incoming messages on plain web

Even without loopback, the web adapter listens for same-origin `window.postMessage` events, so test harnesses can inject messages:

```ts
// e.g. in a test
window.postMessage({ type: "themeChanged", payload: { theme: "dark" } }, window.location.origin);
```

Only same-origin messages that look like bridge messages (`{ type: string, ... }`) are dispatched.
