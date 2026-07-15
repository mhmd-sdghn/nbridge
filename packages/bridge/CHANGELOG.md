# nbridge

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
