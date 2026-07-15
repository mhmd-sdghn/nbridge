# Contributing to nBridge

Thanks for helping build nBridge! This guide covers everything you need:
setup, the dev loop, architecture, project rules, testing, docs, and releases.

## Prerequisites

- **Node.js >= 20**
- **pnpm >= 11** (`corepack enable` or `npm i -g pnpm`)
- Windows, macOS, and Linux all work — the toolchain is cross-platform.

## Repository layout

```
nbridge/
├─ packages/bridge/        # THE library (npm: nbridge) — everything ships from here
│  ├─ src/
│  │  ├─ index.ts          # core entry (framework-free)
│  │  ├─ core/             # BridgeManager, adapters, managers (queue/batch/compression/metrics/devtools)
│  │  ├─ constants/        # protocol.ts (wire contract!), messageTypes.ts
│  │  ├─ types/            # public types, schema.ts, vendored standard-schema.ts
│  │  ├─ middleware/       # built-in middleware
│  │  ├─ utils/            # helpers, env guards, platform detection
│  │  ├─ host/             # host rules engine — capability/variant resolution per (platform, version)
│  │  ├─ react/            # nbridge/react entry (createBridgeHooks, createHostHooks)
│  │  ├─ next/             # nbridge/next entry (back-navigation, needs optional `next` peer)
│  │  └─ devtools/         # nbridge/devtools entry (panel UI + styles.source.css)
│  ├─ test/                # vitest suites (jsdom)
│  ├─ tsdown.config.ts     # build: 4 entries + CSS via onSuccess hook
│  └─ package.json         # exports map — the public API surface
├─ playgrounds/            # runnable demos = the dev environment (see below)
├─ docs/                   # VitePress site: landing page + documentation
├─ .github/workflows/      # ci.yml, release.yml, docs.yml
└─ .changeset/             # release management
```

## Setup

```bash
pnpm install     # from the repo root — installs every workspace
pnpm build       # build the library once; playgrounds resolve nbridge from dist/
```

## Development loop

Two terminals:

```bash
# terminal 1 — library in watch mode (rebuilds dist/ + devtools CSS on every change)
pnpm dev

# terminal 2 — a playground (Vite, hot-reloads when dist/ changes)
pnpm --filter playground-vanilla dev       # core API over loopback
pnpm --filter playground-mock-native dev   # fake Android host — adapters, handshake, batching, wire protocol
pnpm --filter playground-iframe dev        # real parent <-> child postMessage
pnpm --filter playground-react dev         # React hooks + DevTools panel
```

Open the URL Vite prints (usually `http://localhost:5173`). Pick the
playground that exercises what you're changing — `mock-native` shows the raw
wire traffic and is the best place to debug protocol work; `react` is where
you verify hooks and the DevTools panel.

The DevTools panel toggles with **Ctrl+Shift+B** (or the floating button).

### Docs site

```bash
pnpm docs:dev      # hot-reloading VitePress site (landing at /, Guide + Reference in nav)
pnpm docs:build    # must pass before a docs PR — also catches dead links
```

## Architecture in five minutes

- **`BridgeManager`** (`src/core/BridgeManager.ts`) owns the pipeline.
  Outgoing: `send()` → schema validation (Standard Schema) → batching (fire-and-forget only)
  → middleware chain → compression → adapter. Incoming: adapter → handshake/protocol
  handling → decompression → middleware → batch unpack → response correlation (by
  message id) or handler dispatch.
- **Adapters** (`src/core/adapters/`) are the transport layer: Android
  (JSON strings via `AndroidBridge.postMessage`), iOS (raw objects via
  `webkit.messageHandlers`), iframe (`postMessage` to parent), and web
  (loopback for dev; throws honestly otherwise). Auto-detected in that order.
  The Android/iOS serialization asymmetry is intentional — don't "align" it.
- **Wire protocol** (`src/constants/protocol.ts`): `__nbridge_handshake__` /
  `__nbridge_handshake_ack__` / `__nbridge_batch__`. Native hosts depend on
  these exact strings — treat them as frozen API.
- **Validation**: the vendored Standard Schema interface
  (`src/types/standard-schema.ts`) is the ONLY validation contract. zod,
  valibot, and ArkType satisfy it natively; nBridge itself depends on none
  of them.
- **Host Rules** (`src/host/`) is a standalone engine — it does NOT touch
  `BridgeManager`. `defineHostRules()` compiles a per-app config into
  capability/variant resolvers keyed on `(platform, version)`. It reuses
  `utils/platform.ts` for detection, resolves synchronously (lazily on first
  access, cached), and validates version constraints at define time (fail
  fast at boot). The React bindings (`createHostHooks`) and devtools `HostPanel`
  are thin layers over the same engine instance.

## Project rules (the non-negotiables)

1. **The core entry (`nbridge`) stays framework-free and validator-free.**
   No React, no Next, no zod imports anywhere under `src/core`, `src/types`,
   `src/utils`, `src/middleware`, `src/constants`, or `src/index.ts`.
