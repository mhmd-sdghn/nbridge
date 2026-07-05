# DevTools

`nbridge/devtools` is an in-page debugging panel: live message history, bridge logs, metrics, and a form for hand-sending events — right inside the WebView, where browser devtools are often awkward to attach.

## Setup

Two requirements:

1. The bridge must be created with `devTools.enabled: true`.
2. Mount `DevToolsUI` and import the stylesheet once.

```tsx
// src/lib/bridge.ts
import { createBridgeHooks } from "nbridge/react";

export const { instance } = createBridgeHooks({
  config: {
    debug: true,
    devTools: {
      enabled: process.env.NEXT_PUBLIC_BRIDGE_DEV_TOOLS === "true",
      maxMessageHistory: 50,      // messages kept in the history tab
      logDestination: "devtools", // "console" | "devtools" | "both" | "none"
      maxConsoleLogEntries: 100,  // console entries mirrored into the panel
    },
  },
});
```

```tsx
// app/layout.tsx (or any client component near the root)
"use client";

import { DevToolsUI } from "nbridge/devtools";
import "nbridge/devtools/styles.css";
import { instance } from "@/lib/bridge";

export function BridgeDevTools() {
  return <DevToolsUI bridge={instance} defaultOpen={false} />;
}
```

Toggle the panel with **Ctrl+Shift+B**, close with **Escape**, or use the floating trigger button. The panel renders into a portal on `document.body`.

::: warning Production builds
DevTools are **disabled automatically when `NODE_ENV` is `"production"`** — the console patcher and log collection refuse to start, and a warning is emitted instead. Ship the component gated behind an environment flag anyway to avoid the bundle weight.
:::

## Panels

| Tab | Shows |
| --- | --- |
| **Events** | Sent/received message history with direction, type, payload, and timing (up to `maxMessageHistory`). |
| **Logs** | Bridge-internal logs, plus mirrored `console.*` output when `logDestination` routes there. |
| **Metrics** | Live [metrics](/guide/features/metrics), queue stats, and batch stats — when those features are enabled. |
| **Send** | Hand-craft and send a message. With [schemas](/guide/schemas) registered, message types are listed and each schema's `example` payload is pre-filled. |

## Log routing

The bridge routes its logging (and `bridge.log/warn/error/info(...)`) according to `devTools.logDestination`:

- `"devtools"` (default) — only into the panel's Logs tab
- `"console"` — only the browser console
- `"both"` — both
- `"none"` — silence

Debug-level messages require `debug: true` on the bridge config; errors always log.

## Without React

The panel UI is React, but collection is not. Any bridge with `devTools.enabled: true` records history and logs; you can reach the collector directly:

```ts
bridge.isDevToolsEnabled(); // boolean
bridge.getDevTools();       // BridgeDevTools | null — message history, logs, stats providers
```
