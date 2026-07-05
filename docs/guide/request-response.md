# Request & Response

Fire-and-forget covers notifications; most real integrations also need answers. nBridge layers a promise-based request/response protocol on top of plain messages, correlated by message `id`.

## Asking the host

```ts
const user = await bridge.sendWithResponse("getUser", { id: "42" });
```

What happens:

1. nBridge sends `{ type: "getUser", id: "1751712345678-x3k9q2f", payload: { id: "42" } }`.
2. The host does its work and replies with the **same id**:
   `{ type: "getUser_response", id: "1751712345678-x3k9q2f", payload: { name: "Ada" } }`.
3. The promise resolves with the reply's `payload` (validated against `responseSchema` if one is registered).

### Timeouts

Every request has a deadline — `defaultTimeout` (5000 ms) unless overridden per call:

```ts
try {
  const user = await bridge.sendWithResponse("getUser", { id: "42" }, 15_000);
} catch (err) {
  // Error: Request timed out after 15000ms
}
```

### The lower-level form

`sendWithResponse(type, payload, timeout)` is sugar for:

```ts
const response = await bridge.send("getUser", { id: "42" }, {
  expectResponse: true,
  timeout: 15_000,
});
// response: { success: true, data: {...}, id: "..." }
```

`send()` with `expectResponse` resolves with the full `BridgeResponse` envelope; `sendWithResponse()` unwraps `data` for you and runs response-schema validation.

### Host-reported errors

By convention a host that cannot fulfil a request replies with `<type>_error` and an `{ error: string }` payload (this is exactly what nBridge itself sends when one of *your* `onWithResponse` handlers throws). Both `_response` and `_error` settle the pending request — an `_error` reply arrives as resolved data shaped `{ error: string }`, so check for it when your host uses the error variant:

```ts
const result = await bridge.sendWithResponse<unknown, { error?: string }>("getUser", { id: "42" });
if (result && typeof result === "object" && "error" in result) {
  // host-side failure
}
```

## Answering the host

Register a responder with `onWithResponse` — whatever you return is sent back automatically as `<type>_response`, correlated to the incoming message's id:

```ts
bridge.onWithResponse("getCartState", async (payload, message) => {
  const cart = await loadCart();
  return { items: cart.items.length, total: cart.total };
});
```

If the handler **throws**, nBridge replies with `<type>_error` and `{ error: message }` instead:

```ts
bridge.onWithResponse("getLocation", async () => {
  const pos = await getCurrentPosition(); // may throw
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
});
// on failure the host receives:
// { type: "getLocation_error", id: "<same id>", payload: { error: "User denied Geolocation" } }
```

::: tip Wire contract
The exact JSON the native side must produce and consume — including this response convention — is specified in the [Wire Protocol reference](/reference/protocol). The [Android](/guide/platforms/android) and [iOS](/guide/platforms/ios) pages show working Kotlin/Swift responders.
:::

## Notes and gotchas

- **Requests bypass batching.** Only fire-and-forget messages are buffered when [batching](/guide/features/batching) is enabled; `expectResponse` sends go straight out so the timeout clock is honest.
- **Ids are generated for you** (`generateMessageId()` — timestamp plus random suffix). Never reuse ids.
- **Reserve the suffixes.** Incoming messages whose type ends in `_response` / `_error` and whose id matches a pending request are consumed by the correlator and are not dispatched to `on()` handlers. Avoid naming your own event types with those suffixes unless they are answers.
- **Concurrent requests are fine.** Correlation is per-id, so overlapping requests of the same type resolve independently.
- **Timeouts count as metrics events.** When [metrics](/guide/features/metrics) are enabled, each timeout increments `timeouts` and affects `successRate`.
