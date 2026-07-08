# nBridge

Type-safe, real-time communication between web apps and their hosts —
Android WebView, iOS WKWebView, and iframes — with one API.

> ⚠️ **Experimental package** — under active development. APIs may change
> without notice between versions. Use wisely.

```bash
npm install nbridge
```

```ts
import { createBridge, defineMessage } from "nbridge";
import { z } from "zod"; // or valibot, ArkType, or nothing at all

const bridge = createBridge({
  handshake: { enabled: true },
  schemas: {
    getUser: defineMessage({
      type: "getUser",
      payloadSchema: z.object({ id: z.string() }),
      responseSchema: z.object({ name: z.string() }),
    }),
  },
});

await bridge.waitForReady();
const user = await bridge.sendWithResponse("getUser", { id: "1" });
```

## Entries

| Import | What |
| --- | --- |
| `nbridge` | Framework-agnostic core (zero validator/framework deps) |
| `nbridge/react` | React hooks via `createBridgeHooks` |
| `nbridge/next` | Next.js App Router back-navigation |
| `nbridge/devtools` | In-page debugging panel (+ `nbridge/devtools/styles.css`) |

## Highlights

- **Bring your own validator** — payload/response validation through the
  [Standard Schema](https://standardschema.dev) interface; zod, valibot, and
  ArkType work natively, and validation is entirely optional.
- **Honest readiness** — opt-in handshake protocol; `ready` means the host
  actually answered.
- **Middleware** in both directions, opt-in **batching** and **deflate
  compression**, an **offline queue** with priorities and reconnect replay,
  and live **metrics**.
- ESM-only, side-effect-free tree-shakeable core.

Full documentation: [mhmd-sdghn.github.io/nbridge](https://mhmd-sdghn.github.io/nbridge)

## License

MIT
