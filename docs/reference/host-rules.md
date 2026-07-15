# Host Rules API

The Host Rules engine resolves named **capabilities** and **variants** from the current `(platform, version)` and any declared **traits**. See the [Host Rules guide](/guide/features/host-rules) for the narrative introduction; this page is the API reference.

All exports below come from the root entry (`nbridge`), except `createHostHooks` (`nbridge/react`) and `HostPanel` (`nbridge/devtools`).

## `defineHostRules(config)`

Creates and returns a `HostRules` engine. Call once per app, at module scope. Malformed version constraints and empty `when` clauses throw here — resolution never fails silently.

### Config

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | `string \| (() => string \| null)` | `versionFromQuery("hv")` | How to acquire the host version: a static string, a custom function, or a built-in source. |
| `platform` | `{ androidInterface?, iosHandler? }` | — | Passthrough to `detectPlatform()`. |
| `traits` | `Record<string, TraitDef>` | `{}` | Extra dimensions matched in rules, e.g. a `?mk=` channel. See [Traits](#traits). |
| `capabilities` | `Record<string, CapabilityRule>` | `{}` | Named boolean capabilities. |
| `variants` | `Record<string, VariantDef>` | `{}` | Named variants. |

### `CapabilityRule`

A partial map of platform → value. Each platform maps to one of:

- `true` — allowed regardless of version (works even when the version is unknown).
- `false` — never allowed.
- a **version constraint** string or `string[]` — allowed when the resolved version satisfies it. An **empty** array is rejected at `defineHostRules()` time (it expresses no real gate, so use `true` for "always allowed").

An **absent** platform key, or an explicit `undefined`, means the capability is `false` on that platform. A missing value is fail-safe: it never silently enables a capability, so `{ android: flags.enabled }` where `flags.enabled` is `undefined` resolves to `false`.

```ts
capabilities: {
  nativeShare: { android: ">=8.2", ios: true }, // iframe/web absent → false
}
```

A capability may also carry an optional `when` trait gate, ANDed on top of the per-platform result (see [Traits](#traits)). It only ever removes availability; it never turns a feature on for a platform you did not list.

```ts
capabilities: {
  promoBanner: { web: true, when: { traits: { mk: "google" } } },
}
```

### `VariantDef`

An ordered `rules` array plus a required `default`. Rules are evaluated top-to-bottom; the first fully-matching rule wins, otherwise `default` is returned.

```ts
variants: {
  saveFlow: {
    rules: [
      { when: { platform: "ios" }, use: "B" },
      { when: { platform: "android", version: ">=9" }, use: "B" },
      { when: { platform: "iframe", version: [">=2", "<4"] }, use: "C" },
    ],
    default: "A",
  },
}
```

A rule's `when` clause has optional `platform`, `version`, and `traits` keys; **at least one is required** (an empty `when: {}` throws at `defineHostRules()` time). Present keys combine with logical AND. A `version` or `traits` clause is skipped when that value is unknown, so the rule does not match and evaluation falls through to `default`.

## Traits

Traits are `(platform, version)`-independent dimensions matched in a `when` clause. Declare each one in `config.traits` as either a bare source or a `{ source, values }` object.

```ts
traits: {
  // Open-ended: any string value is accepted in rules.
  tenant: traitFromQuery("tenant"),
  // Declared domain: only these values type-check, and a typo is a compile error.
  mk: { source: traitFromQuery("mk"), values: ["google", "bing"] as const },
}
```

- **`TraitDef`** is `HostTraitSource | { source: HostTraitSource; values?: readonly string[] }`. `HostTraitSource` is `() => string | null`, the same shape as a version source.
- **Matching** in `when.traits` is equality; an array is "one of" (`{ mk: ["bing", "duck"] }`).
- **Unknown is conservative:** if a trait resolves to `null` (absent source value, or SSR), any rule or capability requiring it does not match.
- **Async acquisition:** `host.setTrait(name, value)` pushes a late value (the trait counterpart of `setVersion`); `setTrait(name, null)` clears it back to the source.

## Version constraint grammar

The comparator is written in-house (no semver dependency).

- **Version:** dot-separated numeric segments, 1–3 of them, with an optional leading `v`. `"2"` ≡ `2.0.0`, `"3.1"` ≡ `3.1.0`. Anything else (letters, pre-release tags, too many segments) is **unparsable** → treated as unknown.
- **Constraint:** an optional operator immediately followed by a version; a single space after the operator is tolerated (`">= 2"`). Operators: `>=`, `>`, `<=`, `<`, `=` (the default when omitted).
- **Array = AND:** `[">=2", "<4"]` enables ranges.
- **Comparison** is numeric per segment (major, minor, patch).
- **Boolean** short-circuits the version entirely: `true` = always, `false` = never.

Malformed constraint strings throw at `defineHostRules()` time with a message naming the offending capability or variant.

## Resolution order

Resolution runs lazily on first engine access and is cached; `refresh()` re-runs it.

1. **Platform.** If `window` is undefined (SSR) → `"web"`. Otherwise `detectPlatform(androidInterface, iosHandler)`. A dev `__setOverride({ platform })` wins over detection.
2. **Version** (client only; server → `null`):
   - a static string is used as-is;
   - a custom function returns `string | null`;
   - `versionFromQuery(param)` reads the query param (persisting to and falling back from `sessionStorage`);
   - `versionFromUserAgent(regex)` reads capture group 1 of the user agent.
   - An explicit `setVersion(v)` beats the configured source and persists across `refresh()`; `setVersion(null)` clears it. A dev `__setOverride({ version })` beats everything.
3. **Traits** (client only; server → `null`): each declared trait's source is invoked. An explicit `setTrait(name, v)` beats the source and persists across `refresh()`; a dev `__setOverride({ traits })` beats everything.
4. **Parse.** Unparsable version → `version: null`, but `versionRaw` keeps the original for diagnostics.
5. **Evaluate.** Capability: look up the resolved platform's rule (absent → `false`, boolean → itself, constraint → compare; unknown version → `false`), then apply any `when` trait gate. Variant: walk `rules` in order, first match wins, else `default`.

## Engine methods (`HostRules`)

| Method | Returns | Description |
| --- | --- | --- |
| `supports(name)` | `boolean` | Whether a capability is enabled. `name` is a typed union of the config's capability names. |
| `variant(name)` | inferred union | The resolved variant value — the union of that variant's rule values plus its `default`. |
| `select(map)` | `T` | Per-platform value pick; `map.default` is required. |
| `info()` | `HostInfo` | Resolved state (see below). Returns a stable reference until the next re-resolution. |
| `subscribe(listener)` | `() => void` | Subscribe to re-resolution (fires on `setVersion` / `setTrait` / `refresh` / `__setOverride`); returns an unsubscribe. |
| `setVersion(v)` | `void` | Imperative version for async acquisition. `v: string` sets, `null` clears. Re-resolves and notifies. A production API. |
| `setTrait(name, v)` | `void` | Imperative trait value for async acquisition. `v: string` sets, `null` clears back to the source. Re-resolves and notifies. A production API. |
| `refresh()` | `void` | Re-run resolution (re-invokes the version source unless a version was explicitly set). |
| `__setOverride(o)` | `void` | **Dev-only.** Force `{ platform?, version?, traits? }`, or `null` to clear. Not for production. |

### `HostInfo`

```ts
interface HostInfo {
  platform: "android" | "ios" | "iframe" | "web";
  version: string | null;    // the version string when it parsed, else null
  versionRaw: string | null; // exactly what the source produced, for diagnostics
  isNative: boolean;         // true for android / ios
  traits: Record<string, string | null>; // resolved trait values; null when unknown
}
```

## Version and trait sources

### `versionFromQuery(param?, options?)`

```ts
versionFromQuery("hv", { storageKey: "nbridge:host-version" });
```

Reads `?<param>=` from the URL (default param `hv`), persists it to `sessionStorage[storageKey]` (default `"nbridge:host-version"`), and falls back to the stored value when the param is absent. A fresh param wins over the stored value. Storage access is wrapped in try/catch — in contexts where `sessionStorage` throws, persistence silently degrades. Returns `null` when neither param nor storage yields a value.

### `versionFromUserAgent(regex)`

```ts
versionFromUserAgent(/MyApp\/([\d.]+)/);
```

Runs `regex` against `navigator.userAgent` and returns **capture group 1**, or `null` when there is no match.

### `traitFromQuery(param, options?)`

```ts
traitFromQuery("mk", { storageKey: "nbridge:trait:mk", persist: true });
```

Reads `?<param>=` from the URL for a trait value. Persists to `sessionStorage[storageKey]` (default `"nbridge:trait:<param>"`) so it survives navigation that drops the param; pass `{ persist: false }` to read only the current URL. Returns `null` when neither the param nor storage yields a value.

All built-ins are factories returning `() => string | null` (`HostVersionSource` / `HostTraitSource` are the same shape), so custom sources and built-ins share one type.

## React bindings — `createHostHooks(host)`

From `nbridge/react`. Parallel to `createBridgeHooks`; the engine is independent of any bridge instance. Call once per app, at module scope. Generics flow from the engine, so hook and component names/values are fully typed.

| Return | Signature | Description |
| --- | --- | --- |
| `useHostInfo` | `() => HostInfo` | Resolved state, reactive. |
| `useCapability` | `(name) => boolean` | A capability, reactive. |
| `useVariant` | `(name) => union` | A variant value, reactive. |
| `useTrait` | `(name) => string \| null` | A resolved trait value, reactive. |
| `CapabilityGate` | `{ capability, children, fallback? }` | Renders `children` when enabled, else `fallback`. |
| `PlatformOnly` | `{ platforms, children, fallback? }` | Renders `children` only on the listed platforms. |
| `VariantSwitch` | `{ name, cases, fallback? }` | Renders `cases[value]`, else `fallback`. `cases` keys are typed to the variant's values. |

Hooks are implemented with `useSyncExternalStore(host.subscribe, …)`. The engine caches its resolved snapshot, so `useHostInfo`'s snapshot is referentially stable (no re-render storm). The server snapshot is the conservative resolution (`web` / `null`).

## DevTools — `HostPanel`

From `nbridge/devtools`. The panel is wired automatically when you pass a `host` to `DevToolsUI`:

```tsx
import { DevToolsUI } from "nbridge/devtools";
import { instance } from "@/lib/bridge";
import { host } from "@/lib/host-rules";

<DevToolsUI bridge={instance} host={host} />;
```

A **Host** tab appears showing the resolved platform, raw + parsed version, and every capability, variant, and trait with its resolved value, plus platform, version, and trait override controls (which call `host.__setOverride()`) and a reset button. Traits with a declared `values` list render as a dropdown. The tab is omitted entirely when no `host` prop is passed, so the existing `DevToolsUI` API is unchanged.
