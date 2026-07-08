# nBridge — Independent npm Library: Master Plan

> **Status**: Planning — no code yet.
> **Package name**: **nBridge** (N = native) — npm package `nbridge` (npm requires lowercase; verified AVAILABLE 2026-07-05 — claim early with a 0.0.1 placeholder publish). Brand/docs/logo use "nBridge". Project folder: `C:\Users\Mo\Projects\nbridge`.
> **License**: MIT (decided).
> **Hosting**: GitHub (Actions CI, GitHub Pages for docs, npm publish with provenance).
> **v1.0 policy**: Wire the currently-inert features (compression, batching, offline queue, metrics, handshake) properly before 1.0. No advertised feature ships as a no-op.
> **Source of truth being extracted**: `C:\Users\Mo\Projects\rajman\features\packages\bridge` (`@features/bridge` v0.0.20).
>
> This file is the working memory for the project. Check items off as they land. Keep it updated every session.

---

## Architecture decisions (settled)

| Decision | Choice |
| --- | --- |
| Package layout | One package, subpath entries: `.` (core), `./react`, `./next`, `./devtools` |
| Validation | **Standard Schema** interface (types-only, vendored) — zod/valibot/ArkType work natively, yup via wrapper, validation fully optional. Zod removed from public API. |
| Forced deps on consumers | **None.** Core: zero peer deps (`pako` regular dep or pluggable). `./react`: peer `react ^18 \|\| ^19`. `./next`: optional peer `next`. `./devtools`: peer `react`, icons inlined as SVG (drop `lucide-react`). |
| Bundler | **tsdown** (multi-entry, `.d.ts`, preserves `"use client"`) |
| Tests | **Vitest** (port existing 24 jest test files) |
| Lint/format | **Biome** (same config style as rajman monorepo) |
| Versioning/publish | **Changesets** + GitHub Actions + npm provenance |
| Package validation | **publint** + **@arethetypeswrong/cli** in CI |
| Docs + landing | **VitePress** in same repo under `docs/` (rolldown.rs-style home layout), deployed to GitHub Pages |
| Dev environment | pnpm workspace with `playgrounds/` (Vite HMR + tsdown watch) |
| Devtools CSS | Precompiled at build time with Tailwind v4 CLI (no consumer Tailwind requirement) |

## Target repo layout

```
nbridge/                         # this folder = the new repo
├─ packages/bridge/              # the library
│  ├─ src/
│  │  ├─ core/                   # framework-agnostic engine
│  │  ├─ react/                  # hooks entry ("use client")
│  │  ├─ next/                   # Next.js back-navigation entry ("use client")
│  │  └─ devtools/               # devtools UI entry ("use client")
│  ├─ tsdown.config.ts
│  └─ package.json               # exports: ".", "./react", "./next", "./devtools", "./devtools/styles.css"
├─ playgrounds/
│  ├─ vanilla/                   # plain TS + Vite — proves core needs no framework
│  ├─ react/                     # Vite + React — hooks + devtools panel
│  ├─ iframe/                    # parent + child pages — real postMessage end-to-end
│  ├─ mock-native/               # fakes window.AndroidBridge / webkit.messageHandlers
│  └─ next/                      # Next app — ./next entry
├─ docs/                         # VitePress: landing page + docs site
├─ .changeset/
├─ .github/workflows/            # ci.yml, release.yml, docs.yml
├─ PLAN.md                       # ← this file
└─ package.json                  # pnpm workspace root
```

---

# Checklist

## Phase 0 — Decisions & bootstrap

