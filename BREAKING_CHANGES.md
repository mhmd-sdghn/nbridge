# nbridge Breaking Changes

This file tracks the breaking API changes applied during the refactor driven by
`NBRIDGE_REVIEW.md`. Each entry states what changed, why, and how to migrate.
Findings numbers refer to `NBRIDGE_REVIEW.md`.

Status: in progress. Entries are added as the changes land.

---

## 1. `bridge.batch()` renamed to `bridge.flushBatch()` and now awaits the send (finding 1.19)

**Why:** the old method was named `batch()` but actually *flushed* the pending
batch, and although `async`, it awaited nothing: the envelope was sent as a
floating promise, so `await bridge.batch()` resolved before the batch reached
the wire and failures surfaced only as a stats counter.

**Change:**
- `bridge.batch()` → `bridge.flushBatch()`.
- `flushBatch()` now returns a promise that resolves after the batch envelope is
  actually sent and rejects if the send fails.
- `BatchManager.flush()` returns the underlying send promise.

**Migrate:**
```diff
- await bridge.batch();
+ await bridge.flushBatch();
```

---

## 2. `BridgeMessageType` constant removed from the public API (finding 6.4)

**Why:** it shipped an opinionated, app-specific message taxonomy
(`auth:login`, `camera:takePicture`, `storage:get`, …) that nothing in the
library used and that implied a host-side contract nbridge does not implement.
The real, supported typing mechanism is the schema registry (`defineMessage` +
`createBridgeHooks({ config: { schemas } })`).

**Change:** `BridgeMessageType` and `BridgeMessageTypeValue` are no longer
exported from `nbridge`.

**Migrate:** define your own message-type constants, or (better) a schema
registry:
```ts
// Before
import { BridgeMessageType } from "nbridge";
bridge.send(BridgeMessageType.AUTH_LOGIN, payload);

// After, plain constants
const AUTH_LOGIN = "auth:login";
bridge.send(AUTH_LOGIN, payload);

// Or, schema registry (recommended, gives payload/response typing)
const schemas = { "auth:login": defineMessage({ type: "auth:login", /* ... */ }) };
```

---

## 3. Host override treats `undefined` as "absent" (finding 3.7)

**Why:** `__setOverride({ platform: "ios", version: undefined })` behaved
differently from `__setOverride({ platform: "ios" })`, the former forced the
version to unknown via key-presence (`"version" in override`) semantics. That
contradicted the engine's own convention (explicit `undefined` == absent) and
the normal TS optional-property idiom.

**Change:** override fields now use value semantics: `undefined` means "leave
the source/explicit value in effect"; use `null` to explicitly force unknown.

**Migrate:** if you relied on `version: undefined` (or `traits: { k: undefined }`)
to force a value to unknown, pass `null` instead:
```diff
- host.__setOverride({ platform: "ios", version: undefined }); // used to force unknown
+ host.__setOverride({ platform: "ios", version: null });      // explicit "unknown"
```

---

## 4. `versionFromQuery`: param-scoped default storage key + `persist` opt-out (findings 3.1, 3.16)

**Why:** `versionFromQuery(param)` always defaulted its sessionStorage key to the
fixed `nbridge:host-version`, regardless of `param`, so two engines on one
origin using different params collided. It also lacked the `persist` opt-out
that `traitFromQuery` already had.

**Change:**
- The default storage key is now param-scoped: `nbridge:host-version:<param>`
  (the canonical `hv` param keeps `nbridge:host-version` for back-compat).
- `VersionFromQueryOptions` gains `persist?: boolean` (default `true`).

**Migrate:** if you depended on the old shared default key across differently
named params, pass an explicit `storageKey` to preserve the old value:
```diff
- versionFromQuery("appVersion")
+ versionFromQuery("appVersion", { storageKey: "nbridge:host-version" })
```
Most apps need no change.

---

## 5. `host.__setOverride` renamed to `host.setOverride` (finding 3.6)

**Why:** the dunder name signalled "private/unstable", but it is the supported
way for tests and devtools to drive the engine (the test suite and the shipped
React bindings depend on it).

**Change:** `host.setOverride(...)` is the public method. `host.__setOverride`
remains as a `@deprecated` alias.

**Migrate:** `host.__setOverride(x)` → `host.setOverride(x)` (no rush; the alias
still works).

---

## 6. `parseVersion` is now tolerant of real-world version strings (finding 3.14)

**Why:** the strict grammar rejected common host versions (`9.1.0.1234`,
`9.1.0-rc1`, `9.1.0+456`), silently denying every version-gated capability.

**Change:** `parseVersion` now accepts up to three leading numeric segments and
ignores extra `.N` segments plus a trailing `-`/`+` suffix. It returns `null`
only when there is no usable leading numeric segment. `parseVersion`/`satisfies`
and the constraint helpers are now exported from `nbridge`.

**Migrate:** none required unless you relied on `"1.2.3.4"` / `"1.2.3-beta"`
resolving to unknown; they now parse to `1.2.3`.

---

## 7. Declared trait `values` are now enforced at runtime (finding 3.5)

**Why:** the docs said a trait's `values` list "constrains the accepted
values", but an out-of-domain value was passed through verbatim and just failed
every rule with no signal.

**Change:** a resolved trait value outside its declared `values` list now
resolves to `null` (unknown), with a dev-mode `console.warn`.

**Migrate:** ensure your sources emit values within the declared list; if you
intentionally allowed arbitrary values, remove the `values` list from that
trait's definition.
