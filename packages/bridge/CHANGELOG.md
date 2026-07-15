# nbridge

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
