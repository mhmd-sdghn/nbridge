---
"nbridge": patch
---

Stay quiet in a production plain browser tab, and make production detection actually work.

A page built for a WebView still gets opened in a browser, e.g. when the OS hands the URL to
the default browser. Before this release every `send()` there threw, and apps that fired
`send("shutdown")` without a `.catch` reported thousands of unhandled rejections.

- **Breaking:** when `NODE_ENV` is `"production"` and no host exists (no Android interface, no
  WKWebView handler, no parent frame, no `webLoopback`), `send()` resolves
  `{ success: false, error }` instead of throwing, and logs nothing. `sendWithResponse()`
  still rejects (there is no response to return), but without logging. Middleware, the batcher
  and the retry queue are skipped. Development and test builds still throw loudly.
- **Added:** `BridgeNoHostError` (`code: "NBRIDGE_NO_HOST"`, `messageType`), thrown for the
  missing-host case everywhere, so apps can tell it apart with `instanceof`.
- **Fixed:** the published build inlined `process.env.NODE_ENV` as `"development"`, so
  production checks never matched in consumer apps. The expression is now left for the
  consumer's bundler. As a result, the existing production gates take effect for the first
  time: DevTools refuses to enable in production builds, and Host Rules stops warning about
  out-of-domain trait values in production.
- `useBridgeRPC` sets `error` straight away when a send is not delivered, instead of waiting
  for its timeout.

**Migrating:** code that relied on `send()` rejecting in a production browser tab should check
`result.success` instead.
