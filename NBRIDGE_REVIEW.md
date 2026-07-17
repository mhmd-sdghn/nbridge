# nbridge Package Review

Full review of `packages/bridge` (published as `nbridge`). Written for a refactoring agent: every finding has file references, the concrete failure mechanism or cost, and a suggested fix. Breaking changes are explicitly acceptable per the review brief.

## Fix status legend

Findings are being fixed in place; each heading carries a status marker:

- **[FIXED]**: implemented and covered by the test suite where applicable.
- **[PARTIAL]**: some sub-items fixed; remainder noted inline.
- No marker: not yet addressed.

Severity meanings:

- **Critical**: wrong behavior on a primary happy path, or silent data corruption.
- **High**: wrong behavior in an advertised feature, silent message loss, or a defect that undermines the library's core promise (type safety, reliability).
- **Medium**: real bug or cost with a narrower trigger, or an API-contract problem worth a breaking change.
- **Low**: correct-by-luck code, dead code, redundancy, missed hardening, or polish.

All findings below were adversarially verified against the source before inclusion.

---

## Part 1: Core messaging

Files: `src/core/BridgeManager.ts`, `MessageHandler.ts`, `MessageQueue.ts`, `ResponseManager.ts`, `BatchManager.ts`, `CompressionManager.ts`, `MetricsCollector.ts`, `MiddlewareManager.ts`, `validate.ts`, plus `src/utils/helpers.ts` (logger and helpers used by core).

### Critical

**1.1 [FIXED] Remote handler errors (`*_error` responses) resolve as successful responses**
`src/core/BridgeManager.ts:398-404`, `src/core/ResponseManager.ts:50-71`

`processIncomingMessage` treats any type ending in `_response` OR `_error` identically and calls `responseManager.resolve(message.id, message.payload)`. `ResponseManager.resolve` always fabricates `{ success: true, data }`. Meanwhile the peer's `onWithResponse` wrapper (BridgeManager.ts:713-726) reports handler failures by sending `${type}_error` with payload `{ error: "..." }`. Result: when the remote handler throws, the local `sendWithResponse` sees `success: true` and returns `{ error: "..." }` as if it were the typed response data. The `if (!response.success) throw` branch in `sendWithResponse` (line 533-535) is dead code; no code path ever produces `success: false`.

Fix: in `processIncomingMessage`, split the suffixes: `_response` resolves, `_error` calls `responseManager.reject(id, payload.error)`. Better long-term: carry success/failure structurally on the envelope (e.g. `{ ok: false, error }` or a `replyTo: id` field) instead of type-name suffixes. Add a test where the responder's handler throws and assert `sendWithResponse` rejects.

### High

**1.2 [FIXED] Partial sub-config objects silently lose all defaults; sub-config types are all-required so the documented defaults are unreachable**
`src/core/BridgeManager.ts:104-127`, `src/types/index.ts` (QueueConfig 284-291, BatchConfig 341-345, MetricsConfig 371-375, CompressionConfig 401-406)

`queue`, `batching`, `metrics`, and `devTools` are defaulted with a whole-object `??` (`config.queue ?? { enabled: false, maxSize: 100, ... }`), unlike `handshake`/`compression` which merge per field. So the built-in defaults (maxSize 100, flushInterval 5000, batching maxSize 10/maxWait 100, metrics updateInterval 1000) only apply when the feature is disabled, i.e. they are dead values. The type system papers over this: QueueConfig/BatchConfig/MetricsConfig/CompressionConfig declare every field required, so `queue: { enabled: true }` is a compile error and users are forced to hand-write every field. The `as Required<...>` casts (lines 144, 150, 157, 167, 174) then lie to the sub-managers. Anyone bypassing the types (JS consumer, `as any`) gets undefined `maxSize`/`flushInterval` at runtime: `setupAutoFlush` silently never runs (MessageQueue.ts:311), the queue size check compares against undefined, etc.

Fix: make all sub-config fields optional except `enabled`, add an internal `ResolvedBridgeConfig` type, and normalize every block with one field-by-field merge in an extracted `normalizeConfig()` module. Delete the `as Required<...>` casts.

**1.3 [FIXED] Outgoing middleware is bypassed for offline-queued messages, and the flush path re-delivers messages a middleware rejected**
`src/core/BridgeManager.ts:563-571, 588-594, 771-780`

`sendOutgoing` checked `navigator.onLine === false` BEFORE running the outgoing middleware chain and enqueued the raw message. `flushQueue` later sent queued messages straight to `sendMessageToAdapter`, justified by a comment claiming queued messages "already passed validation and middleware once", which was false for the offline path: they never ran middleware at all. Concrete trigger: a middleware that stamps an auth token or encrypts payloads; anything sent while offline was delivered after reconnect without the token/encryption. Additionally, the catch path (588-594) could not distinguish middleware errors from adapter errors, so a message a middleware intentionally rejected got enqueued and re-delivered later, bypassing the middleware's decision.

Fixed: Added `isFlushing` flag. Middleware now runs during flush by having `flushQueue` call through `sendOutgoing` (which runs middleware) instead of directly to adapter. Offline/failure enqueue paths check `!this.isFlushing` to prevent loops.

**1.4 [FIXED] Queue auto-flush ignores connectivity and permanently drops messages after 3 failed attempts while still offline**
`src/core/MessageQueue.ts:310-329, 176-185`, `src/core/BridgeManager.ts:212-215, 771-780`

`setupAutoFlush` fired every `flushInterval` whenever the queue was non-empty, with no `navigator.onLine` check, and `flushQueue` delivered straight to the adapter, bypassing `sendOutgoing`'s offline guard. `flush()` re-queued a failed message only while `attempts < 3`, then incremented `stats.failed` and dropped it forever. So if the adapter threw while offline, messages were burned through their 3 attempts in ~15s of downtime and silently discarded before the `online` event (the intended flush trigger) ever fired.

Fixed: Auto-flush timer now checks `navigator.onLine` before calling flush. The hardcoded `< 3` now uses `config.maxRetries` from the normalized config (default 3, configurable).

**1.5 [FIXED] Enabling batching silently defeats the offline queue: a failed batch envelope drops every message with zero retries**
`src/core/BridgeManager.ts:486-489, 563-571, 585-597`, `src/core/BatchManager.ts:89-96, 110-120`, `src/constants/protocol.ts:15-21`

Fire-and-forget sends went into `BatchManager` and `send()` immediately returned `{ success: true }`, even while offline (the batcher was consulted before any connectivity handling). The flushed envelope had type `PROTOCOL.BATCH`, which `isProtocolType` excluded from BOTH the offline-enqueue path and the catch-requeue path of `sendOutgoing`. When the adapter threw, the error landed in `BatchManager.flush`'s floating `.catch`, which only incremented `failedCount`: all N batched messages were dropped with no retry, while the same messages sent unbatched would have been queued. The two features were individually advertised as reliability/perf options but actively cancelled each other. Related: `destroy()` called `batchManager.destroy()` which cleared (not flushed) pending messages, silently discarding them.

Fixed: When a batch send fails, the batch is now unpacked and individual messages are enqueued. `BatchManager.flush` awaits the send and handles failures. `destroy()` now flushes pending batches before clearing.

**1.6 [PARTIAL] Default configuration is a logging black hole; `safeStringify` failure corrupts the wire message**
`src/utils/helpers.ts:35-54, 97-123`, `src/core/BridgeManager.ts:133`, `src/core/adapters/AndroidAdapter.ts:47`

`BridgeLogger.route` always logs errors (`this.debug || level === "error"`), but the default destination is `"devtools"` and that branch only does anything when a log callback is set, which happens solely when `devTools.enabled` is true. Net effect with out-of-the-box config: every error the library catches (incoming processing failures, adapter send failures, decompression failures) is silently discarded, and even `debug: true` produces no output. Separately, `safeStringify`/`safeParse` bypass the logger entirely and call `console.error` directly (ignoring `logDestination: "none"`), and `safeStringify` returns `"{}"` on failure; on the Android path that string IS the entire wire message, so a circular-reference payload silently sends `{}` (losing type, id, and payload) instead of erroring.

Fix: default `logDestination` to `"console"` when devtools is disabled (or fall back to console when no callback is registered). Move `logDestination` to top-level `BridgeConfig` (it is not really a devtools concern). Give the serialization helpers access to the logger, and make `safeStringify` failures throw (or return null and have the adapter treat that as a send failure) instead of fabricating `"{}"`.

Fixed so far: the `"devtools"` destination now falls back to console for error-level logs when no collector is registered, and the Android adapter uses plain `JSON.stringify` so a non-serializable payload fails the send loudly (matching iOS) instead of delivering `"{}"`. Remaining: `logDestination` still lives under `devTools` config, and `safeStringify`/`safeParse` still call `console.error` directly in their other (best-effort) call sites.

**1.7 [FIXED] `MetricsCollector.pendingTimings` grows without bound when `detailedTiming` is on**
`src/core/MetricsCollector.ts:47-52, 64-71`

`recordSent` inserts a timing entry for EVERY outgoing message when `detailedTiming` is enabled. Entries are removed only by a same-id inbound message, `recordFailed`, or `recordTimeout`. Fire-and-forget messages (the default send path) never get a same-id response, so their entries live forever: a steady, unbounded leak (an app emitting 10 events/sec gains ~36k map entries/hour). No TTL, sweep, or cap exists. (With batching enabled the leak is one entry per batch envelope instead, still unbounded.)

Fix: only start a timing when the send expects a response (plumb an `expectResponse` flag into `recordSent`, or drive timing off `ResponseManager.register/resolve/reject`). As a safety net, sweep entries older than the max response timeout on the existing `updateTimer` tick.

Fixed: `recordSent` now calls `evictStalePendingTimings()`, which drops entries older than a 60s TTL and caps the map at 1000 (oldest-first eviction). This bounds the map regardless of fire-and-forget volume. (The deeper "only time response-expecting sends" rework was left for later; the cap makes the leak non-fatal.)

**1.8 BridgeManager is an oversized orchestrator: 918 lines, ~145-line constructor, duplicated pipeline branches**
`src/core/BridgeManager.ts:54-899`

BridgeManager already delegates to nine collaborators but still directly owns: config normalization (86-131), the handshake state machine and ready-waiter bookkeeping (264-338), the incoming pipeline including batch unpacking and response routing (342-406), the outgoing pipeline with offline/queue policy (559-636), devtools/metrics wiring (171-210), a public logging facade (`log/warn/error/info`, 839-862), schema accessors (819-832), and module-level singleton management (902-917). The `middleware?.enabled` fork is duplicated verbatim in `handleIncomingMessage` (371-381) and `sendOutgoing` (574-584).

Fix (minimum viable extraction): (1) `normalizeConfig()` in its own module (pairs with 1.2); (2) a `ReadinessController` owning `ready`/`readyError`/`readyWaiters`/`handshakeTimer`/`startHandshake`; (3) an `OutgoingPipeline` composing queue-check, middleware, compression, adapter so each policy exists once. Drop the `log/warn/error/info` facade from the public surface (consumers have their own loggers; devtools capture can hang off `getDevTools()`).

### Medium

**1.9 [FIXED] Failed `expectResponse` send produces an unhandled promise rejection; reject() destroys the original Error**
`src/core/BridgeManager.ts:467-482`, `src/core/ResponseManager.ts:73-88`

In `send()`, `responsePromise` is created before sending. If `sendOutgoing` throws, the catch block rejects `responsePromise` and then `throw error`, so the (now rejected) `responsePromise` is never returned and nothing ever attaches a handler: every failed request fires a browser `unhandledrejection` event (or crashes strict test runners). Compounding it, `ResponseManager.reject(messageId, error: string)` takes a string, so BridgeManager flattens a real Error to `error.message` and ResponseManager wraps it in a fresh stack-less `new Error(...)`; `cause` and stack are lost.

Fix: attach `responsePromise.catch(() => {})` before rethrowing (or return the rejected promise instead of throwing separately). Change `ResponseManager.reject` to accept `Error` and pass the original through. While there: `onWithResponse` flattens non-Error throws to the literal `"Unknown error"` (BridgeManager.ts:720); use `String(error)` instead.

**1.10 [FIXED] Queue-full drop is silent: enqueue's boolean is discarded and the caller is told success**
`src/core/BridgeManager.ts:600-603`, `src/core/MessageQueue.ts:52-56`

`MessageQueue.enqueue` returned `false` when at `maxSize`, dropping the message with only a debug-level warn (invisible by default per 1.6). `BridgeManager.enqueue` ignored the return value, so `send()` resolved `{ success: true, id }` for a discarded message. For `expectResponse` sends routed through the catch-enqueue path, the pending response stayed registered and the caller waited the full timeout for a message that no longer existed.

