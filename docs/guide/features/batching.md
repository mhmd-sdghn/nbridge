# Batching

High-frequency fire-and-forget traffic (analytics, telemetry, scroll/position updates) can hammer the WebView boundary — each crossing has real cost on Android and iOS. Batching buffers messages and delivers them as one envelope.

## Enable

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  batching: {
    enabled: true,
    maxSize: 10,   // flush when 10 messages are buffered
    maxWait: 100,  // ...or 100ms after the first buffered message
  },
});
```

All three fields are required when you pass a `batching` config. Defaults when omitted entirely: disabled.

## Behavior

- **Only fire-and-forget messages batch.** `sendWithResponse()` / `expectResponse: true` sends bypass the buffer so response timeouts stay honest.
- **Protocol messages bypass it** (handshake, and batch envelopes themselves).
- A batched `send()` resolves immediately with `{ success: true, id }` — the message is committed to the buffer, not yet on the wire.
- The buffer flushes when it reaches `maxSize` messages or `maxWait` ms after the first one, whichever comes first.

On the wire, a flush produces a single envelope:

```json
{
  "type": "__nbridge_batch__",
  "id": "…",
  "timestamp": 1751712345678,
  "payload": {
    "messages": [
      { "type": "analytics", "payload": { "event": "scroll" } },
      { "type": "analytics", "payload": { "event": "click" } }
    ]
  }
}
```

::: warning Host contract
Hosts must recognize `__nbridge_batch__`, unpack `payload.messages`, and process each entry as an individual message. If your host does not do this yet, leave batching off. Incoming batches are unpacked by nBridge automatically, so a *native* side may also send batch envelopes to the web. Details in the [Wire Protocol](/reference/protocol#batching).
:::

## Manual flush and stats

```ts
// Push everything buffered onto the wire right now
await bridge.batch();

const stats = bridge.getBatchStats();
// { pending: 3, sent: 120, failed: 0, totalBatches: 14 } — or null when batching is disabled
```

Flush before anything that might tear the page down:

```ts
window.addEventListener("pagehide", () => {
  void bridge.batch();
});
```