- [x] Name: **nBridge** / npm `nbridge` (decided 2026-07-05; verified available)
- [x] Claim `nbridge` on npm early with a 0.0.1 placeholder publish (v0.0.1 published 2026-07-05)
- [x] License: MIT (decided 2026-07-05)
- [x] GitHub repo created & initial commit pushed: https://github.com/mhmd-sdghn/nbridge (2026-07-05)
- [x] `pnpm init` workspace root: `pnpm-workspace.yaml` (packages/*, playgrounds/*, docs)
- [x] Root tooling: TypeScript (strict), Biome config, `.editorconfig`, `.gitignore`, Lefthook pre-commit (biome) (2026-07-08)
- [x] Node/pnpm version pins (`engines`, `packageManager` field)

## Phase 1 — Package scaffold & build pipeline ✅ (2026-07-05)

- [x] `packages/bridge/package.json`: name, `"type": "module"`, `exports` map for 4 entries + `./devtools/styles.css`, `files`, `sideEffects` (CSS-only), `license`, peer deps (`react` optional, `next` optional via `peerDependenciesMeta`), React peer range `^18 || ^19`
- [x] `tsdown.config.ts` (tsdown 0.22): 4 entries, ESM, `.d.ts`, `"use client"` preserved
- [x] Tailwind v4 CLI build step → precompiled `dist/devtools/styles.css` (theme+utilities layers only, no preflight)
- [x] `publint` ("All good") + `attw --profile esm-only` green; wired as `pnpm verify:pkg`
- [x] Smoke-test install (2026-07-08): `pnpm pack` → installed the `nbridge-0.0.1.tgz` tarball in a standalone app outside the workspace. Consumer `tsc` (bundler resolution) resolves all 4 subpath entries (`.`/`./react`/`./next`/`./devtools`); core ESM entry loads + runs in plain Node; `nbridge/devtools/styles.css` resolves
- [x] Add `repository`/`homepage`/`bugs` fields once the GitHub repo URL is final

## Phase 2 — Extract & decouple (from `features/packages/bridge`) ✅ (2026-07-05)

- [x] Copy source; strip monorepo artifacts
- [x] **Zod removed from public API**: vendored Standard Schema interface (`src/types/standard-schema.ts`); validation via `~standard.validate` (sync+async), `BridgeValidationError` with issue formatting; new `defineMessage()` helper infers payload/response types from any compliant schema
- [x] `schemas/defaultSchemas.ts` deleted (zod-based) — examples live in docs instead
- [x] Root barrel split: `nbridge` (core, React-free), `nbridge/react` (createBridgeHooks), `nbridge/next` (createBridgeBackNavigation + navigation utils), `nbridge/devtools`
- [x] `pako` kept as regular dep (transitive, no consumer impact); `@types/pako` in package devDeps
- [x] `uuid` removed; `lucide-react` replaced with inline SVG icons (`devtools/components/icons.tsx`)
- [x] `process.env` reads guarded via `src/utils/env.ts`
- [x] `@features/bridge` references rewritten to `nbridge`

## Phase 3 — Integration pass: wire the inert features (v1.0 blockers)

*Findings from the code review of the original source (file:line refs are to `features/packages/bridge/src`):*

### Wire into the pipeline — ✅ all done (2026-07-05), each covered in `test/features-wiring.test.ts`
- [x] **Handshake**: opt-in `handshake: {enabled, timeout, retryInterval}`; `__nbridge_handshake__`/`__nbridge_handshake_ack__` protocol (either side may initiate); event-based `waitForReady` that REJECTS on timeout; default off for dumb hosts (legacy ready-on-init)
- [x] **Compression**: `maybeCompress` on the wire (`__compressed` flag), decompress on receive — works even when local compression is disabled; `algorithm` config honored as deflate-only reality (docs say keep "deflate")
- [x] **Offline queue**: `navigator.onLine` check + enqueue-on-adapter-failure; `online` event triggers flush; `priority` option honored (HIGH/NORMAL/LOW drain order); flush delivers straight to adapter (no double middleware)
- [x] **Batching**: fire-and-forget sends route through `BatchManager.add()`; size/time-triggered flush SENDS the `__nbridge_batch__` envelope; receive side unpacks; real sent/failed stats; expectResponse messages bypass batching
- [x] **Metrics**: recordSent/recordReceived/recordFailed wired with real byte sizes (TextEncoder)
- [x] **Retry**: `RetryManager` + `RetryConfig` deleted (queue keeps its own bounded retry)
- [x] Deleted: `cancellationToken`, `platformDetector` config, `DevToolsConfig.port`/`host`

### Bug fixes — mostly done (2026-07-05)
- [x] `WebAdapter.send` now throws a descriptive error instead of silently dropping (loopback documented as the dev mode)
- [x] `useBridgeReady` catches rejection; new `useBridgeReadyState()` exposes `{ready, error}`
- [x] `useBridgeRPC`: lifetime subscription (no subscribe-after-send race) + message-id correlation for concurrent calls
- [x] `useBackIntercept`: re-registers on `pathName` change (deps fixed)
- [x] `teardownSessionHistoryTracking()` exported for production teardown
- [ ] `BackInterceptManager`: iOS swipe-back multi-pop hardening — DEFERRED, known limitation (needs device testing; revisit before 1.0)
- [x] `setupBackInterception` one-shot self-unregisters after firing (no double shutdown)
- [x] `BackInterceptManager` (2026-07-07): self-initiated trap-release `history.back()` tracked via `selfPopInFlight` and consumed in `handlePopstate`, so an unregister→register cycle in the same tick (React StrictMode dev remount, effect-deps churn) no longer misfires the intercept on mount; `useBridgeBack` returns `useCallback`-stable functions
- [ ] `canNavigateBack` browser-mode referrer heuristic — kept as-is, documented; "session" mode (default) is unaffected
- [ ] Iframe origin hard-require — kept as warn-on-wildcard default for DX; docs strongly push `iframeParentOrigin`. Revisit for 1.0 (consider making it required)
- [x] `BridgeDevTools`: runtime `setEnabled()`, interceptor-stacking guard (marker on wrapped console fns), no collection/patching in production builds
- [x] Incoming pipeline rejections caught and logged at bridge level
- [x] `createBridgeHooks` multi-instance behavior documented (call once at module scope)

### Devtools polish — resolved by redesign (2026-07-05)
- [x] **Form generator replaced entirely**: zod-introspecting `zodToFormFields`/`SchemaFormGenerator`/`FormField` deleted; SendEventPanel now uses a JSON payload editor pre-filled from `schema.example`, validated via `~standard.validate` (works with ANY validator, shows issues inline). This removed the unfixable zod coupling and the nested-error/`0`-snapping bugs wholesale.
- [x] SendEventPanel: custom events can await responses (`sendWithResponse` toggle); uses public `bridge.getAllSchemas()` instead of `(bridge as any).config`
- [x] EventHistoryPanel shows the full devtools buffer (respects `maxMessageHistory`)
- [x] Panel has `role="dialog"` + tablist/tab ARIA semantics (focus trap still TODO — minor)
- [x] No manual memoization left in devtools components

## Phase 4 — Tests — 50 tests, 6 files, all passing (core 2026-07-05; hooks + type tests 2026-07-08)

- [x] Vitest (jsdom) configured; NEW suite written instead of porting the old jest files (old suite tested managers in isolation — the exact anti-pattern that hid the inert features)
  - `test/core-messaging.test.ts` — send/receive/respond, id correlation, timeout, handshake (both directions + timeout rejection), WebAdapter honesty, loopback
  - `test/features-wiring.test.ts` — compression on-wire + cross-config decompress, batch envelope/immediate-flush/no-batch-for-rpc/receive-unpack, queue enqueue-on-failure/priority-drain, metrics counters/failures, middleware transform + no-unhandled-rejection
  - `test/schema-validation.test.ts` — zod AND valibot (validator-agnostic), transforms applied to the wire, response validation, no-validator mode
- [x] React hooks tests (`test/react-hooks.test.tsx`, 2026-07-08): ready-state (immediate/handshake-timeout-as-error/ack-flip), `useBridgeMessage` latest-closure + unmount, `useBridgeRequest` loading/data/timeout, `useBridgeRPC` id correlation for concurrent calls + foreign-response rejection
- [ ] Iframe boundary integration test in a real browser (Vitest browser mode or Playwright)
- [x] Type-level tests (`test/types.test.ts`, 2026-07-08): `expectTypeOf` on `defineMessage` inference (zod + valibot + transform + no-schema fallback) and registry `MessageTypes`/`PayloadFor`/`ResponseFor`; enforced by `pnpm typecheck`

## Phase 5 — Dev environment (playgrounds) — 5 of 5 done (2026-07-08), all build+typecheck green

- [x] `playgrounds/vanilla` — loopback + handshake, send form, onWithResponse round-trip
- [x] `playgrounds/react` — all hooks + DevToolsUI panel + devtools styles.css
- [x] `playgrounds/iframe` — nbridge child + RAW-postMessage parent host (executable parent-side contract doc)
- [x] `playgrounds/mock-native` — fake `window.AndroidBridge` host: handshake ack, batch unpack, delayed responders, fake toast, live metrics (executable native contract doc)
- [x] `playgrounds/next` (2026-07-08) — App Router app exercising `nbridge/next`: module-scope `createBridgeHooks` (SSR-safe), `useBridgeBack` router-back-or-shutdown across home/details/success routes, one-shot hardware-back intercept on the success screen. `next build` prerenders all 6 routes clean (proves the `next` entry works end-to-end under RSC/SSR)
- [x] CONTRIBUTING.md documents the dev loop (tsdown watch + playground)

## Phase 6 — CI/CD (GitHub Actions) — workflows written (2026-07-05), untested until repo exists

- [x] `ci.yml`: lint → typecheck → test → build → publint+attw (PR + main)
- [x] `release.yml`: changesets action → version PR → npm publish with provenance (needs `NPM_TOKEN` secret)
- [x] `docs.yml`: VitePress build → GitHub Pages (enable Pages → "GitHub Actions" source in repo settings)
- [x] `.changeset/config.json` (changelog-github, ignores docs/playgrounds)
- [ ] Branch protection + PR template requiring a changeset — PR template added (`.github/pull_request_template.md`, 2026-07-08); branch protection still to do in GitHub settings
- [ ] First green CI run on the real repo

## Phase 7 — Docs website + landing page ✅ (2026-07-05) — `pnpm docs:build` green, zero dead links

- [x] VitePress in `docs/`: rolldown.rs-style landing (teal/cyan brand, hero glow, logo.svg), 8 feature cards, zod/valibot/no-validator code-group
- [x] Docs written FRESH against the new API (not migrated — old docs described the old/inert behavior): 16 guide pages + 3 reference pages (bridge-config tables, bridge-manager methods, wire protocol)
- [x] Native integration guides: Android (Kotlin) + iOS (Swift) adapted to the new protocol; iframe page includes a complete parent-side host implementation
- [x] Honest caveats documented: algorithm is deflate-only; `_error` replies resolve (not reject) with `{error}` payload
- [ ] Optional: embedded live examples (Sandpack/StackBlitz) — later polish

## Phase 8 — Release

- [ ] `0.x` prereleases consumed from a playground via `pnpm pack` tarball, then from npm
- [ ] Dogfood: swap rajman monorepo's `@features/bridge` for the published package in ONE app (e.g. weather-webview) as real-world validation
- [ ] API review freeze → `1.0.0` via changesets
- [ ] Announce; archive/deprecate the in-monorepo copy (or make it a thin re-export of the npm package)

---

## Session log

| Date | What happened |
| --- | --- |
| 2026-07-05 | Investigation complete (coupling audit, unfinished-feature review via 2 agents, toolchain + website decisions). Plan created. No code yet. |
| 2026-07-05 | Name decided: **nBridge** (npm `nbridge`, verified available). License: MIT. Folder renamed to `C:\Users\Mo\Projects\nbridge`. |
| 2026-07-08 | Cleared the remaining locally-completable checklist. Root tooling finished (`.editorconfig`, Lefthook pre-commit running Biome), PR template with changeset requirement, Phase-0/1 items verified. Phase-4: React hooks tests + type-level (`expectTypeOf`) tests → 50 tests / 6 files. Phase-1: tarball smoke test in a standalone out-of-workspace app (all 4 entries resolve, core ESM runs in Node, CSS resolves). Phase-5: `playgrounds/next` App Router app — `next build` prerenders all 6 routes clean, validating the `nbridge/next` entry end-to-end under SSR. **Still open — all require resources outside this machine or are deferred design calls:** npm publish/CI/branch-protection (need GitHub; `gh` not installed, 3 commits unpushed), rajman dogfood + 1.0 release, real-browser iframe test (needs browser binaries), iOS swipe-back (needs device), iframe-origin-required + `canNavigateBack` heuristic (deliberate keep-until-1.0 decisions), Sandpack docs examples (optional polish). |
| 2026-07-05 | **Big build session — Phases 1–3 + most of 4–7 DONE.** Workspace scaffolded (pnpm/tsdown 0.22/vitest/biome/changesets). Library extracted + decoupled (Standard Schema, 4 entries, no zod/lucide/uuid). ALL inert features wired for real (handshake, compression, batching, queue, metrics) + review bugs fixed. 30/30 tests green; publint+attw green; 4 playgrounds build; VitePress docs+landing build. CI/release/docs workflows written. **Remaining:** Mo creates GitHub repo + npm claim; then first CI run, tarball smoke test, hooks tests, next-playground, iOS swipe-back hardening, dogfood in rajman, 0.x → 1.0 (Phase 8). |
