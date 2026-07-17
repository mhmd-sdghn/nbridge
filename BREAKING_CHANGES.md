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
