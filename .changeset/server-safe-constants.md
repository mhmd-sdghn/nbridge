---
"nbridge": patch
---

Enums replaced with `as const` string-constant objects, exported from the framework-agnostic root entry so they are importable in React Server Components.

**Breaking** (experimental package):

- `BridgeBackAction` moved from `nbridge/next` to the root `nbridge` entry and is no longer returned by `createBridgeBackNavigation`. Import it with `import { BridgeBackAction } from "nbridge"` — this works in Server and Client Components alike, and stays the single import path as more framework entries are added. Values are unchanged (`"router-back"`, `"app-shutdown"`).
- `MessagePriority` is now a string-constant object (`"high" | "normal" | "low"` instead of numeric enum values). The `priority: "HIGH" | "NORMAL" | "LOW"` send option is unchanged. Offline queues persisted with the old numeric keys are migrated on load.
- `nbridge/next` is explicitly client-only again (`"use client"` on the entry). Importing its values in a Server Component yields client-reference placeholders — pure constants live in the root entry instead.