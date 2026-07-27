# Retry Queue

Delivery to the host can fail — the native interface is not injected yet, the parent frame
is not listening. With the queue enabled, messages that fail to send are parked instead of
lost, then replayed on a later attempt.

::: warning This is not a network queue
nbridge talks to its **host**, not to a server. Every adapter is an in-process call —
Android `@JavascriptInterface`, iOS `WKScriptMessageHandler`, iframe `postMessage`. A device
in a tunnel with no signal still has a perfectly working bridge, so `navigator.onLine` is
never consulted. If you need to hold messages until the *network* is back, that belongs in
your app or in the host, not here.
:::

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
    maxRetries: 3,              // delivery attempts before a message is dropped
    maxAge: 86_400_000,         // discard entries older than 24h
  },
});
```

Only `enabled` is required — every other field falls back to the default shown above.

## When messages are queued

A message is parked when `adapter.send()` throws, which is the only signal that delivery
actually failed. Not queued:

- **Protocol messages** — handshake and batch envelopes.
- **`expectResponse` messages** — the caller's response timer keeps ticking while a message
  sits in the queue, so a late replay would arrive after the caller already gave up.
- **`immediate` messages** — see below.

## Now-or-never messages

Some messages are only meaningful at the instant you send them. Closing the WebView is the
clearest case: replaying a `shutdown` from a previous session closes the app out from under
the user, mid-task. Mark those `immediate` and they bypass both the batcher and the queue —
delivery failure rejects instead of being parked:

```ts
await bridge.send("shutdown", {}, { immediate: true });
```

`nbridge/next`'s [`useBridgeBack`](/guide/nextjs) already does this for its shutdown event.

## Priorities

Each `send()` can declare how urgent it is; the queue drains `HIGH` first, then `NORMAL`,
then `LOW`:

```ts
await bridge.send("paymentConfirmed", payload, { priority: "HIGH" });
await bridge.send("analytics", payload, { priority: "LOW" });
// default: "NORMAL"
```

Priority also decides who loses when the queue is full. At `maxSize`, the oldest entry in the
lowest-priority band is evicted to make room; a message is only dropped outright when
everything already queued outranks it. Either way the loss is logged and counted in
`stats.failed`.

## Replay

Queued messages are replayed on the `flushInterval` timer when `autoFlush` is on, or when you
call `flushQueue()` yourself:

```ts
await bridge.flushQueue();
```

Replayed messages go back through the outgoing middleware chain, so middleware that stamps an
auth token or encrypts payloads runs with current state rather than whatever was true when
the message was first queued.

A message that fails `maxRetries` times is dropped and counted in `stats.failed`.

::: tip Persistence
With `persist: true` the queue is saved to `localStorage` under `storageKey` and reloaded on
the next page load, so messages survive WebView restarts. On load the queue is trimmed to
`maxSize` and anything older than `maxAge` is discarded, so a queue filled in one session
cannot come back over-full or replay stale commands. Set `maxAge: Infinity` to keep entries
indefinitely.
:::

## Inspecting

```ts
const stats = bridge.getQueueStats();
// { size: 4, pending: 4, failed: 0, completed: 37 } — null when the queue is disabled

bridge.clearQueue(); // drop everything queued
```

In React, [`useBridgeQueue`](/guide/react#usebridgequeue) polls these stats and exposes a
`flush()` helper — handy for a "you have unsent changes" indicator.
