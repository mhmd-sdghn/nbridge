# Offline Queue

WebViews go offline — elevators, tunnels, flaky mobile networks. With the queue enabled, messages that cannot be delivered are parked instead of lost, then replayed when connectivity returns.

## Enable

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  queue: {
    enabled: true,
    maxSize: 100,               // total messages across all priorities
    persist: true,              // survive page reloads via localStorage
    storageKey: "nbridge-queue",
    autoFlush: true,            // retry on an interval
    flushInterval: 5000,        // every 5s
  },
});
```

All six fields are required when you pass a `queue` config. Defaults when omitted entirely: disabled.

## When messages are queued

1. **Offline** — `navigator.onLine === false` at send time: the message is queued immediately instead of attempting delivery.
2. **Adapter failure** — delivery throws (e.g. the native interface briefly unavailable): the message is queued for retry instead of rejecting your `send()`.

Protocol messages (handshake, batch envelopes) are never queued. When the queue is full, new messages are dropped with a warning.

## Priorities

Each `send()` can declare how urgent it is; the queue drains `HIGH` first, then `NORMAL`, then `LOW`:

```ts
await bridge.send("paymentConfirmed", payload, { priority: "HIGH" });
await bridge.send("analytics", payload, { priority: "LOW" });
// default: "NORMAL"
```

## Replay

Queued messages are replayed:

- when the browser fires the **`online`** event,
- on the **`flushInterval`** timer when `autoFlush` is on,
- or when you call **`flushQueue()`** yourself.

```ts
await bridge.flushQueue();
```

Replayed messages go straight to the adapter — they already passed validation and middleware once, so a middleware chain that stamps metadata does not run twice.

::: tip Persistence
With `persist: true` the queue is saved to `localStorage` under `storageKey` and reloaded on the next page load, so messages survive WebView restarts.
:::

## Inspecting

```ts
const stats = bridge.getQueueStats();
// { size: 4, pending: 4, failed: 0, completed: 37 } — null when the queue is disabled

bridge.clearQueue(); // drop everything queued
```

In React, [`useBridgeQueue`](/guide/react#usebridgequeue) polls these stats and exposes a `flush()` helper — handy for a "you have unsent changes" indicator.

::: warning Requests do not wait offline
The queue holds *messages*, not *promises*. A `sendWithResponse()` issued while offline will queue its message but the response timer keeps ticking — the request will likely time out before the queue replays. Prefer fire-and-forget semantics for anything that must survive offline periods.
:::
