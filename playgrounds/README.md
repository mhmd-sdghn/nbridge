# nbridge playgrounds

Four small Vite apps for developing and demoing the `nbridge` library. Each one
exercises a different platform adapter and feature set of the bridge, with the
same dark, dependency-free UI.

| Playground | Platform adapter | What it demonstrates |
| --- | --- | --- |
| [`vanilla`](./vanilla) | web (loopback) | Plain TypeScript. `createBridge` with `webLoopback: true` + handshake (self-completing over loopback), fire-and-forget `send`/`on` echo log, and a full `onWithResponse` → `sendWithResponse` request/response round-trip (`math:square`). |
| [`mock-native`](./mock-native) | android (faked) | The star demo. A fake `window.AndroidBridge` host is installed before the bridge is created, so nbridge auto-detects Android and talks over the real wire (`AndroidBridge.postMessage` / `window.sendBridgeMessage`). The host panel is executable documentation of the native contract: handshake ack, correlated `*_response` replies (`device:getInfo`), `toast:show`, and `__nbridge_batch__` envelope unpacking. Includes batching (`maxSize: 5`, `maxWait: 300`) and a live metrics readout. |
| [`iframe`](./iframe) | iframe (real postMessage) | Parent + child pages served by one Vite dev server. The child uses nbridge (`iframeParentOrigin`, handshake); the parent implements the host side **raw** — origin/source checks, handshake ack, a `parent:getTitle` responder, batch unpacking, and pushing messages into the child via `iframe.contentWindow.postMessage`. |
| [`react`](./react) | web (loopback) | React 19. `createBridgeHooks` at module scope, `useBridgeReadyState`, `usePlatform`, `useBridgeSend`, `useBridgeMessage`, `useBridgeRequest` (against an `onWithResponse("user:get")` responder), `useBridgeMetrics`, and the `<DevToolsUI />` panel from `nbridge/devtools` (toggle with `Ctrl+Shift+B`). |

## Running

The playgrounds consume `nbridge` via `workspace:*` and import its built
`dist/` output, so build the library first.

```bash
# from the repo root, once
pnpm install
pnpm build        # builds packages/bridge (nbridge) to dist/

# then run any playground
pnpm --filter playground-vanilla dev
pnpm --filter playground-mock-native dev
pnpm --filter playground-iframe dev
pnpm --filter playground-react dev
```

Each app opens on the Vite dev server URL it prints (usually
`http://localhost:5173`).

Notes:

- After changing library source, rebuild it (`pnpm --filter nbridge build`, or
  keep `pnpm --filter nbridge dev` running for watch mode) — the playgrounds
  resolve the compiled `dist/`, not `src/`.
- The DevTools panel (react playground) only renders in development builds;
  `vite dev` serves development mode, so it works out of the box.
- The `iframe` playground's `child.html` must be viewed through the parent
  page (`/index.html`). Opened directly, it is a top-level window, so nbridge
  falls back to the web adapter and sends will fail (loopback is not enabled
  there).
