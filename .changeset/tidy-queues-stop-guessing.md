---
"nbridge": patch
---

Stop gating message delivery on `navigator.onLine`, and never replay now-or-never commands.

Every adapter is an in-process host call (Android `@JavascriptInterface`, iOS
`WKScriptMessageHandler`, iframe `postMessage`), so network reachability says nothing about
whether the host can be reached. Gating on it parked messages a working transport would have
delivered, and because auto-flush was gated on the same signal the queue had no drain path
while offline — it filled to `maxSize` and then rejected every subsequent send with
`Cannot send message "..." while offline: queue is full`. With `persist: true` the stale
messages were replayed in a later session.

- **Breaking:** the queue no longer consults `navigator.onLine`; a message is queued only when
  `adapter.send()` throws. The `online` listener is gone (redundant with `flushInterval`).
- **Breaking:** queue overflow evicts the oldest lowest-priority entry instead of throwing, so
  `priority` finally decides who loses. Drops are logged and counted in `stats.failed`.
- **Breaking:** new `queue.maxAge` (default 24h) discards stale entries on load and before each
  flush; `loadFromStorage` now trims to `maxSize`. Pass `Infinity` for the old behaviour.
- **Added:** `BridgeSendOptions.immediate` bypasses the batcher and the retry queue so delivery
  failure rejects instead of being parked.
- `nbridge/next`'s `useBridgeBack` sends its shutdown event with `{ immediate: true }`, flushes
  any pending batch first (the shutdown would otherwise overtake it and the host would destroy
  the WebView before those messages went out), and ignores taps that land while a shutdown is
  still in flight — releasing the guard once it settles, since a delivered shutdown does not
  mean the host closed anything.

**Migrating:** most apps need no change — sends that used to be parked now reach the host. To
hold messages until the network returns, wire it yourself with
`window.addEventListener("online", () => void bridge.flushQueue())`. Remove any `try/catch`
that existed only to swallow a queue-full rejection. Pass `queue.maxAge: Infinity` to keep
entries indefinitely.