Fixed: The enqueue return value is now checked. When `false`, metrics are updated and an error is thrown, causing proper failure handling for the caller.

**1.11 [FIXED] `destroy()` leaves the `getBridge()` singleton pointing at a dead instance; `send()` has no destroyed guard; `getBridge()` silently ignores config after the first call**
`src/core/BridgeManager.ts:866-898, 902-911`

`destroy()` never resets the module-level `bridgeInstance`, so every later `getBridge()` returns the destroyed instance: `waitForReady()` throws immediately, handlers are gone, `window.sendBridgeMessage` was deleted so incoming messages are silently dropped, and `send()` (no `destroyed` check) happily runs middleware and calls a destroyed adapter. Post-destroy enqueues also pile up in a queue whose auto-flush timer is permanently cleared. Separately, `getBridge(config)` discards the config whenever an instance exists, and the `bridgeInstance as BridgeManager<TSchemas>` cast lets a second caller claim a schema registry the instance was never built with. Typical trigger: React app calling `getBridge()` in components and `destroy()` on unmount; after remount the app gets a permanently dead bridge.

Fix: in `destroy()`, `if (bridgeInstance === this) bridgeInstance = null`. Add an `if (this.destroyed) throw` guard to `send()`/`sendOutgoing`. Warn (or throw) when `getBridge()` receives a config but an instance already exists. Export a `resetBridge()` for tests/HMR.

Fixed: `destroy()` now resets the singleton when it owns it, `send()` throws on a destroyed bridge, and `getBridge(config)` warns when an instance already exists. Covered by the "shared global lifecycle" tests in core-messaging.test.ts.

**1.12 `expectResponse` requests queued offline are delivered after the caller's timeout already rejected**
`src/core/BridgeManager.ts:563-571, 588-594`

When an `expectResponse` message is sent while offline (or the adapter throws with a queue configured), `sendOutgoing` silently parks it and returns normally, so the caller's response timeout keeps ticking (default 5000ms, equal to the default flushInterval). The queue later delivers the request, but by then the caller usually got "Request timed out"; the eventual response is discarded. Dangerous pattern: caller times out on `sendWithResponse("purchase")`, retries, and the native side executes the purchase twice.

Fix: either refuse to queue `expectResponse` messages (reject immediately with a distinct "offline" error so callers know it was never delivered), or pause the response timeout while queued and remove the message from the queue when the timeout fires.

**1.13 `compression.algorithm` is a dead option: "gzip" and "br" silently produce zlib-deflate**
`src/types/index.ts:403`, `src/core/CompressionManager.ts:37, 66`

The config advertises `algorithm: "gzip" | "deflate" | "br"` but `compress()` unconditionally calls `pako.deflate` (zlib format) and `decompress()` `pako.inflate`. A team that sets `"gzip"` and implements the native side accordingly (e.g. GZIPInputStream on Android) fails to decompress every outbound payload. `"br"` is not implementable with pako at all.

Fix: either honor the setting (`pako.gzip`/`pako.ungzip`, reject `"br"` at config time) or remove `algorithm` from the config entirely and document the wire format as zlib-deflate + base64. Removal is the simpler, honest option.

**1.14 [FIXED] `compress()` never verifies output is smaller than input; base64 overhead can inflate payloads**
`src/core/CompressionManager.ts:25-54`

Compression triggers on ORIGINAL size > threshold, then base64-encodes (+33%). For incompressible payloads above threshold (already-encoded images, random tokens), the wire message gets LARGER than the original and stats record a ratio > 1. Both sizes are already computed; the guard is one comparison.

Fix: `if (compressedSize >= originalSize) return null;` so `maybeCompress` falls back to the uncompressed payload.

Fixed: `compress()` now returns `null` when the base64 result is not smaller than the original, so an incompressible payload ships uncompressed.

**1.15 Synchronous pako deflate/inflate blocks the page's JS thread for exactly the large payloads compression targets**
`src/core/CompressionManager.ts:37, 66`

`compress()`/`decompress()` run synchronously inside the send and receive pipelines. Compression only activates above the threshold, i.e. precisely where deflate is expensive (tens of ms for a few hundred KB of JSON in a mid-range WebView), freezing the page's JS/rendering/input pipeline. Bursts of large incoming compressed messages serialize these stalls.

