# nBridge

**Type-safe, real-time communication between web apps and their hosts — Android WebView, iOS WKWebView, and iframes — with one API.**

> ⚠️ **Experimental** — under active development. APIs may change without notice. Use wisely.

- 📦 Package: [`nbridge` on npm](https://www.npmjs.com/package/nbridge) — source in [`packages/bridge`](packages/bridge)
- 📖 Docs: [mhmd-sdghn.github.io/nbridge](https://mhmd-sdghn.github.io/nbridge) — source in [`docs/`](docs)
- 🎮 Playgrounds: [`playgrounds/`](playgrounds) — run `pnpm dev` demos

## Features

- **One API, four transports** — Android WebView, iOS WKWebView, iframe `postMessage`, and a web loopback for development
- **Bring your own validator** — schema validation via [Standard Schema](https://standardschema.dev): zod, valibot, ArkType, or none at all. Nothing is forced on you.
- **Promise-based request/response** — `sendWithResponse` with timeouts and correlation
- **Handshake protocol** — `ready` means the other side actually answered
- **Middleware** — intercept, transform, or block messages in both directions
- **Batching & compression** — opt-in wire optimizations
- **Offline queue** — messages survive disconnects and replay on reconnect
- **React bindings** — `nbridge/react` hooks; `nbridge/next` back-navigation helpers
- **DevTools** — in-page panel: event history, logs, metrics, schema-driven event sender

## Development

### First-time setup

```bash
pnpm install        # from the repo root (Node >= 22, pnpm >= 11)
pnpm build          # build the library once — playgrounds import from dist/
```

### Development mode

Run the library in watch mode in one terminal, and a playground in another —
Vite hot-reloads the playground whenever `dist/` is rebuilt:

```bash
# terminal 1 — rebuild the library on every change
pnpm dev

# terminal 2 — pick the playground that matches what you're working on
pnpm --filter playground-vanilla dev       # core API over loopback
pnpm --filter playground-mock-native dev   # fake Android host (adapters, handshake, batching, protocol)
pnpm --filter playground-iframe dev        # real parent <-> child postMessage
pnpm --filter playground-react dev         # React hooks + DevTools panel
```

Each playground prints its local URL (usually `http://localhost:5173`) —
open it in the browser. See [`playgrounds/README.md`](playgrounds/README.md)
for what each one demonstrates.

### Docs + landing page

The landing page and documentation are one VitePress site in [`docs/`](docs):

```bash
pnpm docs:dev       # dev server with hot reload — URL printed in terminal (usually http://localhost:5173)
pnpm docs:build     # production build → docs/.vitepress/dist
pnpm --filter nbridge-docs docs:preview   # serve the production build locally
```

The site root (`/`) is the landing page; the guide and reference live under
**Guide** and **Reference** in the top navigation. On `main`, the site
deploys automatically to GitHub Pages via `.github/workflows/docs.yml`.

### Checks before a PR

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:pkg
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

[MIT](LICENSE)
