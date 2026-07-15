---
"nbridge": minor
---

Add **Host Rules** — a local, deterministic capability & variant engine keyed on `(platform, version)`.

nBridge apps run inside four kinds of hosts (Android WebView, iOS WKWebView, iframe, plain web), each in many versions. Host Rules replaces scattered `if (platform === "ios")` checks with a single per-app config: you declare named **capabilities** (booleans) and **variants** (string enums), and call sites only ever ask `host.supports("nativeShare")` or `host.variant("saveFlow")`. Platform names and version ranges live in exactly one file. Resolution is synchronous, needs no network, and is independent of the messaging bridge (importing the config server-side is safe). Capability and variant names are inferred as literal types, so a misspelled name is a compile error and `variant()` returns the exact union of its rule values.

New public APIs:

- `defineHostRules(config)` (root `nbridge` entry) — the engine factory. Config maps each capability to per-platform `boolean | version-constraint | string[]` values and each variant to ordered first-match-wins rules with a required `default`. Version constraints (`">=8.2"`, `[">=2", "<4"]`) use an in-house comparator; malformed constraints throw at define time. An unknown/unparsable version is conservative: version-gated capabilities are denied and version-gated variant rules are skipped.
- `versionFromQuery(param?, options?)` and `versionFromUserAgent(regex)` — built-in version sources (the query-param source, with `sessionStorage` persistence, is the zero-config default). The `version` option also accepts a static string or any `() => string | null` function.
- Engine methods: `supports`, `variant`, `select`, `info`, `subscribe`, `setVersion` (imperative version for async acquisition, e.g. a value that arrives over the bridge), `refresh`, and the dev-only `__setOverride`.
- `createHostHooks(host)` (`nbridge/react`) — `useHostInfo`, `useCapability`, `useVariant`, and the `CapabilityGate`, `PlatformOnly`, `VariantSwitch` components, all reactive via `useSyncExternalStore` and fully typed from the engine.
- `HostPanel` (`nbridge/devtools`) — a "Host" tab showing resolved host state with platform/version override controls, wired by passing an optional `host` prop to `DevToolsUI`.

No breaking changes: all additions are new exports, and `DevToolsUI`'s new `host` prop is optional.

Host Rules is UX policy, not access control — an embedder controls the URL and can fake the version, so gate presentation with Host Rules and enforce permissions server-side.
