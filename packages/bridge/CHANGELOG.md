# nbridge

## 0.2.0

### Minor Changes

- [#7](https://github.com/mhmd-sdghn/nbridge/pull/7) [`4dd97f0`](https://github.com/mhmd-sdghn/nbridge/commit/4dd97f0716d638830ab1c4a55d3e706e8272718c) Thanks [@mhmd-sdghn](https://github.com/mhmd-sdghn)! - Correctness, security, reliability, and DX hardening pass across the whole
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

## 0.1.1

### Patch Changes

- [#5](https://github.com/mhmd-sdghn/nbridge/pull/5) [`effeb44`](https://github.com/mhmd-sdghn/nbridge/commit/effeb44a77f4caa80917e161dbf06eaecbaae537) Thanks [@mhmd-sdghn](https://github.com/mhmd-sdghn)! - Add **traits** to Host Rules: match capabilities and variants on dimensions beyond `(platform, version)`.

  A trait is a named string dimension with its own pluggable source, e.g. a `?mk=` marketing channel. Declare traits in `defineHostRules({ traits })` and match them in a rule's `when`:

  ```ts
  const host = defineHostRules({
    traits: {
      // Declare `values` to type-check them in rules (a typo is a compile error).
      mk: { source: traitFromQuery("mk"), values: ["google", "bing"] as const },
    },
    capabilities: {
      // `when` adds a trait gate ANDed on top of the per-platform rule.
      promoBanner: { web: true, when: { traits: { mk: "google" } } },
    },
    variants: {
      saveFlow: {
        rules: [
          { when: { traits: { mk: "google" } }, use: "A" },
          { when: { traits: { mk: ["bing", "duckduckgo"] } }, use: "B" }, // array = one of
        ],
        default: "A",
      },
    },
  });
  ```

  New and extended APIs (all additive, no breaking changes):

  - `traits` config key; the `traitFromQuery(param, { storageKey?, persist? })` built-in source (persists to `sessionStorage` by default, like `versionFromQuery`); `HostTraitSource` and `TraitDef` types.
  - `when` gains an optional `traits` clause on variant rules, and capabilities gain an optional `when` trait gate. Trait matching is equality, an array is "one of", and multiple `when` conditions AND together.
  - `host.setTrait(name, value)` for async acquisition (the trait counterpart of `setVersion`), and `useTrait(name)` from `createHostHooks`.
  - Unknown traits are conservative, exactly like an unknown version: a rule or capability that requires an absent trait does not match, so the React server snapshot stays consistent and hydration never mismatches.
  - The DevTools **Host** tab shows resolved traits and adds trait override controls (a dropdown when the trait declares `values`).

  Trait values are typed from the config: declare `values` for a compile-checked domain, or omit it for open-ended strings.

## 0.1.0

### Minor Changes

- [#3](https://github.com/mhmd-sdghn/nbridge/pull/3) [`b57fd40`](https://github.com/mhmd-sdghn/nbridge/commit/b57fd40a63def07b4ec821c44bac29afeaab0393) Thanks [@mhmd-sdghn](https://github.com/mhmd-sdghn)! - Add **Host Rules** — a local, deterministic capability & variant engine keyed on `(platform, version)`.

  nBridge apps run inside four kinds of hosts (Android WebView, iOS WKWebView, iframe, plain web), each in many versions. Host Rules replaces scattered `if (platform === "ios")` checks with a single per-app config: you declare named **capabilities** (booleans) and **variants** (string enums), and call sites only ever ask `host.supports("nativeShare")` or `host.variant("saveFlow")`. Platform names and version ranges live in exactly one file. Resolution is synchronous, needs no network, and is independent of the messaging bridge (importing the config server-side is safe). Capability and variant names are inferred as literal types, so a misspelled name is a compile error and `variant()` returns the exact union of its rule values.

  New public APIs:

  - `defineHostRules(config)` (root `nbridge` entry) — the engine factory. Config maps each capability to per-platform `boolean | version-constraint | string[]` values and each variant to ordered first-match-wins rules with a required `default`. Version constraints (`">=8.2"`, `[">=2", "<4"]`) use an in-house comparator; malformed constraints throw at define time. An unknown/unparsable version is conservative: version-gated capabilities are denied and version-gated variant rules are skipped.
  - `versionFromQuery(param?, options?)` and `versionFromUserAgent(regex)` — built-in version sources (the query-param source, with `sessionStorage` persistence, is the zero-config default). The `version` option also accepts a static string or any `() => string | null` function.
  - Engine methods: `supports`, `variant`, `select`, `info`, `subscribe`, `setVersion` (imperative version for async acquisition, e.g. a value that arrives over the bridge), `refresh`, and the dev-only `__setOverride`.
  - `createHostHooks(host)` (`nbridge/react`) — `useHostInfo`, `useCapability`, `useVariant`, and the `CapabilityGate`, `PlatformOnly`, `VariantSwitch` components, all reactive via `useSyncExternalStore` and fully typed from the engine.
  - `HostPanel` (`nbridge/devtools`) — a "Host" tab showing resolved host state with platform/version override controls, wired by passing an optional `host` prop to `DevToolsUI`.

  No breaking changes: all additions are new exports, and `DevToolsUI`'s new `host` prop is optional.

  Host Rules is UX policy, not access control — an embedder controls the URL and can fake the version, so gate presentation with Host Rules and enforce permissions server-side.

## 0.0.4

### Patch Changes

- [`fbd08a1`](https://github.com/mhmd-sdghn/nbridge/commit/fbd08a12b0406c692f934da8fc071f857eab6511) Thanks [@mhmd-sdghn](https://github.com/mhmd-sdghn)! - Enums replaced with `as const` string-constant objects, exported from the framework-agnostic root entry so they are importable in React Server Components.

  **Breaking** (experimental package):

  - `BridgeBackAction` moved from `nbridge/next` to the root `nbridge` entry and is no longer returned by `createBridgeBackNavigation`. Import it with `import { BridgeBackAction } from "nbridge"` — this works in Server and Client Components alike, and stays the single import path as more framework entries are added. Values are unchanged (`"router-back"`, `"app-shutdown"`).
  - `MessagePriority` is now a string-constant object (`"high" | "normal" | "low"` instead of numeric enum values). The `priority: "HIGH" | "NORMAL" | "LOW"` send option is unchanged. Offline queues persisted with the old numeric keys are migrated on load.
  - `nbridge/next` is explicitly client-only again (`"use client"` on the entry). Importing its values in a Server Component yields client-reference placeholders — pure constants live in the root entry instead.

## 0.0.2

### Patch Changes

- [`18ba1a6`](https://github.com/mhmd-sdghn/nbridge/commit/18ba1a61184fcfd6cb2b6bb0a4767f72af78f086) Thanks [@mhmd-sdghn](https://github.com/mhmd-sdghn)! - Documentation moved to GitHub Pages — https://mhmd-sdghn.github.io/nbridge (previously Vercel); the package `homepage` now points there.

  The package is labeled **experimental** rather than "pre-release": it is published and usable, but APIs may still change.

  No runtime or API changes in this release. Internal only: added a Next.js App Router playground and a publish-tarball smoke test, releases now authenticate via npm OIDC trusted publishing, and CI/local dev moved to Node 24.