2. **No inert features.** If a config option exists, it must do something,
   be wired into the real pipeline, and have a test in
   `test/features-wiring.test.ts` proving it works end-to-end. (The library's
   predecessor shipped compression/batching/queue/metrics as silent no-ops —
   never again.)
3. **Wire-protocol changes are breaking changes for native hosts.** New
   protocol messages go in `src/constants/protocol.ts`, get documented in
   `docs/reference/protocol.md`, and get demonstrated in the `mock-native`
   playground's fake host in the same PR.
4. **Fail loudly.** No silent drops, no `catch {}` that swallows errors, no
   success responses for messages that went nowhere.
5. **ESM only.** No CJS output, no `require`. `process.env` reads must go
   through `src/utils/env.ts` (plain-browser safety).
6. **Every entry must keep passing `pnpm verify:pkg`** (publint +
   arethetypeswrong) — the exports map in `package.json` is public API.
7. **Peer deps stay optional and minimal.** Consumers must never be forced
   to install a validator, React, or Next unless they import the entry that
   needs it.

## Coding standards

- **TypeScript strict** + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`.
  Guard indexed access; don't sprinkle `!`.
- **Biome** formats and lints (2-space, 80 cols, double quotes, trailing
  commas). Run `pnpm lint:fix` before committing. Suppressions need a reason:
  `// biome-ignore lint/<rule>: <why>`.
- React components/hooks: `"use client"` banner on entry files, cleanup in
  every `useEffect`, refs for callbacks to avoid stale closures (see
  `useBridgeMessage` for the pattern). No manual memoization in devtools
  components.
- Comments explain **why**, not what. Protocol/behavioral constraints
  (e.g. the iOS/Android serialization asymmetry) deserve a comment; obvious
  code doesn't.

## Testing

```bash
pnpm test                                  # run everything (vitest, jsdom)
pnpm --filter nbridge test:watch           # watch mode
```

- `test/core-messaging.test.ts` — send/receive/respond, correlation, handshake, readiness
- `test/features-wiring.test.ts` — proves each feature works through the REAL pipeline
- `test/schema-validation.test.ts` — validator-agnosticism (runs zod AND valibot)
- `test/host-version.test.ts` — version parser + constraint comparator
- `test/host-rules.test.ts` — engine resolution (capabilities, variants,
  version sources, `setVersion`/`refresh`/`__setOverride`, SSR)
- `test/host-react.test.tsx` — `createHostHooks` hooks and gate components
- `test/helpers.ts` — `installAndroidBridge()` (fake native host) and
  `receiveFromNative()` — use these instead of inventing new mocks.

Rules of thumb:
- Test through the public API (`createBridge`), not managers in isolation.
- A new feature or bugfix lands with the test that would have caught it.
- Cross-validator behavior gets tested with at least zod and valibot.

## Pull request checklist

All of this must pass locally (CI runs the same gate):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:pkg
```

Plus:

- [ ] Docs updated (`docs/`) for any user-facing change — `pnpm docs:build` passes
- [ ] `mock-native` playground updated if the wire protocol changed
- [ ] A **changeset** included if `packages/bridge` changed (see below)
- [ ] No new dependencies in `packages/bridge` `dependencies` without prior discussion
      (`pako` is currently the only one — keep it that way)

## Changesets & releasing

Every PR that changes the published package needs a changeset:

```bash
pnpm changeset     # pick patch/minor/major, write a user-facing description
```

Semver guidance while pre-1.0: breaking API/protocol changes → **minor**;
everything else → **patch**. After 1.0: protocol and exports-map changes are
**major**.

On merge to `main`, the release workflow opens/updates a "chore: release" PR
that aggregates changesets. Merging that PR publishes to npm with provenance.
Never publish manually; never edit versions by hand.

## Troubleshooting

- **`nbridge/devtools/styles.css` cannot be resolved** — the library hasn't
  been built yet (or an old `pnpm dev` from before the CSS hook is running).
  Run `pnpm build` once, restart `pnpm dev`.
- **Playground shows stale behavior** — check terminal 1: is tsdown watch
  actually running and rebuilding? Vite only reloads when `dist/` changes.
- **Port conflict** — Vite and VitePress both default to 5173 and auto-bump
  to the next free port; always use the URL printed in the terminal.
- **`pnpm install` warns about ignored build scripts** — approved builds are
  pinned in `pnpm-workspace.yaml` (`allowBuilds`); add new ones there
  deliberately, never blanket-approve.
- **DevTools panel not appearing** — the bridge config needs
  `devTools: { enabled: true, ... }`, and devtools are hard-disabled when
  `NODE_ENV === "production"`. Vite dev mode is fine.

## Questions / design discussions

Open a GitHub issue. For anything touching the wire protocol or the public
exports map, open the issue **before** writing code — those surfaces are
contracts with native apps and published consumers.