Fix: prefer native `CompressionStream`/`DecompressionStream` (async, off-thread; available in modern Android WebView and Safari 16.4+, matching the library's targets) with pako as fallback, or move pako into a Web Worker. Make compress/decompress async and await them in `maybeCompress`/`handleIncomingMessage`.

**1.16 Persisted queue rewrites all of localStorage synchronously on every enqueue (O(N^2) aggregate)**
`src/core/MessageQueue.ts:80-82, 276-296`

With `persist` enabled, every `enqueue` JSON.stringifies ALL queued messages and synchronously writes the whole blob. Filling the queue while offline (the primary use case) costs O(N^2) serialization: with maxSize 100 and 10KB payloads, the 100th enqueue stringifies ~1MB and cumulative churn is ~50MB, all in blocking main-thread writes.

Fix: coalesce persistence: mark dirty and flush on a trailing debounce (100-250ms), plus on `pagehide`/`visibilitychange` and after `flush()`. `destroy()` already saves, so shutdown persistence is preserved.

**1.17 Per-message serialization waste: payloads are stringified up to three times; two different byte-measuring idioms; per-call TextEncoder**
`src/core/BridgeManager.ts:50-52`, `src/core/CompressionManager.ts:27-39`, `src/core/adapters/AndroidAdapter.ts:47`

`wireSize` builds `new TextEncoder()` per call, stringifies the full message, and allocates a Uint8Array copy just to read `.length`; it runs for every sent AND received message when metrics are enabled. `CompressionManager.compress` independently stringifies the payload and measures it with `new Blob([json]).size` (a heavier allocation, and a second idiom for the same concept); for sub-threshold messages (the common case) that stringify is discarded and the Android adapter stringifies the whole message again. Worst case (compression + metrics, Android): three JSON.stringify passes per send.

Fix: add one `byteLength(str)` util backed by a module-level `TextEncoder` and use it everywhere (fast path: if `json.length >= threshold`, the UTF-8 length is also >= threshold, skip encoding). Longer term: serialize the message once in `sendMessageToAdapter`, pass the string to the adapter, and compute metrics from that same string; have adapters report raw string length for received size.

**1.18 [FIXED] `BridgeSendOptions.priority` ("HIGH") and the exported `MessagePriority` constant ("high") use different casings, so the natural usage is a type error and the cast-around drops messages**
`src/types/index.ts:73`, `src/constants/messagePriority.ts:5-9`, `src/core/BridgeManager.ts:601`, `src/core/MessageQueue.ts:67-71`

Options are typed `"HIGH" | "NORMAL" | "LOW"` while `MessagePriority.HIGH === "high"`. So `send(type, payload, { priority: MessagePriority.HIGH })` does not compile, and anyone who casts past it gets `MessagePriority["high"] === undefined`, which makes `MessageQueue.enqueue` hit `queue.get(undefined)` and drop the message with only an invisible-by-default log.

Fix (breaking): type the option as the lowercase `MessagePriority` union and pass it straight through, deleting the key-lookup translation at BridgeManager.ts:601.

Fixed (non-breaking): added `normalizePriority()` in messagePriority.ts that accepts BOTH the uppercase names and the lowercase constant values; `BridgeSendOptions.priority` now accepts both casings, and `enqueue` normalizes before use. `send(t, p, { priority: MessagePriority.HIGH })` now works. Covered by a new features-wiring test.

**1.19 [FIXED (BREAKING)] `bridge.batch()` is misnamed and resolves before the batch is actually sent**
`src/core/BridgeManager.ts:793-795`, `src/core/BatchManager.ts:58-99`

The public method named `batch()` actually flushes. It is `async` but awaits nothing: `BatchManager.flush()` is synchronous and fires `onFlush(batch)` as a floating promise with only a logging `.catch`. So `await bridge.batch()` returns before middleware/compression/adapter run, and failures surface only as a stats counter. Flush-before-navigation (the main use case) gets no reliable completion signal.

Fix: rename to `flushBatch()` (mirroring `flushQueue()`), make `BatchManager.flush` return the `onFlush` promise, await it, and reject on failure.

Fixed (breaking, see BREAKING_CHANGES.md #1): renamed `batch()` → `flushBatch()`; `BatchManager.flush()` is now async, awaits the send, resolves after the envelope is actually sent, and rejects on failure. Auto-flush paths use an internal `flushSafely()` that swallows (already-logged) rejections; `destroy()` flushes pending batches before teardown instead of dropping them (also closes 1.5's destroy-drop).

**1.20 [PARTIAL] Duplicate public API: `use()` and `addMiddleware()` are the same method; neither is on `IBridgeManager`**
`src/core/BridgeManager.ts:743-749`, `src/types/index.ts:207-271`

`addMiddleware` is a one-line alias for `use` with no `@deprecated` tag and no canonical designation (docs present them as interchangeable). Neither appears on the `IBridgeManager` interface.

Fix (breaking): keep `use()` (Express/Koa convention), delete `addMiddleware()`, add `use()`/`getMiddlewareCount()` to `IBridgeManager` if they are part of the contract.

Fixed so far: `addMiddleware()` now carries an `@deprecated` tag pointing to `use()` (kept as an alias rather than deleted, to avoid a hard break). The `IBridgeManager` interface expansion (6.2) is deferred to a deliberate breaking release.

**1.21 [FIXED] Request/response correlation via magic string suffixes is a leaky implicit protocol**
`src/core/BridgeManager.ts:398-399, 706-710, 716-723`, `src/react/createBridgeHooks.ts:295`, `src/constants/protocol.ts`

The `_response`/`_error` suffix convention is hardcoded at four sites and never appears in `constants/protocol.ts`, whose header claims to be the wire contract's home. A consumer event type that happens to end in `_error` (e.g. `sync_error`) is classified as a response and, if its id ever matches a pending request, is swallowed by ResponseManager instead of dispatched.

Fix: hoist `RESPONSE_SUFFIX`/`ERROR_SUFFIX` and an `isResponseType()` helper into `constants/protocol.ts` and use them at all sites; document the convention for native implementers. Longer term, mark responses structurally on the envelope (`replyTo: id`) so user type names can never collide (pairs with 1.1).

**1.22 [PARTIAL] Metrics are computed on the wrong events: successRate is stale, can read 100% while everything fails, and can go negative; messagesPerSecond never decays**
`src/core/MetricsCollector.ts:41-55, 74-89, 104-126`

(1) `updateSuccessRate` only runs on failure/timeout, so after one failure the rate stays frozen no matter how many successes follow, and the periodic broadcast pushes the stale value forever. (2) `messagesSent` increments only after a successful `adapter.send`, while `recordFailed` fires in paths where `recordSent` never ran: with an always-throwing adapter, sent stays 0 and the `total > 0` guard reports successRate 1 (100%) while everything fails; mixed traffic can push it negative (2 sent, 5 failed = -1.5). (3) `updateMessagesPerSecond` only runs inside `recordSent`, so when traffic stops the rate freezes at its last value instead of decaying to 0.

Fixed (1) and (2): `updateSuccessRate` now uses `succeeded / (succeeded + failed)` and is also called from `recordSent`, so the rate recovers after successes, never reads 100% while everything fails, and can never go negative. Covered by two new metrics tests in features-wiring.test.ts. Remaining (3): `messagesPerSecond` still only recomputes on send, so it does not decay to 0 when traffic stops (needs the periodic `updateTimer` tick to recompute).

Fix: track attempts at the top of `sendOutgoing`; compute `successRate = (attempts - failed) / attempts` clamped to [0,1], derived inside `getMetrics()` instead of cached. Recompute `messagesPerSecond` in the periodic tick. Only count a message failed when finally dropped, not when queued for retry.

**1.23 [FIXED] Decompression or incoming-middleware failure on a response silently strands the pending request until timeout**
`src/core/BridgeManager.ts:240-244, 366-369`, `src/core/CompressionManager.ts:63-74`

`decompress` rethrows on corrupt data; the rejection is swallowed by the adapter-callback catch, which only logs (into the default log black hole per 1.6). If the corrupted message was a `_response`, the caller learns nothing until the generic timeout. Same story when a user's incoming middleware throws while processing a response.

Fix: before decompressing/running incoming middleware, note whether `message.id` matches a pending response; on failure, `responseManager.reject(id, decodeError)` instead of letting it time out.

**1.24 [FIXED] Compressed entries inside an incoming batch envelope are never decompressed**
`src/core/BridgeManager.ts:365-369, 385-396`

Decompression happens once at the top of `handleIncomingMessage`, but batch unpacking recurses into `processIncomingMessage`, which has no decompression step. A batch entry with `__compressed: true` is dispatched with raw base64 as its payload (or resolves a pending response with base64 garbage). Both BATCH and `__compressed` are documented wire contracts, so a native host that compresses entries inside a batch hits this.

Fix: move the `__compressed` handling into `processIncomingMessage` (or apply it to each entry before recursing).

**1.25 [FIXED] `MessageQueue.flush` has no try/finally on the `flushing` flag; corrupted persisted data wedges the queue forever**
`src/core/MessageQueue.ts:146, 163-190, 237-274`

`flushing = true` was only reset at the end of the loop; there was no finally. `loadFromStorage` pushed JSON-parsed entries into the queue with zero shape validation, so a corrupted/legacy localStorage value (entry missing `message`) made both `sendFn` and the per-message catch handler throw (`queuedMessage.message.type` dereference at line 171), escaping the loop with `flushing === true` permanently. Every subsequent flush early-returned "Already flushing"; the queue was dead until page reload (and the poison data persisted across reloads).

Fixed: Added try/finally around the flush loop body to ensure the flag is always reset. The `isFlushing` flag in BridgeManager also prevents concurrent flush attempts.

**1.26 Persisted queue is not multi-tab safe: duplicate delivery and silent loss**
`src/core/MessageQueue.ts:243, 292`

Every tab with the same `storageKey` loads the entire persisted queue at construction and rewrites the whole key on every enqueue/flush with no locking or `storage`-event coordination. Two tabs that both load persisted messages will both deliver them (duplication); a tab saving its own snapshot overwrites messages another tab enqueued meanwhile (loss).

Fix: claim persisted messages atomically (remove the key immediately after load), or use a per-tab suffix with a takeover protocol via the `storage` event; at minimum document that `persist` must not be used by apps that can run in multiple tabs/WebViews on one origin.

### Low

**1.27 MessageQueue internals: priority order duplicated 3x, hardcoded retry cap, stats restored blindly from storage, dead members**
`src/core/MessageQueue.ts:19-23, 95-127, 151-155, 177, 268`

The literal `[HIGH, NORMAL, LOW]` array is written out in `dequeue`, `peek`, and `flush`, with the same order encoded again in the Map initializer; adding/reordering a priority silently strands messages (accepted by enqueue, never flushed). The retry cap is a magic `3` not exposed in QueueConfig. `loadFromStorage` restores `stats` verbatim from disk (stale `pending` counts). `dequeue()` and `peek()` are never called by anything (dead code), `QueuedMessage.retries` is set to 0 and never used (dead field), and `dequeue` updates `stats.size` but not `stats.pending` (inconsistent with `flush`).

Fix: hoist `const PRIORITY_ORDER = [...] as const` and derive both the Map initializer and all iteration from it; add `maxRetries?: number` (default 3) to QueueConfig; recompute stats from actually-loaded messages; delete `dequeue`, `peek`, and `retries` (or wire them up to something real).

**1.28 [FIXED] Middleware `next()` has no reentrancy guard: calling it twice duplicates the send and skips middlewares**
`src/core/MiddlewareManager.ts:29-58`

A single mutable `index` is shared by every `next()` invocation. A middleware that calls `next()` twice (a classic retry/timing-middleware bug) sends the message to the adapter twice and skips intermediate middlewares on the second pass. Koa-style `dispatch(i)` guards against exactly this.

Fix: per-frame dispatch with an "already called" check that throws `next() called multiple times`.

Fixed: replaced the shared mutable `index` with recursive per-position `dispatch(i, msg)`. Each `next()` runs the remainder of the chain from the caller's fixed position, so siblings can never be skipped (the actual bug). Note: a deliberate re-call of `next()` re-runs downstream from that point rather than throwing, because the shipped `retryMiddleware` relies on that to re-drive the transport; the chain is snapshotted per run so concurrent `use()`/`clear()` cannot corrupt it. Covered by the new middleware.test.ts chain-semantics tests.

**1.29 `middleware.enabled` is a near-useless flag that forces duplicated branching; `MiddlewareContext.bridge` is typed `unknown`**
`src/core/MiddlewareManager.ts:25-27`, `src/core/BridgeManager.ts:371-381, 574-584`, `src/types/index.ts:190, 276-279`

`execute` already short-circuits when no middleware is registered, so the flag only matters for the incoherent combination "register middleware AND disable the system" (which `use()` still silently accepts and counts). The flag's existence duplicates the `middleware?.enabled` fork in two pipelines. Separately, `MiddlewareContext.bridge: unknown` forces every middleware author to cast.

Fix (breaking): delete `MiddlewareConfig`; registering no middleware is the off switch. Type `bridge` as `IBridgeManager` (a type-only import creates no cycle).

**1.30 `off(type, handler)` cannot remove handlers registered via `onWithResponse`**
`src/core/BridgeManager.ts:698-735`

`onWithResponse` registers a wrapper; the Set is keyed by function identity, so `off(type, originalHandler)` deletes nothing while still logging "Removed handler". Natural symmetric usage (register on mount, `off` on unmount) accumulates stale wrappers that all answer each request.

Fix: keep a WeakMap from user handler to wrapper and translate in `off()`; or document that `onWithResponse` is only removable via the returned subscription and make `off()` warn when the handler was not found.

**1.31 [FIXED] `ResponseManager.register` overwrites duplicate ids, leaving one caller's promise permanently unsettled**
`src/core/ResponseManager.ts:28-44`

A second `register` with the same id orphan's the first entry's resolve/reject, and the first entry's still-armed timeout then deletes the SECOND registration (its guard is a bare `has()`). Currently only reachable via a same-millisecond `Math.random` collision in `generateMessageId` (helpers.ts:9-11), so severity is low, but it becomes real the moment caller-supplied ids are accepted anywhere.

Fix: key the timeout closure to its own entry object (`get(id) === entry` check); reject-and-replace or refuse on duplicate registration. Consider `crypto.randomUUID()` (with fallback) for id generation.

**1.32 Incoming batch entries are dispatched sequentially: head-of-line blocking that non-batched delivery does not have**
`src/core/BridgeManager.ts:389-393`

Each batch entry is awaited in turn, and each dispatch awaits all its handlers. One slow handler on entry 1 delays entry 10 by its full duration, even though batched messages are by construction fire-and-forget and independent, and non-batched incoming messages are NOT serialized against each other.

Fix: if ordering is not an intended guarantee, dispatch entries without awaiting each (collect promises, `Promise.allSettled` at the end). If ordering IS intended, document it.

**1.33 Rolling response-time average uses shift() + full reduce per sample**
`src/core/MetricsCollector.ts:91-102`

Bounded (window of 100, and `detailedTiming` is off by default) so the absolute cost is tiny, but it is pure per-response overhead in a hot path and the 100 is an unexported magic number.

Fix: running sum + circular buffer for O(1) updates; name the constant.

**1.34 DevTools history is count-bounded but byte-unbounded, pinning live payload references**
`src/core/BridgeDevTools.ts:130-135, 206-253`

Message history retains live references to up to 50 payloads (multi-MB payloads stay pinned), and console interception retains up to 100 arbitrary argument object graphs. Dev-mode only (devtools is force-disabled in production builds), so memory-pressure, not a leak.

Fix: store size-capped snapshots (truncated preview + byte count above a few KB) instead of live references.

**1.35 Handshake defaults duplicated; magic 10000 appears three times with two meanings**
`src/core/BridgeManager.ts:93-95, 290, 322`

Constructor normalizes handshake timeout/retryInterval, `startHandshake` re-defaults the identical literals (partly forced by the shallow `Required<>` typing), and `waitForReady`'s default parameter is a conceptually different timeout that coincidentally equals 10000.

Fix: named constants (`DEFAULT_HANDSHAKE_TIMEOUT_MS`, `DEFAULT_HANDSHAKE_RETRY_MS`, `DEFAULT_READY_TIMEOUT_MS`) in one module; a properly typed resolved config (1.2) removes the forced re-defaulting.

**1.36 Schema validation block duplicated between send() and sendWithResponse(); response validation only happens on one of the two paths**
`src/core/BridgeManager.ts:444-454, 539-549`

The lookup-and-validate block is near-verbatim in both methods, and a consumer calling `send(type, payload, { expectResponse: true })` gets unvalidated response data while `sendWithResponse` validates it. (The type signatures do differ, so this is a runtime-consistency and duplication issue, not a type-safety lie.)

Fix: extract `private validateStage(type, value, stage)` and apply response validation inside send()'s `expectResponse` branch too.

**1.37 JSDoc effort is inverted: noise on overloads, silence on behavior that needs explaining**
`src/core/BridgeManager.ts:414-436, 640-693, 767-807`

The overload trios carry three JSDoc blocks each saying only "typed version"/"untyped version"/"implementation", while genuinely surprising behavior is undocumented at the class level: `flushQueue` bypassing middleware (explained only in an internal inline comment), `onMetricsUpdate` returning an unsubscribe function, `waitForReady` semantics changing entirely with `handshake.enabled`, `off` vs `removeAllListeners`. (Some one-liners are inherited from IBridgeManager via quick-info, but the substantive behavior notes exist nowhere consumer-visible.)

Fix: collapse per-overload noise into one doc block per method; document the behaviors above where consumers will see them.

**1.38 Dead code and unreachable guards**
`src/utils/helpers.ts:26-33`, `src/core/BatchManager.ts:28-30`, `src/core/MessageQueue.ts:47-49, 95-127`, `src/core/ResponseManager.ts:98-109`

- `createTimeoutPromise` is exported and used by nothing in src.
- `BatchManager.add` throws "Batching is not enabled" and `MessageQueue.enqueue` returns false when `!config.enabled`, but both objects are only ever constructed when enabled: unreachable branches (and inconsistent failure styles: throw vs boolean).
- `MessageQueue.dequeue`/`peek`/`QueuedMessage.retries`: dead (see 1.27).
- `ResponseManager.clear` iterates the map twice back-to-back (clearTimeout loop, then reject loop); one loop suffices.

Fix: delete dead exports/members, convert unreachable guards into a single consistent invariant style or remove them, merge the double loop.

---

## Part 2: Platform adapters and platform detection

Files: `src/core/adapters/*`, `src/core/PlatformDetector.ts`, `src/utils/platform.ts`, `src/utils/env.ts`.

### High

**2.1 [FIXED] IframeAdapter accepts messages from a parent of ANY origin when `iframeParentOrigin` is not configured**
`src/core/adapters/IframeAdapter.ts:26-41`

The receive listener checks only `event.source !== window.parent`; the origin check runs solely when `parentOrigin` is configured, and nothing forces or even warns about configuring it on the receive side. If the app can be embedded by arbitrary sites (no frame-ancestors restriction), a hostile parent page can inject any bridge message: invoke registered handlers with attacker-chosen payloads, answer pending `sendWithResponse` calls by echoing ids, or complete the handshake. This is the classic embedded-bridge vulnerability and the current default is insecure.

Fix: make `iframeParentOrigin` required to use the iframe transport (constructor/config-time error when the detected platform is iframe and no origin is set), or at minimum warn loudly on receive (not only on send) and document the threat model. An `iframeParentOrigin: "*"` explicit opt-in can keep the old behavior for same-team embedding scenarios.

Fixed: incoming messages are now rejected unless the origin matches the configured `parentOrigin` (or the app explicitly opted into `iframeParentOrigin: "*"`), and a `console.warn` fires when no origin is set so the insecure default is visible.

**2.2 [FIXED] IframeAdapter sends with wildcard targetOrigin `"*"` by default**
`src/core/adapters/IframeAdapter.ts:43-53`

`send()` posts with `this.parentOrigin ?? "*"`, so with default config every bridge message (exactly the sensitive app/host traffic, including `onWithResponse` results) is delivered to whatever origin occupies the parent frame. The only guardrail is `logger?.warn(...)`, which under the default config goes to the log black hole (see 1.6) and also fires on every send (log spam once visible).

Fix: never default to `"*"`. Throw on iframe send when no `parentOrigin` is configured (pairs with 2.1), require an explicit `"*"` opt-in, and emit the opt-in warning once via `console.warn` rather than through the suppressible logger.

Fixed: `send()` now throws when `parentOrigin` is unset instead of posting to `"*"`. The wildcard is available only via an explicit `iframeParentOrigin: "*"`, which emits a one-time `console.warn` at construction.

**2.3 [FIXED] The hardcoded `window.sendBridgeMessage` global: a second bridge instance silently disconnects the first, and either instance's destroy() deletes the survivor's receive channel**
`src/utils/helpers.ts:65-83`, `src/core/adapters/AndroidAdapter.ts:26, 51-55`, `src/core/adapters/IOSAdapter.ts:25, 57-61`

`attachSendBridgeMessageFnToWindow` unconditionally assigns the hardcoded name `window.sendBridgeMessage` (not derived from the configured `androidInterface`/`iosHandler`). `createBridge()` is public and non-singleton, so two instances are legal: the second `initialize()` clobbers the first instance's receive function (its `sendWithResponse` calls all start timing out with no pointer to the cause), and BOTH adapters' `destroy()` unconditionally `delete window.sendBridgeMessage`, killing native-to-web delivery for any surviving instance.

Fix: have the attach helper return the installed function; store it on the adapter and only delete when `window.sendBridgeMessage === ownFn`. Warn when attaching over an existing function. Consider deriving the receive-function name from config so independent bridges get independent channels, and document the full wire contract in one place (outgoing: Android JSON-string via `window[androidInterface].postMessage`, iOS raw object via `webkit.messageHandlers[handler].postMessage`; incoming: `window.sendBridgeMessage(json)`).

Fixed: `attachSendBridgeMessageFnToWindow` returns the installed function and warns when overwriting an existing one; both adapters store the reference and `destroy()` deletes the global only when it still owns it. Covered by the "shared global lifecycle" tests. (The per-config channel name idea was not taken: the global's name is a documented wire contract with existing native hosts.)

**2.4 [FIXED] IframeAdapter.send() silently drops messages when not in an iframe; every other adapter throws**
`src/core/adapters/IframeAdapter.ts:43-53`

When `window.parent` is missing or equals `window`, IframeAdapter logs a (default-invisible) warn and returns normally. The other three adapters throw, and WebAdapter's own comment explains why: fail loudly instead of letting `send()` report success while `sendWithResponse()` times out mysteriously. This also defeats BridgeManager's retry path: `sendOutgoing` only parks a message in the offline queue when `adapter.send()` THROWS, so these drops bypass the queue entirely. Realistic trigger: the app boots inside an iframe (adapter selected), then the embedding relationship changes (e.g. the frame is reparented into the top window via navigation).

Fix: throw, matching the other adapters, and document the throw contract on `IPlatformAdapter.send()`.

Fixed: `send()` now throws when not inside an iframe (`window.parent === window`), matching the other adapters and letting the offline-queue retry path engage.

### Medium

**2.5 [FIXED] `hasAndroidBridge` accepts ANY object named `AndroidBridge` (including named DOM elements); platform selection can be hijacked on an ordinary web page**
`src/utils/platform.ts:23-30`, `src/core/adapters/AndroidAdapter.ts:41-48`

The check is `interfaceName in window && typeof window[interfaceName] === "object"`. Browsers expose any DOM element with `id="AndroidBridge"` as `window.AndroidBridge` (an HTMLElement, typeof "object"), and any unrelated global object with that name also passes. Because `detectPlatform` checks Android FIRST, such a collision routes an ordinary web/iframe page to AndroidAdapter, whose `send()` then throws on the missing `postMessage`. Note: `typeof null === "object"` also passes, which is the only thing the `!bridge` check at AndroidAdapter.ts:41 actually catches.

Fix: tighten detection to `typeof window[interfaceName]?.postMessage === "function"` and mirror the same guard (with a descriptive error) in `AndroidAdapter.send`.

Fixed: `hasAndroidBridge` now requires `typeof candidate?.postMessage === "function"`, and `AndroidAdapter.send` mirrors the guard with a descriptive error.

**2.6 [FIXED] `safeStringify` fallback sends the literal string `"{}"` as the entire wire message on Android**
`src/utils/helpers.ts:35-42`, `src/core/adapters/AndroidAdapter.ts:47-48`

Covered as part of 1.6 but worth its own fix on the adapter: a circular or BigInt payload results in `"{}"` being posted natively (no type, no id), the JS side reports success, and any `expectResponse` call times out with zero diagnostics. It is also platform-asymmetric: on iOS the raw object goes to `postMessage`, where WebKit throws a visible error for non-serializable bodies.

Fix: in the send path, let stringify failures throw (include `message.type` in the error) so they propagate like every other adapter failure. Reserve the swallowing variant for best-effort contexts (metrics/logging) under a different name.

Fixed: `AndroidAdapter.send` now calls `JSON.stringify` directly, so a non-serializable payload throws and propagates through the send path (matching iOS) instead of delivering `"{}"`.

**2.7 `parseMessage` duplicated between IframeAdapter and WebAdapter with divergent behavior; Android/iOS adapters duplicate identical lifecycle bodies**
`src/core/adapters/IframeAdapter.ts:63-82`, `src/core/adapters/WebAdapter.ts:69-74`, `AndroidAdapter.ts:24-27, 51-55`, `IOSAdapter.ts:23-26, 57-61`

IframeAdapter accepts object frames AND JSON-string frames; WebAdapter accepts only objects and silently drops strings (its logger is entirely unused, see 2.12). The listener add/remove/null lifecycle is copy-pasted between the two postMessage adapters, and `initialize`/`destroy` are byte-identical between Android and iOS adapters. Copy-divergence has already produced the string-frame inconsistency.

Fix: introduce two small bases: a `PostMessageAdapter` (listener lifecycle + one shared `parseMessage` accepting object and JSON-string frames) and a `NativeGlobalAdapter` (shared receive-function attach/detach per 2.3).

**2.8 Platform priority order is encoded twice; `getPlatform()` reports via a different mechanism than the one that picked the adapter**
`src/utils/platform.ts:42-57`, `src/core/PlatformDetector.ts:21-23, 52-59`

`detectPlatform()` hardcodes android > ios > iframe > web, and `getAllAdapters()` re-encodes the same priority as array order. `BridgeManager.getPlatform()` reports via the first path while traffic flows through an adapter chosen by the second; they agree today only because both delegate to the same predicates, and any future edit to either list silently desynchronizes them.

Fix: single source of truth: derive `getPlatformInfo().platform` from the already-selected adapter's `getPlatformType()`, and cache the result (see 2.11).

**2.9 `isIOS()` returns false on all modern iPads; `isAndroid()` matches plain Chrome tabs; both are exported as public API**
`src/utils/platform.ts:3-11`, `src/index.ts:122, 124`

iPadOS 13+ defaults to a desktop Macintosh UA, so `/iPhone|iPad|iPod/` misses the entire modern iPad fleet; `isAndroid()` matches any Android browser, not just a WebView. Adapter selection is unaffected (it keys off bridge-object presence), which makes these exported helpers a trap: consumers will naturally use them for "am I in the native app?" branching and get wrong answers.

Fix: add the standard iPadOS check (`navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1`), document both as OS heuristics rather than bridge detection, and point consumers to `getPlatformInfo()`/`hasAndroidBridge()`/`hasIOSBridge()`; or stop exporting the raw UA helpers.

**2.10 PlatformDetector and adapter constructors take long, inconsistently ordered positional parameter lists; BridgeManager bypasses its own normalized config**
`src/core/PlatformDetector.ts:13-19`, `src/core/BridgeManager.ts:217-223`

PlatformDetector takes five positional params where three are plain strings (transpositions of `androidInterface`/`iosHandler`/`iframeParentOrigin` type-check fine). Each adapter orders its params differently: (name, logger), (logger, parentOrigin), (flag, logger). BridgeManager also passes raw `config.iframeParentOrigin` (line 222) instead of the normalized `this.config` value it constructed 90 lines earlier.

Fix: replace positional lists with one options object (`{ androidInterface, iosHandler, webLoopback, iframeParentOrigin, logger }`); stop wrapping optional-by-design fields in `Required<>` (pairs with 1.2).

### Low

**2.11 Redundant per-message and per-call detection work**
`src/core/adapters/AndroidAdapter.ts:29-48`, `src/core/adapters/IOSAdapter.ts:28-55`, `src/core/PlatformDetector.ts:21-35`

`AndroidAdapter.send` resolves the bridge object three times per message (isAvailable, re-read, null check); `IOSAdapter.send` walks the `webkit.messageHandlers` chain twice (and those lookups cross WebKit's binding layer). `getPlatform()` re-runs full detection and allocates a fresh PlatformInfo on every call even though the adapter is fixed at construction. All small in absolute terms; the fix is mostly simplification: one lookup + null check per send, and compute PlatformInfo once (derive from the active adapter per 2.8).

**2.12 Dead and inert code in the adapter layer**
`src/core/PlatformDetector.ts:37-50, 61-64`, `src/core/adapters/WebAdapter.ts:13`

- `PlatformDetector.getAdapterForPlatform()` and `isPlatformAvailable()` have zero callers in src (and PlatformDetector is not exported from index.ts); the switch is yet another copy of the platform list.
- `WebAdapter` accepts `_logger` and ignores it, yet PlatformDetector dutifully passes one at three call sites; WebAdapter's parse-rejects are therefore invisible even in debug mode.
- `createTimeoutPromise` (see 1.38).

Fix: delete the unused methods (or export PlatformDetector deliberately and test it); wire WebAdapter's logger into its parse-reject path or drop the parameter.

**2.13 jsdom-specific origin exception ships in production code; SSR guards are inconsistent across adapters**
`src/core/adapters/WebAdapter.ts:27-32`, `src/core/adapters/IframeAdapter.ts:26`

The loopback listener accepts `event.origin === ""` purely as a jsdom workaround, coupled to the same `webLoopback` flag the WebAdapter error message tells real users to enable for local development (practical widening is near-nil in real browsers, which report opaque origins as `"null"` not `""`, but it is a test-runner quirk baked into shipped code). Separately, Android/iOS `initialize()` guard `typeof window === "undefined"` while Iframe/Web adapters do not (they are protected only by BridgeManager's own early return).

Fix: handle the jsdom quirk in test setup instead, and put the SSR guard in exactly one place (the shared base from 2.7, or document the window guarantee on `IPlatformAdapter.initialize`).

**2.14 [FIXED] `isValidMessage` accepts any object with a string `type`: foreign postMessage traffic flows into bridge handlers**
`src/utils/helpers.ts:56-63`

WebAdapter listens to ALL same-origin window messages and IframeAdapter to all (origin-validated) parent messages; any other library using the ubiquitous `{ type: "..." }` envelope (dev-server clients, analytics SDKs, extension content scripts) passes `isValidMessage` and is dispatched into bridge handlers; a foreign message whose type ends in `_response` with a colliding id could even settle a pending request. `id` and `timestamp` are never validated.

Fix: stamp a protocol discriminator (e.g. `__nbridge: 1` or a configurable channel key) in `createMessage()` and require it in the postMessage-based adapters' `parseMessage`; validate `id` is a string when present. (Native-global adapters can stay lenient for backward compat with existing native shells, but document it.)

---

## Part 3: Host subsystem (`src/host/`)

Files: `HostRulesEngine.ts`, `resolve.ts`, `sources.ts`, `version.ts`, `types.ts`, `host/index.ts`.

> Fix status: 3.11 (prototype-name crash) is fixed. The remaining Part 3 items are mostly DX and breaking API-shape changes (generic-parameter order 3.2, capability/variant grammar 3.3/3.4, trait-value enforcement 3.5, dunder-method promotion 3.6, override semantics 3.7, config-shape unification 3.9, storage-key scoping 3.1, etc.). They are deferred to a deliberate breaking host-API release rather than applied piecemeal, because the host subsystem has extensive tests keyed to the current shapes and these changes are best coordinated. They remain accurate as written.

### Medium

**3.1 [FIXED (BREAKING)] `versionFromQuery` default sessionStorage key ignores the param name; distinct version sources collide**
`src/host/sources.ts:95-104` vs `sources.ts:116`

`versionFromQuery(param)` always defaults to the fixed key `nbridge:host-version`, while `traitFromQuery` correctly scopes per param (`nbridge:trait:<param>`). Two engines on one origin using different params (micro-frontends in one tab session) read/write the same slot: app A persists its version, app B later resolves A's version as its own.

Fix: param-scoped default key, mirroring traitFromQuery (`nbridge:host-version:<param>`), with a migration note.

Fixed (breaking, see BREAKING_CHANGES.md #4): non-`hv` params now default to a param-scoped key `nbridge:host-version:<param>`; the canonical `hv` keeps the unscoped key for back-compat. Pass an explicit `storageKey` to preserve the old shared key.

**3.2 Generic parameter order flips between `HostRulesConfig` and `HostRules`**
`src/host/types.ts:121-131` vs `types.ts:216-220`, `HostRulesEngine.ts:208-214`, `src/react/createHostHooks.tsx:60-64`

Config and `defineHostRules` are `<TTraits, TCaps, TVariants>`; the returned `HostRules` and `createHostHooks` are `<TCaps, TVariants, TTraits>`. Anyone writing explicit annotations must remember two orders for the same three parameters, and a swap can compile silently because every parameter has a permissive default constraint.

Fix (breaking): one canonical order everywhere (declaration order: `TTraits, TCaps, TVariants`). Do it before the API calcifies.

**3.3 `CapabilityRule` mixes platform keys and `when` in one flat object, forcing runtime key dispatch, four casts, and silent acceptance of typo'd platform keys**
`src/host/types.ts:73-75`, `src/host/HostRulesEngine.ts:67-79`

Because platform values and the trait gate share one bag, `compileCapabilities` iterates `Object.entries`, string-matches `key === "when"`, and needs four casts to recover what the types knew. In plain JS (or configs built via spread where excess-property checks don't fire), a typo like `webb: true` compiles into a dead platform that never matches, silently.

Fix (breaking): separate them: `{ on: { android: ">=8.2", ios: true }, when: { traits: ... } }`. Reject unknown platform keys at compile time with an error naming the capability.

**3.4 Capabilities and variants use two different rule grammars; no platform-independent capability**
`src/host/types.ts:58-86`

Variants get a uniform `when: { platform?, version?, traits? }`; capabilities are a platform-keyed map whose `when` supports only traits. Consequences: a trait-only capability must enumerate all four platforms; a cross-platform version gate must repeat the constraint four times; two mental models for one engine.

Fix (breaking): add an `all`/`default` platform key, or better, converge capabilities on the variant grammar so `CapabilityWhen` can carry platform and version too.

**3.5 Trait `values` are documented as constraining but never enforced; trait value types don't flow to `setTrait`/`useTrait`**
`src/host/types.ts:21-27, 255`, `HostRulesEngine.ts:148-164`, `createHostHooks.tsx:99`

The docs say a `values` list "both constrains and types the accepted values"; at runtime it is kept only for `__introspect`. An out-of-domain source value (wrong case query param, arbitrary user-supplied input) lands verbatim in `info().traits` and just fails every rule with no signal. On the type side, the domain typing applies only inside `TraitMatch`: `setTrait` accepts any `string | null` and `useTrait` returns `string | null`.

Fix: enforce at resolution (out-of-domain resolves to null, dev-mode warning) and thread `TraitValue<TTraits[K]>` through `setTrait`/`useTrait`; or fix the docs to drop "constrains".

**3.6 Dunder-prefixed methods are the only supported path for load-bearing consumer use cases**
`src/host/types.ts:260-264`, `createHostHooks.tsx:73-103`

`__setOverride` is documented as "the only supported override mechanism" (and the package's own test suite drives nearly every scenario through it); `__serverSnapshot` is required by the shipped React bindings. An app unit-testing its own capability gates has no non-dunder way to force a platform, yet the naming signals "private, unstable".

Fix (breaking): promote `__setOverride` to `setOverride` (or a `host.testing` namespace). `__serverSnapshot`/`__introspect` may stay dunder since they're reachable only via shipped bindings, but document that contract.

**3.7 [FIXED (BREAKING)] Override semantics: key-presence (`"version" in override`) makes `version: undefined` force unknown, contradicting the engine's own convention for capability rules**
`src/host/resolve.ts:116, 125-126, 95-97, 142-145`

`__setOverride({ platform: "ios", version: maybeUndefined })` behaves differently from omitting the key: presence-with-undefined forces the version to null. Capability compilation deliberately treats explicit `undefined` as absent (`HostRulesEngine.ts:80-83`), and even within `resolveHost`, `override.platform` uses value semantics while version/traits use presence semantics.

Fix: one convention: treat explicit `undefined` as absent everywhere (`!== undefined` instead of `in`), keep `null` as the explicit "force unknown" marker (matching `setVersion(null)`), document on `HostOverride`.

Fixed (breaking, see BREAKING_CHANGES.md #3): version and trait overrides now use value semantics (`!== undefined`), so `undefined` means "leave source/explicit value in effect" and `null` forces unknown, consistent with `override.platform` and the capability-compile convention.

**3.8 `info().version` is the raw string gated on parse success; the normalized parse and the parser utilities are unreachable**
`src/host/resolve.ts:29, 150`, `HostRulesEngine.ts:178-186`, `src/host/version.ts`

`version` can legitimately be `"v8.2"` or `" 8.2 "` (parseVersion tolerates trim/leading-v), so `info().version === "8.2.0"` comparisons surprise. The normalized `ParsedVersion` exists on `ResolvedHost.parsed` but `toInfo` strips it, and `parseVersion`/`satisfies` are not exported.

Fix (breaking): expose the parsed form on `HostInfo` (or make `version` the normalized string), export `parseVersion`/`satisfies`, and if both string fields stay, rename to communicate the gating (`version` vs `versionRaw` does not).

**3.9 Platform-detection knobs configured twice in two shapes across `BridgeConfig` and `HostRulesConfig`; the two subsystems can disagree about the platform**
`src/types/index.ts:98-104`, `src/host/types.ts:110-115, 141`

BridgeConfig takes `androidInterface`/`iosHandler` flat; HostRulesConfig nests the identical options under `platform:`. An app using both must repeat the strings in two shapes; if they drift, BridgeManager and the host engine call `detectPlatform` with different arguments and report different platforms.

Fix: unify the shape, and/or let `HostRulesConfig.platform` accept a platform source (`() => BridgePlatform` or a BridgeManager) so the two cannot desynchronize.

### Low

**3.10 Empty query param value (`?hv=`) clobbers a previously persisted good version**
`src/host/sources.ts:67`

`URLSearchParams.get` returns `""` for `?hv=`; the code checks only `!== null`, so an empty value overwrites the stored good version and parses to null: from that navigation on, every version gate denies for the rest of the session.

Fix: treat `""` (after trim) as absent and fall through to the stored value.

**3.11 [FIXED] `supports()`/`variant()` with prototype-inherited names ("constructor", "toString") throw TypeErrors instead of behaving as documented**
`src/host/HostRulesEngine.ts:61, 106, 262-273`

Compiled maps are plain `{}` literals, so `compiledCapabilities["constructor"]` returns `Object.prototype.constructor`, passes the `=== undefined` guard, and `evaluateCapability` throws a TypeError (instead of `supports` returning false; for `variant` the clear "Unknown variant" error is replaced by an opaque TypeError). Only reachable with dynamic names, hence low.

Fix: `Object.create(null)` for the compiled maps, or `Object.hasOwn` guards.

Fixed: `supports()` and `variant()` now guard with `Object.prototype.hasOwnProperty.call(...)` before the lookup, so inherited names return the documented `false` / "Unknown variant" error instead of an opaque TypeError.

**3.12 `versionFromUserAgent` silently breaks with a `g`- or `y`-flagged regex**
`src/host/sources.ts:125-131`

With `g`, `String.prototype.match` returns full-match strings and ignores capture groups, so `match[1]` is wrong or undefined; with `y`, `lastIndex` state persists across resolutions so successive `refresh()` calls can alternate between a value and null.

Fix: at factory time, recreate the regex without `g`/`y` (or throw), consistent with the engine's fail-fast config validation.

**3.13 Empty trait-value array compiles to a never-matching condition silently, while an empty version-constraint array throws at config time**
`src/host/HostRulesEngine.ts:48-53`, `src/host/resolve.ts:167`, `src/host/version.ts:93`

`traits: { mk: [] }` compiles to `values: []`, and `[].includes(x)` is always false: the rule can never match, silently. The analogous version case throws "Invalid version constraint" at `defineHostRules` time, which is the module's stated fail-fast philosophy.

Fix: throw at compile time on an empty normalized values array, naming the capability/variant and trait.

**3.14 Strict version grammar silently degrades common real-world versions (4 segments, prerelease/build suffixes) to unknown**
`src/host/version.ts:44, 48`

`"9.1.0.1234"` (Android versionName style), `"9.1.0-rc1"`, `"9.1.0+456"` all parse to null; every version-gated capability then denies, invisibly in production. The conservative direction is intentional and tested, but the failure mode has no signal.

Fix: parse a tolerant numeric prefix (up to 3 leading numeric segments, ignore `-...`/`+...` suffixes and extra `.N`), or at least warn in dev when `versionRaw` is non-null but parses null.

**3.15 Query-backed sources re-parse `location.search` and hit sessionStorage once per source per resolution; setters have no batching**
`src/host/sources.ts:66-81`, `src/host/resolve.ts:132, 138-140`, `HostRulesEngine.ts:255-258, 294-312`

Every `compute()` invokes every source; each source builds a fresh `URLSearchParams` and does a synchronous storage access (including an unconditional `setItem` with no equality check, which also fires cross-frame storage events). Every `setVersion`/`setTrait`/`__setOverride` triggers a full re-resolution plus a synchronous sweep of all listeners, so the documented async-acquisition pattern (host pushes version + M traits over the bridge) costs M+1 resolutions and listener sweeps. (Mitigating: explicitly-set values short-circuit their sources on later passes.)

Fix: share one parsed `URLSearchParams` per resolution pass; skip `setItem` when unchanged; add a batched `set({ version, traits })` or coalesce notification into a microtask.

**3.16 [FIXED] `versionFromQuery` lacks the `persist` opt-out that `traitFromQuery` has**
`src/host/sources.ts:95-104` vs `41-46, 117`

Both wrap the same helper, but only the trait factory exposes `persist?: boolean`. URL-only version reading requires hand-rolling code the library already contains.

Fix: add `persist?: boolean` (default true) to `VersionFromQueryOptions`.

Fixed: `VersionFromQueryOptions` now has `persist?: boolean` (default true), passed through to the shared helper, matching `traitFromQuery`. (Non-breaking.)

**3.17 `supports()` fails silent for unknown names while `variant()` throws; neither behavior is documented**
`src/host/HostRulesEngine.ts:262-273`

For JS consumers/dynamic names (the audience with no compiler help), one API fails loud and the other silent. Silent-false does align with the capability fail-safe rule, but nothing says so.

Fix: either make both throw, or document the asymmetry on `supports()`/`HostRules`.

**3.18 `host/index.ts` is a dead second export list that has already drifted from the root barrel**
`src/host/index.ts:6-37`, `src/index.ts:21-54`

Nothing imports the host barrel (internal code and the root barrel use deep paths), there is no `./host` subpath in package.json exports, and `HostServerSnapshot` is exported from the root but missing from the host barrel.

Fix: make `host/index.ts` the single source of truth and re-export it from `src/index.ts`, or delete it.

**3.19 Structure: compiled types declared in `resolve.ts` but constructed only in `HostRulesEngine.ts`; `ResolvedHost` hand-duplicates `HostInfo`; `SERVER_HOST` hand-mirrors the server branch**
`src/host/resolve.ts:22-71`, `HostRulesEngine.ts:44-201`

Three coupled maintenance hazards: the Compiled* interfaces live in a file that never constructs them; `ResolvedHost` duplicates `HostInfo` field-by-field (bridge them with `interface ResolvedHost extends HostInfo { parsed: ... }` and a destructuring `toInfo`); `SERVER_HOST` is a hand-written literal that must mirror `resolveHost`'s isServer branch (derive it by calling `resolveHost` with a `forceServer` flag instead).

**3.20 `select()` is the one non-reactive read; no `useSelect` hook**
`src/react/createHostHooks.tsx:136-144`

The engine exposes supports/variant/info/select; the hooks bind the first three (plus useTrait). `host.select({...})` called in a component body silently never re-renders on override/refresh, diverging from sibling `useCapability` calls in the same tree.

Fix: add `useSelect<T>(map)` over `useHostInfo().platform`, or document `select()` as one-shot.

---

## Part 4: React hooks and Next.js back navigation

Files: `src/react/createBridgeHooks.ts`, `src/react/createHostHooks.tsx`, `src/next/**`.

### High

**4.1 [FIXED] Hydration mismatch: `useBridgeReady`/`useBridgeReadyState` seed render state from client-only readiness**
`src/react/createBridgeHooks.ts:185-188`

Initial `useState` value is `bridge.isReady()`: false during SSR (window undefined short-circuits initialize), but true on the very first client render with the default config (no handshake, markReady runs synchronously at construction). Server HTML and hydration disagree for any UI branching on readiness.

Fix: mirror `createHostHooks`: `useSyncExternalStore` with a `getServerSnapshot` returning `{ ready: false, error: null }`, or initialize false and flip in a mount effect.

Fixed: the initial state is now always `{ ready: false, error: null }` (matching SSR); the mount effect resolves the real readiness. The react-hooks test now asserts the flip-after-mount behavior.

**4.2 [FIXED] Hydration mismatch: `usePlatform`/`useIsNative` render server "web" vs client native platform**
`src/react/createBridgeHooks.ts:350-356`

Both call `bridge.getPlatform()` during render; SSR always yields web/non-native, while the first client render inside a WebView (the library's core use case) yields native. Conditional rendering on these hooks (their documented purpose) triggers hydration errors precisely in production WebViews.

Fix: `useSyncExternalStore` with no-op subscribe and a conservative server snapshot, or a mounted flag. `createHostHooks.__serverSnapshot` already implements the correct pattern in the same package.

Fixed: both hooks now use `useSyncExternalStore` with a no-op subscribe, a cached client snapshot, and a `getServerSnapshot` returning the conservative `{ platform: "web", isNative: false }`, so the server and first client render agree and settle to the real platform after hydration.

**4.3 [FIXED] Back presses silently swallowed when active intercepts exist but none match the current path**
`src/next/navigation/BackInterceptManager.ts:116-136, 197-204, 221-227`

Trap arming is path-blind (`hasAnyActiveIntercept` ignores pathName) but popstate resolution is path-sensitive (`findBestActiveEntry`). With a path-scoped intercept registered from a persistent component (e.g. `useBackIntercept(cb, "checkout")` in a layout), the trap is armed on non-matching pages; a back press there runs pushTrap, matches nothing, popTrapSilently, and the user's back intent is consumed with NO navigation and NO callback: the back button does nothing for as long as the non-matching scoped intercept stays registered.

Fix: arm the trap only when `findBestActiveEntry(window.location.pathname)` matches, re-evaluating on route change; or in the no-match branch, complete the user's original back intent with one extra `history.back()`.

Fixed: `handlePopstate` now resolves the matching entry BEFORE re-pushing the trap. On a match it re-pushes and fires; on no-match it tears the listener down and issues one `history.back()` so the user's original back intent completes instead of being swallowed (the trap re-arms on the next registration).

**4.4 Trap invariant broken by App Router `pushState`: buried traps bypass intercepts and strand ghost history entries**
`src/next/navigation/BackInterceptManager.ts:142-151, 187-195, 217`

The manager assumes its trap entry is topmost, but nothing observes `pushState`; syncTrap runs only on register/unregister/update. After `router.push` with a trap armed: (a) if the intercept stays registered, the next back press lands ON the buried trap and `handlePopstate` returns at the `isTrap` guard, so back navigation succeeds WITHOUT firing the intercept; (b) if the intercept unregisters after forward nav, `teardownTrap` can't pop the buried trap, leaving a ghost entry that later eats one back press (see 4.9).

Fix: track navigations: hook pushState/replaceState or accept a route-change signal (usePathname) from `useBackIntercept`, and re-sync the trap on each: pop/fence buried traps, re-push on the new top while intercepts remain active.

NOT YET FIXED: this requires the BackInterceptManager to observe `pushState` (or take a route-change signal) and re-sync the trap on each navigation, which is a larger structural change than the surrounding fixes. Related symptoms were mitigated (4.3 no longer swallows a non-matching back press; 4.9 fixes the session-mirror truncation), but the core buried-trap-after-`router.push` case still stands and should be tackled together with the manager's navigation-tracking rework.

**4.5 [FIXED] Session-mode back check validates the session mirror, not real history: back can land on an external page**
`src/next/navigation/nextHistorySession.ts:137-163, 165-201`

The session mirror records only same-document navigations plus same-origin loads. The canonical WebView payment/OAuth flow (hard nav to another origin, redirect back) leaves real history `[a, b, external, callback]` but the mirror `[a, b, callback]`. `canNavigateBackWithinSession` approves, and `router.back()` lands on the external payment page instead of `/b`.

Fix: fence the session across hard loads: on tracking init after a fresh document load (`PerformanceNavigationTiming.type === "navigate"` vs `"back_forward"`, or a per-document marker in `history.state`), clear/fence the list so the shutdown path is taken across the boundary.

Fixed: `ensureSessionHistoryTracking` now clears the session mirror when the document was a fresh load (`PerformanceNavigationTiming.type === "navigate"`), fencing across hard-navigation boundaries so a post-redirect return does not trust stale pre-boundary entries.

### Medium

**4.6 [FIXED] `useBackIntercept` silently ignores toggles of `initiallyActive`, contradicting its own JSDoc**
`src/next/navigation/useBackIntercept.ts:17-19, 33-52`

The JSDoc says "Toggling this updates the entry in-place without changing its stack position." The value is read once at registration; no effect calls `manager.update` on change. The natural pattern the doc invites, `useBackIntercept(close, undefined, isModalOpen)`, is frozen at its registration-time value.

Fix: add `useEffect(() => { if (idRef.current) manager.update(idRef.current, { isActive: initiallyActive }) }, [initiallyActive])`: the manager already supports in-place update, matching the JSDoc. (Or rename the param and fix the doc; the effect is the better fix.)

Fixed: added an effect keyed on `initiallyActive` that calls `manager.update(idRef.current, { isActive })`, honoring the documented in-place toggle.

**4.7 [FIXED] `useBridgeRequest`: overlapping requests settle out of order; stale responses overwrite newer data**
`src/react/createBridgeHooks.ts:243-264`

`request()` has no latest-call tracking. Retry/double-tap: call A (will time out at 5s), call B succeeds at 300ms and sets data; at 5s A rejects and sets error, so the hook reports an error even though the user has the good result; loading also clears when the FIRST settlement lands, not the last.

Fix: sequence ref (`const mySeq = ++seq.current`), guard every setData/setError/setLoading with `seq.current === mySeq`.

Fixed: added a monotonic `seq` ref plus a mounted ref; only the latest call's settlement updates state, and `reset()` bumps the sequence to invalidate in-flight calls.

**4.8 Unstable hook return identities; `request` in effect deps closes an unbounded send loop**
`src/react/createBridgeHooks.ts:56-98, 243-270, 321-342, 398-402`, `useBackIntercept.ts:54-58`

`useBridgeSend` returns a fresh object with fresh functions each render (they close over only the module bridge); `request`/`reset`/`call`/`flush`/`activateIntercept`/`deActivateIntercept` are likewise unmemoized. Consumers following exhaustive-deps re-run effects every render; with `useBridgeRequest`, `useEffect(() => { void request(...) }, [request])` becomes an unbounded resend loop paced by each response.

Fix: hoist render-independent functions to factory scope; `useCallback`/`useMemo` the rest so identities are stable.

**4.9 [FIXED] `routerBackOrShutdown` double-tap pops browser history twice; forward re-visit of a URL truncates the session**
`src/next/navigation/utils.ts:66`, `createBridgeBackNavigation.ts:94-112`, `nextHistorySession.ts:108-120`

(a) History traversal is async: a second tap before the popstate lands re-appends the current URL into the just-popped session list, passes the guard again, and queues a second `router.back()`: the user ends up two entries back or on a poisoned entry. (b) `syncCurrentUrlIntoSession` uses `lastIndexOf` + slice, which cannot distinguish back-nav (truncation correct) from a forward `router.push` to a URL already visited: list → detail → list leaves the mirror as `[list]`, so the next back press sends shutdown and closes the WebView mid-session.

Fix: (a) in-flight guard cleared on the next popstate/pathname change, or pop the session only when the traversal actually lands. (b) only apply truncation on the popstate path; on pushState always append (the tracking callback knows which patched function fired).

Fixed: (a) `routerBackOrShutdown` now sets a `backInFlightRef` that is cleared on the next pathname-change effect; a second tap while a back is settling is ignored. (b) `syncCurrentUrlIntoSession` takes a `source` ("push" | "popstate" | "init") and only truncates on popstate/init; a `pushState`/`replaceState` re-visit appends instead.

### Low

**4.10 `useBridgeRPC`: id registered only after the awaited send; no timeout; stale ids poison later correlation**
`src/react/createBridgeHooks.ts:301-335`

The pending id is added after `await bridge.send(...)`, inverting BridgeManager's own register-before-send ordering (currently unreachable with shipped adapters, all of which deliver on a later macrotask, but fragile). Separately: no expiry: a host that never answers leaves `loading` stuck true forever, and the stale id remains in `pendingIds` where the no-id fallback branch can later attribute an unrelated id-less response to the dead call.

Fix: register the id pre-dispatch; add a timeout option that evicts the id, recomputes loading, and sets error; clear timers on response/reset.

**4.11 Orphaned trap entry after forward-nav unregister eats one back press**
`src/next/navigation/BackInterceptManager.ts:187-195, 217`

Consequence of 4.4(b): the buried trap entry same-URL-renders the old page and, with the listener gone, the first back press from the next page is a no-op; a second press is needed. Fix folded into 4.4 (keep the listener while any trap entry may remain; on landing on a trap with no active intercepts, self-pop it transparently).

**4.12 Path-scoped entries always outrank later-registered global entries, violating documented LIFO**
`src/next/navigation/BackInterceptManager.ts:116-127`

`findBestActiveEntry` consults path-scoped stacks first, global only as fallback: a page-level scoped handler fires underneath a dialog's more-recent global intercept. Fix: select the highest registration-order active entry across all matching stacks (the monotonic counter already exists).

**4.13 Unregister racing a queued back press mis-attributes the self-pop**
`src/next/navigation/BackInterceptManager.ts:187-195, 206-211`

`selfPopInFlight` is a boolean consumed by whichever popstate arrives first; a queued user back press consumes it, the listener is torn down, and the manager's own `history.back()` then moves the user one extra entry back. Narrow window; note a state-nonce alone cannot disambiguate (both pops depart the same entry): needs ordering-based correlation or draining traversals before teardown.

**4.14 Browser-mode `canNavigateBack` trusts `history.length` (inflated by trap pushes) and treats empty referrer as navigable**
`src/next/navigation/utils.ts:70-78`

WebViews load with empty referrer, and `history.length` stays inflated (bounded, +1 per released trap) after any intercept has armed: `canNavigateBack` returns true on the app's first page and `router.back()` no-ops instead of sending shutdown. Fix: subtract known trap pushes; treat empty referrer as unknown → shutdown.

---

## Part 5: DevTools (`src/core/BridgeDevTools.ts`, `src/devtools/**`)

### High

**5.1 [FIXED] Message history cap silently disabled by partial `devTools` config: unbounded memory growth**
`src/core/BridgeManager.ts:122-127`, `src/core/BridgeDevTools.ts:217`, `src/devtools/panels/LogsPanel.tsx:143-153`, `src/types/index.ts:452`

Same whole-object-`??` defaulting as 1.2: any user-supplied `devTools` object skips ALL defaults, leaving `maxMessageHistory` undefined, and the cap check `messages.length > undefined` is always false: every sent/received message with full payloads is retained forever. The config snippet the DevTools UI itself tells users to copy (`devTools: { enabled: true, logDestination: "devtools" }`) triggers exactly this in JS (in TS it doesn't even compile, since `maxMessageHistory` is required).

Fix: per-field merge (pairs with 1.2), `?? 50` fallback inside BridgeDevTools, fix the in-UI snippet.

**5.2 Console interception restore-ordering bugs: wrapper stacking, double-recording, zombie wrappers from destroyed instances**
`src/core/BridgeDevTools.ts:47-53, 124, 145, 148-156, 285-295`

`originalConsole` is captured as BOUND copies of whatever is on `console` at construction; if instance A already intercepted, B's "originals" are copies of A's wrappers, and `bind()` strips the `INTERCEPTED` marker. `interceptConsole` sets `consoleIntercepted = true` even when every method was skipped via the marker check, so B's `restoreConsole()` reinstalls marker-less copies of A's wrappers: the next intercept wraps the copy and every console call is recorded twice. If A was destroyed, its wrapper is resurrected and keeps collecting into the dead instance (`destroy()` never sets `enabled = false`), pinning it in memory.

Fix: track interception per method actually wrapped; stash the true prior function on the wrapper itself and restore that; set `enabled = false` in `destroy()`.

### Medium

**5.3 [PARTIAL] `window.__BRIDGE_DEVTOOLS__` is last-writer-wins with unconditional delete; the UI mixes two data sources**
`src/core/BridgeDevTools.ts:95-115, 290-292`, `src/devtools/panels/*`

Same shared-global disease as 2.3: two instances (or StrictMode/HMR re-creation) overwrite each other and either's `destroy()` deletes the API for the survivor, flipping panels to "Logs are not active". Separately, `SendEventPanel` sends through the `bridge` prop while Logs/EventHistory/Metrics panels read the global, which may belong to a DIFFERENT instance.

Fix: delete only when the stored object is the instance's own; route all panel reads through `bridge.getDevTools()` (exists already) and drop the global for the UI path.

Fixed so far: `destroy()` now deletes the global only when it still owns it (ownership tracked via the installed API object), installation warns when overwriting another instance's API, and destroy also sets `enabled = false` (closing the zombie-collection half of 5.2). Remaining: the panels still read the global instead of `bridge.getDevTools()`, so the mixed-data-source issue stands.

**5.4 Polling with fresh array identities: unconditional re-render + hundreds of JSON.stringify calls per second while idle**
`src/core/BridgeDevTools.ts:224-226, 255-257`, `src/devtools/panels/LogsPanel.tsx:56-71, 124, 271`, `EventHistoryPanel.tsx:24-37`

`getLogs()`/`getMessages()` return new arrays per call; the panels `setState` a fresh identity every 500ms even when nothing changed, and each LogsPanel render pretty-prints `JSON.stringify` for every entry twice (filter + row). With a full 100-entry buffer that is hundreds of stringifies/second at idle.

Fix: skip setState when unchanged (length + last timestamp), memoize formatted text per entry, or better, replace polling with a subscription (`HostPanel.tsx:23-24` already demonstrates the correct subscribe pattern in the same package).

**5.5 LogsPanel auto-scroll disables itself; MetricsPanel goes permanently blank on a mount race; unguarded `window` access crashes SSR**
`LogsPanel.tsx:74-98, 131`, `MetricsPanel.tsx:16-30`, `src/devtools/index.ts:19`

(a) The scroll effect fires every poll tick (array identity, 5.4) and `handleScroll` treats the resulting smooth-scroll frames as user intent, silently turning follow-mode off after any log burst. (b) MetricsPanel's effect returns early if `window.__BRIDGE_DEVTOOLS__` is absent at mount, installs no interval, and never re-checks: permanently "Metrics Disabled"; `featuresEnabled` is also computed once. (c) `LogsPanel.tsx:131` evaluates `window.__BRIDGE_DEVTOOLS__` in the render body; LogsPanel is a standalone public export and a "use client" component still server-renders in Next.js: `ReferenceError: window is not defined`.

Fix: (a) scroll only when count grows, flag programmatic scrolls via ref; (b) poll for API availability like LogsPanel does, re-read config in the interval; (c) `typeof window !== "undefined" &&` guard (the same file already guards correctly at lines 58/81).

**5.6 [FIXED] Production guard fails OPEN when `NODE_ENV` is undetectable**
`src/utils/env.ts:6-16`, `src/core/BridgeDevTools.ts:56`

`isProductionEnv()` is true only for an exact `"production"`; in a plain `<script>` context or a pipeline that doesn't define `process.env.NODE_ENV`, the value is undefined and the force-disable guard passes: console patching and payload collection run on a production page. The unknown case should be the safe case.

Fix: also consult `import.meta.env?.PROD`, or fail closed (treat unknown as production) with a documented explicit opt-in flag.

Fixed: added `isProductionEnvOrUnknown()` (returns true unless NODE_ENV is confirmed dev/test or `import.meta.env.DEV` is set) and switched the devtools guard to it, so an undetectable environment now fails closed.

### Low

**5.7 DevTools UI polish items**
`DevToolsTrigger.tsx:107-135`, `DevToolsUI.tsx:35-39`, `BridgeDevTools.ts:214, 247-251`, `LogsPanel.tsx:276`, `SendEventPanel.tsx:60-68`

- Dragging the trigger always toggles the panel on release (mouseup flushes before click; no moved-beyond-threshold suppression); the drag effect re-registers 4 window listeners per mousemove frame; `touchmove` is `{ passive: false }` but never calls preventDefault, so the page scrolls under a touch drag.
- Ctrl+Shift+B hotkey collides with the browser bookmarks-bar shortcut in Chrome/Edge/Firefox; make it configurable.
- `maxConsoleLogEntries || 100` makes an explicit 0 impossible (use `??`); log/message buffers store live object references, so later mutations rewrite displayed history (snapshot at capture).
- List keys `${timestamp}-${index}` are renumbered by `shift()` at the cap, defeating keying; assign a monotonic id at capture.
- SendEventPanel's catch swallows the `SyntaxError` position info ("Invalid JSON payload"); include `e.message`. (Verified safe otherwise: JSON.parse only, no eval; predefined-mode Standard Schema pre-validation is correct.)

**Verified clean:** the React UI is only reachable via the `nbridge/devtools` subpath (BridgeDevTools.ts imports no React; the main entry exports no UI), so the main bundle cannot pull in the panel; the compiled CSS has no preflight and cannot reset host-page styles. Remaining friction: forgetting `import "nbridge/devtools/styles.css"` yields a silently unstyled overlay; a dev-mode probe/warning would help.

---

## Part 6: Public API surface, types, constants, built-in middleware

### High

**6.1 [FIXED] Calling `createBridgeHooks` twice silently breaks inbound messaging for the first instance**
`src/react/createBridgeHooks.ts:38-52`, `src/core/BridgeManager.ts:913-917`

Each factory call runs `createBridge()` (fresh manager) and each native adapter's initialize clobbers the one global `window.sendBridgeMessage` (see 2.3): a second call steals all native-to-web traffic from the first, and either `destroy()` severs the survivor's inbound channel. The JSDoc says "call this once per app" but nothing detects or warns, and hooks from two calls silently talk to different singletons.

Fix: warn/throw on repeat instantiation (module-level flag), and fix the underlying global clobbering per 2.3.

Fixed: a module-level flag now warns on repeat factory calls, and the underlying destroy-clobber is fixed by 2.3's ownership guard.

**6.2 `IBridgeManager` has drifted far from the class; the library's own hooks cannot be powered by a mock of it**
`src/types/index.ts:207-271` vs `src/core/BridgeManager.ts:318-866`, `createBridgeHooks.ts:360-401`

The interface declares 10 members; the class has ~21 more public methods (use/addMiddleware/getMiddlewareCount, getMetrics/onMetricsUpdate, getQueueStats/flushQueue/clearQueue, getBatchStats/batch, compression stats, schema accessors, devtools accessors, the log facade). `useBridgeMetrics`/`useBridgeQueue` require methods missing from the interface, so the "manager interface" cannot describe the manager.

Fix (breaking): expand or split the interface (core + capability interfaces) and make the react/next layers depend on it consistently. Combine with dropping the log facade (1.8) and the `addMiddleware` alias (1.20) before freezing.

### Medium

**6.3 [FIXED] `useBridgeMessageState` returns `any`, discarding the schema-typing apparatus at the consumption point**
`src/react/createBridgeHooks.ts:166, 174`

State is `useState<any>` and returned directly, so the hook's public return is `readonly [any, BridgeMessage | null]` despite the `PayloadFor` generics on its parameters: zero type safety exactly where data is consumed.

Fix: type the state as `PayloadFor<TSchemas, K> | undefined` and the message as `BridgeMessage<Payload> | null`.

Fixed: the hook now derives a `StatePayload` type from the schema and types both `payload` (`StatePayload | undefined`) and `message` (`BridgeMessage<StatePayload> | null`), so consumers get real typing at the point of use.

**6.4 [FIXED (BREAKING)] `BridgeMessageType` ships an app-specific taxonomy nothing uses**
`src/constants/messageTypes.ts:18-52`, `src/index.ts:13-16`

Hardcoded `auth:login`, `camera:takePicture`, `storage:get` etc.: zero usage anywhere in src or tests. In a generic bridge whose real typing mechanism is the schema registry, these imply a host-side contract the library does not implement (the next layer's own default shutdown event `"shutdown"` is not even among them).

Fix (breaking): remove from the public API; demote to a docs example of a schema registry.

Fixed (breaking, see BREAKING_CHANGES.md #2): removed `BridgeMessageType`/`BridgeMessageTypeValue` from the public API and deleted `src/constants/messageTypes.ts`. Consumers use plain constants or a schema registry.

**6.5 [PARTIAL] Built-in middlewares have real defects beyond zero test coverage**
`src/middleware/index.ts`

- `retryMiddleware` (101-120): retrying by calling `next()` again interacts with the shared-index chain (1.28): retries skip every middleware registered after it (e.g. encryption → plaintext on the wire) and go straight to the terminal handler. Also, on the incoming direction it re-dispatches handlers on failure, duplicating side effects; it is documented "outgoing only" but not enforced.
- `filterMiddleware` (86-95): blocking a message by not calling next() still resolves `send()` with `{ success: true }`, and an `expectResponse` send hangs until timeout because the pending response is never rejected: silent message suppression with a success receipt.
- `throttleMiddleware` (126-144): `lastMessageTime` is set AFTER the awaited delay without re-checking; N concurrent sends all measure against the same stale timestamp, sleep the same interval, and release simultaneously: it does not actually enforce the rate under burst.
- `encryptionMiddleware` (150-181): incoming detection is `"encrypted" in payload` duck-typing: any user payload with an `encrypted` key is fed to `decrypt`; no versioning/marker field.
- `loggingMiddleware`/`debugMiddleware`/`timingMiddleware` write to raw `console`, ignoring the logger/logDestination pipeline entirely.

Fix: after fixing 1.28 (per-frame dispatch), rework retry to wrap the transport (or document it must be registered LAST); make filter reject pending responses (needs middleware access to ResponseManager or an abort signal on the context); fix throttle with a promise-chain token; use an explicit envelope marker (`__nbridgeEncrypted: true`) for encryption; route logging middlewares through the BridgeLogger.

Fixed so far: `retryMiddleware` now re-runs downstream correctly on the fixed chain (1.28), is outgoing-only (early-returns on incoming), and documents the register-last requirement; `throttleMiddleware` reserves a monotonic time slot before awaiting so a burst is genuinely spaced; `encryptionMiddleware` tags its envelope with `__nbridgeEncrypted: true` and only decrypts tagged envelopes. All covered by middleware.test.ts. Remaining: `filterMiddleware` still resolves `{ success: true }` for a blocked message and does not reject a pending `expectResponse` (needs an abort-signal on `MiddlewareContext` or ResponseManager access, a larger design change); the logging/debug/timing middlewares still use raw `console` rather than the BridgeLogger.

**6.6 [PARTIAL] `useBridgeQueue` polls every second and re-renders unconditionally; the state-model split with createHostHooks is a real cost**
`src/react/createBridgeHooks.ts:382-396`, `src/core/MessageQueue.ts` (`getStats` returns a fresh spread)

`setInterval(1000)` + fresh object identity per tick = every consumer re-renders once per second while idle. Root cause: BridgeManager exposes `onMetricsUpdate` but no queue-change subscription, forcing polling, while createHostHooks in the same package uses `useSyncExternalStore` with cached snapshots.

Fix: add a queue-update event; drive the hook via `useSyncExternalStore`; at minimum shallow-compare stats before setState.

Fixed the re-render: `useBridgeQueue` now shallow-compares queue stats (`queueStatsEqual`) and keeps the previous state object when unchanged, so an idle queue no longer re-renders consumers every second. The deeper "queue-change event + useSyncExternalStore" rework (still polls, just no longer re-renders on no-change) was left as a follow-up.

**6.7 `window.d.ts` global augmentation never ships; the actual native entry point is typed nowhere**
`src/types/window.d.ts:17-37`

The `declare global` for `__BRIDGE_DEVTOOLS__` is dropped by the dts rollup (verified: dist has no `declare global`), so it neither pollutes consumers nor helps them, and `window.sendBridgeMessage`, the REAL wire entry point native code calls, is declared nowhere; even internal code casts through `Record<string, unknown>`.

Fix: export named interfaces plus a documented augmentation consumers can opt into, and declare `sendBridgeMessage` properly.

### Low

**6.8 [PARTIAL] API-surface debris**
`src/next/navigation/BackInterceptManager.ts:238`, `src/next/index.ts:14, 21`, `src/types/index.ts:308, 486-511`, `src/next/navigation/useBackIntercept.ts:57`, `src/next/navigation/utils.ts:64-67`

- [FIXED] `export const backInterceptManager = BackInterceptManager.getInstance`: instance-cased name bound to the function, unused, not in the barrel. Deleted.
- Test-only APIs ship publicly: `resetSessionHistoryStateForTests` and the `BackInterceptManager` class with `resetForTests()` (tears down the live popstate listener globally). Mark `@internal`/strip or move to a test-support entry. (Not done: the test suite imports these; needs a separate test-support entry.)
- [FIXED] `QueuedMessage.retries` is always 0 and never read (`attempts` is the real counter); now marked optional + `@deprecated` (kept in the persisted shape for back-compat rather than a hard removal).
- `EventType`/`PayloadType`/`ResponseType` (types/index.ts:486-511) are unused and unexported while createBridgeHooks re-derives the identical conditional inline ~6 times; use them or delete them. (Not done.)
- [FIXED] `deActivateIntercept` breaks camelCase: `useBackIntercept` now returns `deactivateIntercept` and keeps `deActivateIntercept` as a `@deprecated` alias. (The `BridgeBackAction` const/type naming vs `BridgeMessageType`+`Value` inconsistency is left as-is.)
- `canNavigateBack` is a side-effectful predicate: calling it installs history monkey-patches and writes sessionStorage, duplicating the init `useBridgeBack` already does; make the predicate pure, keep init in the effect. (Not done.)
- Missing named types: no exported result types for useBridgeRequest/RPC/Queue/Send/Back (consumers need `ReturnType<ReturnType<typeof createBridgeHooks>["useBridgeRequest"]>` gymnastics); `nbridge/next` doesn't re-export `BridgeBackAction` though its own API is typed with it; root omits `LogDestination`/`LogLevel`/`MetricsListener` referenced by exported types. (Not done.)
- `usePlatform`/`useIsNative` call no React APIs → now they DO (converted to `useSyncExternalStore` for the hydration fix 4.2), so the `use` prefix is now accurate.

---

## Part 7: Packaging, build, CI, docs

### High

**7.1 [FIXED] Release workflow publishes without any test, typecheck, or package-validation gate**
`.github/workflows/release.yml:39-41`, root `package.json` `scripts.release`

`release.yml` triggers on every push to `main` and runs `pnpm release` = `pnpm build && changeset publish`. CI (lint/typecheck/test/verify:pkg) runs in a separate, parallel workflow with no `needs` dependency, so a commit that fails tests or publint can still publish to npm the moment the release PR merges.

Fix: gate the release: `"release": "pnpm build && pnpm --filter nbridge test && pnpm verify:pkg && changeset publish"` (or equivalent steps before `changesets/action`).

Fixed: the root `release` script is now `pnpm typecheck && pnpm test && pnpm build && pnpm verify:pkg && changeset publish`, so a failing typecheck/test/publint aborts the publish.

### Medium

**7.2 [FIXED] Published tarball contains no LICENSE file**
`packages/bridge/package.json:6`, `files: ["dist"]`

`"license": "MIT"` is declared but the only LICENSE file lives at the repo root; npm auto-includes LICENSE only from the package directory, so `npm pack` ships no license text: a compliance problem for consumers whose tooling requires the file.

Fix: copy LICENSE into `packages/bridge/` (or a prepack copy step); npm then includes it automatically.

Fixed: copied the MIT LICENSE into `packages/bridge/LICENSE`; npm includes it in the tarball automatically (independent of the `files` field).

**7.3 pako is in the module graph of every consumer, even with compression disabled**
`src/core/CompressionManager.ts:1`, `src/core/BridgeManager.ts:66, 142-145` (verified in dist: top-level `import pako from "pako"`)

CompressionManager is unconditionally constructed (so incoming compressed payloads can always be decompressed) and imports pako statically: ~45KB in the initial graph for every app, including the majority that never enable compression. This undercuts the README's "tree-shakeable core" claim: the import is shakeable in theory but never shaken in practice.

Fix: lazy-load via `await import("pako")` inside `compress()`/`decompress()`: both call sites are already async paths (and 1.15 wants them async anyway).

### Low

**7.4 Packaging polish**
- ESM-only output breaks CJS consumers (default Jest, older toolchains). Clearly deliberate and documented (attw `--profile esm-only`); only act if issue reports appear: dual `format: ["esm", "cjs"]` is the fix then.
- `exactOptionalPropertyTypes` is off (`tsconfig.json`); enabling it would police exactly the casts this review flags (`iframeParentOrigin as string` at BridgeManager.ts:130, the `as Required<...>` devTools cast at 174), turning them into explicit `| undefined` decisions. Pairs with fixing 1.2. (Partially addressed: `tsconfig` `target`/`lib` were bumped to ES2022 during the refactor so modern built-ins like `Object.hasOwn` are available; `exactOptionalPropertyTypes` itself is still off, and `normalizeConfig` (1.2 fix) already removed the `as Required<...>` casts.)
- `build:css` duplicates the tsdown `onSuccess` tailwind command and is referenced by nothing; the two can silently drift (the published-CSS failure mode does NOT exist today: `onSuccess` runs on every build). Delete `build:css` or make `onSuccess` call it.
- `window.d.ts` global augmentation is dropped by dts bundling (see 6.7).
- Stale comment in release.yml:30-31 justifies an npm upgrade for "Node 22" while the workflow pins Node 24. Update or drop; optionally tighten root `engines` to `>=24` to match what CI tests.

**Checked and confirmed OK:** exports map (types-first, styles.css + package.json subpaths present; host API intentionally on the root entry); "use client" banners preserved in dist for react/next/devtools and absent from the server-safe root; `sideEffects: ["**/*.css"]` is correct (no module-level side effects in src); peers external in dist, pako external; docs/reference/bridge-config.md defaults match BridgeManager.ts:86-131 including the merged-vs-replaced sub-config warning; README symbols all exist.

---

## Part 8: Test coverage gaps

The suite (12 files) covers the happy paths well. The gaps below are ordered by how likely the missing test is to be hiding a real bug: the first three would fail TODAY against shipped behavior (they double-confirm findings 1.1, 1.10, 1.22).

### High

**8.1 [FIXED] The error contract is untested and broken: no test contains `_error` anywhere**
Source: `BridgeManager.ts:398-404`, `ResponseManager.ts:60-66`. Add to `core-messaging.test.ts`: "onWithResponse handler errors reject the caller's sendWithResponse" (two bridges, or inject a `sum_error` for a pending id). This test fails against current code (finding 1.1).

**8.2 [FIXED] Queue overflow: no test fills the queue**
Source: `MessageQueue.ts:52-56`, `BridgeManager.ts:600-603`. Add to `features-wiring.test.ts`: `maxSize: 2`, three failing sends, assert the third is reflected in the return value/stats. Fails today: `send()` reports success for the dropped message (finding 1.10).

Fixed: added a `maxSize: 1` overflow test asserting the second send rejects (not silently resolves) when the queue is full and the size stays capped.

**8.3 [FIXED] `successRate`/`messagesPerSecond` are never asserted**
Source: `MetricsCollector.ts:104-108`. The only metrics-failure test asserts `messagesFailed` alone. Add: "successRate reflects mixed success/failure" (1 fail + 1 success → 0.5). Fails today: stays 1.0 with only failures (finding 1.22).

Fixed: added two metrics tests in features-wiring.test.ts ("successRate reflects mixed success and failure" → 0.5, and "not 1.0 when every send fails" → 0). `messagesPerSecond` decay (see 1.22 item 3) is still untested/unfixed.

**8.4 [FIXED] Middleware chains: no multi-middleware or repeated-next() test; all ten built-in middlewares have zero tests**
Source: `MiddlewareManager.ts:29-39`, `src/middleware/index.ts`. The shipped `retryMiddleware` composed with any later middleware silently skips it on retry (finding 6.5): a test would have caught the interaction. Add `middleware.test.ts`: "retryMiddleware re-runs downstream middleware on retry", "next() twice does not double-send", "encryption round-trips over a bridge pair", "filtered outgoing message: what does send() return, does an expectResponse hang?", "metadata leaves array/primitive payloads untouched".

Fixed: added `middleware.test.ts` (7 tests) covering chain ordering with no skips, retry re-running the middleware after it, encryption round-trip + marker rejection, filter blocking, metadata passthrough for arrays, and throttle burst spacing. (The remaining built-in middlewares, logging/timing/debug/validation/transform, are thin wrappers; their core paths are exercised indirectly.)

**8.5 [FIXED] IframeAdapter is completely untested, including its security-relevant origin checks**
Source: `IframeAdapter.ts:29, 32, 50, 63-82`. A regression here is cross-origin message injection or payload leak, invisible to every current test. Add `iframe-adapter.test.ts`: synthetic MessageEvents with wrong source/wrong origin (ignored), right origin (dispatched); assert `postMessage` targetOrigin; string vs object frames; destroy removes the listener.

**8.6 Double bridge instances / shared `window.sendBridgeMessage` untested**
Source: `helpers.ts:65-83`, adapters' destroy. Add to `core-messaging.test.ts`: "destroying one bridge instance does not break another's incoming messages". Fails today (findings 2.3/6.1).

**8.7 `routerBackOrShutdown` decision matrix and the entire session-history module are unexercised**
Source: `createBridgeBackNavigation.ts:94-112`, `nextHistorySession.ts` (truncation :108-121, 50-entry cap :65-78, pop :123-135, cross-origin check :137-163, corrupt JSON :51-63). A wrong answer either `router.back()`s onto an external page or kills the WebView mid-flow (findings 4.5/4.9). Add `next-session-history.test.ts`: seed sessionStorage, simulate push/replace/popstate, assert canNavigateBack, truncation behavior, router-vs-shutdown per force flag.

### Medium

**8.8 Queue retry/flush edge cases**: retry-cap exhaustion (attempts >= 3 drop + stats), re-queued messages surviving to next flush, concurrent flush re-entrancy (auto-flush timer + online listener + manual flushQueue can race). Source: `MessageQueue.ts:135-186`.

**8.9 Offline transitions**: no test touches `navigator.onLine` or the `online` event listener registered in initialize (and removed in destroy). Source: `BridgeManager.ts:563-571, 246-254`. Stub `navigator.onLine`, dispatch `new Event("online")`.

**8.10 Queue persistence**: only the legacy-key migration is tested. Missing: current-format round-trip across bridge instances, corrupt JSON in storage degrading to an empty queue (currently it can wedge the queue: finding 1.25), restored stats sanity. Source: `MessageQueue.ts:248-296`.

**8.11 Batching failure paths**: failed envelope send (messages dropped after success was reported: finding 1.5), destroy with pending batch, batching + queue interplay. Source: `BatchManager.ts:89-120`.

**8.12 [PARTIAL] Compression edges**: corrupt/truncated `__compressed` payload (must not kill the bridge, should reject a pending response: finding 1.23), exact-threshold boundary, compression + batching round-trip (compressed entry inside a batch is broken today: finding 1.24). Source: `CompressionManager.ts:30, 63-74`.

Fixed so far: added a "corrupt compressed payload is dropped without killing the bridge" test (the next valid message still dispatches) and an "incompressible payload ships uncompressed" test (covers 1.14). Still untested: exact-threshold boundary and the compression+batching round-trip.

**8.13 iOS wire format**: nothing asserts iOS receives a raw object (the "Do not align" comment is load-bearing and unenforced): a helpful refactor stringifying it would break all iOS hosts and pass CI. Add a fake `window.webkit.messageHandlers` and assert postMessage got an object.

**8.14 Forward navigation while the back trap is armed**: all BackInterceptManager tests stay on one page; pushState-while-trapped is the exact scenario of finding 4.4. Add: "pushState after arming, then back presses: right callback exactly once, no eaten navigation".

### Low

**8.15** `useBridgeRequest` unmount during pending request (no cancelled guard, unlike `useBridgeReadyState`); `getBridge` returning the same instance and ignoring subsequent configs is unasserted. Also worth adding once 1.1/1.9 are fixed: response-timeout rejection shape and send-failure rejection (no unhandled rejection).

---

## Priority guide for the refactoring agent

Suggested order of attack (dependencies in parentheses):

1. **Wire-contract correctness**: 1.1 (`_error` must reject), 1.21 (hoist suffix constants), 1.24 (decompress batch entries), 2.14 (protocol discriminator). Add tests 8.1 first.
2. **Config normalization**: 1.2 + 5.1 + optional-field types + `exactOptionalPropertyTypes` (7.4). One `normalizeConfig()` module fixes four findings.
3. **Reliability model**: 1.3, 1.4, 1.5, 1.10, 1.12 (queue/batch/middleware/offline interactions): design send-pipeline once (1.8's `OutgoingPipeline`), then tests 8.2, 8.8-8.12.
4. **Shared-global lifecycle**: 2.3 + 5.3 + 6.1 + 1.11 (own-function-guarded detach, singleton reset, repeat-factory warning). Test 8.6.
5. **Security defaults**: 2.1, 2.2 (iframe origin), 2.5 (detection tightening), 5.6 (fail-closed prod guard). Test 8.5.
6. **React/Next correctness**: 4.1-4.9 (hydration, races, back-navigation model). Tests 8.7, 8.14.
7. **API surface (breaking)**: 1.18/1.20/6.2/6.4/6.8, host API cleanups 3.2-3.9, DX items. Best batched into one breaking release while 0.x.
8. **Performance**: 1.7 (leak first), 1.15-1.17, 3.15, 5.4, 6.6, 7.3.

Cross-cutting conventions to adopt while refactoring: single source of truth for defaults and priority order (no duplicated literals), errors always reach a visible channel (fix 1.6 before debugging anything else), adapters throw on failure (never silent-drop), and every silent drop surfaced by this review should become either a thrown error or an emitted event.

