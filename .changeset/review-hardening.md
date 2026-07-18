---
"nbridge": minor
---

Correctness, security, reliability, and DX hardening pass across the whole
package, plus a set of breaking changes. Full migration notes are in
`BREAKING_CHANGES.md`.

**Breaking changes**

- `bridge.batch()` is renamed to `bridge.flushBatch()` and now awaits the send
  (resolves after the batch envelope is actually on the wire, rejects on
  failure).
- `BridgeMessageType` / `BridgeMessageTypeValue` are removed from the public API
  (an app-specific taxonomy nothing used). Use plain constants or a schema
  registry.
- Host override uses value semantics: `setOverride({ version: undefined })` now
  means "leave the source value in effect"; pass `null` to force unknown.
- `versionFromQuery(param)` defaults to a param-scoped sessionStorage key
  (`nbridge:host-version:<param>`; the canonical `hv` keeps the old key) and
  gains a `persist` opt-out.
- `host.__setOverride` is renamed to `host.setOverride` (the dunder name stays
  as a deprecated alias).
- `parseVersion` is tolerant of real-world versions (`9.1.0.1234`,
  `9.1.0-rc1`, `9.1.0+456` -> `9.1.0`); `parseVersion`/`satisfies` and the
  constraint helpers are now exported.
- Declared trait `values` are enforced at runtime (out-of-domain -> unknown).
- Host generic parameter order is unified to `<TTraits, TCaps, TVariants>`
  across `HostRules` / `createHostHooks` (matches `HostRulesConfig`); a capability
  may use an `all` fallback key and an unknown capability key now throws.

**Fixes and hardening (non-breaking)**

- Wire contract: `*_error` replies reject `sendWithResponse` instead of
  resolving as success; postMessage transports require the `__nbridge`
  discriminator; compressed batch entries decompress; duplicate response ids
  are rejected.
- Config: sub-config fields are optional so documented defaults are reachable
  (`{ enabled: true }` works).
- Reliability: middleware runs on offline flush; auto-flush respects
  `navigator.onLine`; configurable `queue.maxRetries`; a failed batch unbatches
  into the queue; queue overflow throws instead of dropping; persisted queue
  writes are debounced and corrupt entries are dropped on load.
- Shared globals: `window.sendBridgeMessage` and `__BRIDGE_DEVTOOLS__` are
  ownership-guarded on destroy; the singleton resets on `destroy()`; `send()`
  guards against a destroyed bridge; repeat `createBridgeHooks()` warns.
- Security: IframeAdapter requires a configured origin to receive/send (explicit
  `"*"` opt-in), throws when not framed; `hasAndroidBridge` checks `postMessage`;
  the devtools production guard fails closed.
- React/Next: SSR-safe `useBridgeReady` / `usePlatform` / `useIsNative`;
  `useBridgeRequest` ignores stale responses; stable hook identities;
  `useBackIntercept` honors `initiallyActive` and adds `deactivateIntercept`
  (with a deprecated `deActivateIntercept` alias); a reactive `useSelect` hook.
- Middleware: per-position dispatch (no sibling skip); fixed
  retry/throttle/encryption built-ins; `filterMiddleware` rejects a blocked send
  (`FilteredMessageError`).
- Metrics: correct `successRate`, bounded `pendingTimings`, rate decays to 0.
- Perf: `pako` is lazy-loaded (out of the initial graph); compression falls back
  to uncompressed when it would inflate; shared `byteLength`.
- Packaging: the `release` script gates on typecheck/test/build/verify:pkg;
  `LICENSE` is included in the published package.
