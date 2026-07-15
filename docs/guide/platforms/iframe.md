# Iframe

When your app runs inside an iframe, nBridge exchanges `postMessage` calls with the **parent window**. The child side is nBridge; the parent side is a small host you implement on the embedding page.

**The contract:**

- **Child → parent:** nBridge posts the message object to `window.parent` with `targetOrigin` set to `iframeParentOrigin` — or `"*"` with a console warning when unset.
- **Parent → child:** the parent posts message objects to `iframe.contentWindow`. The child accepts messages **only from `window.parent`**, and only from `iframeParentOrigin` when configured.

Messages may be plain objects or JSON strings — the child parses both.

## Child side (your app, inside the iframe)

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  iframeParentOrigin: "https://host.example.com", // set this in production!
  handshake: { enabled: true },
});

await bridge.waitForReady(); // resolves once the parent acks the handshake

bridge.on("configUpdate", (payload) => applyConfig(payload));

const data = await bridge.sendWithResponse("dataRequest", { kind: "users" });
```

::: warning Always set `iframeParentOrigin` in production
Without it, outgoing messages are posted with `targetOrigin: "*"` (any embedding page can read them) and incoming messages are only source-checked, not origin-checked. nBridge logs a warning on every wildcard send to keep you honest.
:::

## Parent side (the host page)

The parent is not an nBridge instance — it is ~30 lines of `postMessage` plumbing you own. A complete host:

```ts
// On the embedding page
const CHILD_ORIGIN = "https://app.example.com";
const iframe = document.querySelector<HTMLIFrameElement>("#my-app")!;

function sendToChild(message: { type: string; payload?: unknown; id?: string }) {
  iframe.contentWindow?.postMessage(message, CHILD_ORIGIN);
}

window.addEventListener("message", (event) => {
  // 1. Only accept messages from our iframe, from the expected origin
  if (event.source !== iframe.contentWindow) return;
  if (event.origin !== CHILD_ORIGIN) return;

  const msg = event.data;
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    // 2. Answer the handshake so the child's waitForReady() resolves
    case "__nbridge_handshake__":
      sendToChild({ type: "__nbridge_handshake_ack__" });
      break;

    // 3. Unpack batch envelopes (only needed if the child enables batching)
    case "__nbridge_batch__":
      for (const entry of msg.payload?.messages ?? []) {
        handleMessage(entry);
      }
      break;

    default:
      handleMessage(msg);
  }
});

function handleMessage(msg: { type: string; payload?: any; id?: string }) {
  switch (msg.type) {
    // A request from the child — reply with "<type>_response" + same id
    case "dataRequest": {
      const data = { users: ["ada", "grace"] };
      if (msg.id) {
        sendToChild({ type: "dataRequest_response", id: msg.id, payload: data });
      }
      break;
    }

    // Fire-and-forget events from the child
    case "analytics":
      console.log("child event:", msg.payload);
      break;
  }
}

// Push events into the child at any time
iframe.addEventListener("load", () => {
  sendToChild({ type: "configUpdate", payload: { theme: "dark" } });
});
```

To reject a child request, reply with `<type>_error` and `{ error: string }` as the payload:

```ts
sendToChild({
  type: "dataRequest_error",
  id: msg.id,
  payload: { error: "Not authorized" },
});
```

::: tip Parent as a bridge too
If the parent page also uses nBridge for other transports, note that the *parent role* shown above is still hand-rolled — nBridge's iframe adapter implements the child side (posting to `window.parent`), not the parent side.
:::

## Detection details

- The iframe adapter is selected when `window.self !== window.top` **and** no Android/iOS native interface is present — native WebViews win over iframes.
- Cross-origin iframes (where reading `window.top` throws) are detected correctly.
- Same-page communication for local development is a different mode — see [Plain Web](/guide/platforms/web).

## Passing the host version

[Host Rules](/guide/features/host-rules) vary UI and behavior by host version. The embedding page appends `?hv=<version>` to the iframe `src` — the zero-config `versionFromQuery("hv")` source reads it:

```ts
iframe.src = `https://app.example.com/?hv=${encodeURIComponent(hostVersion)}`;
```

The version is persisted to `sessionStorage`, so it survives client-side navigation that drops the param. If you'd rather deliver it via `postMessage` after load, call `host.setVersion(version)` when it arrives instead — see [async acquisition](/guide/features/host-rules#async-acquisition-via-setversion).

::: warning The embedder controls the URL
An iframe embedder fully controls the `src` and can send any `?hv=` value it likes — including a fake one. Host Rules is **UX policy, not access control**: use it to gate what the UI shows, and enforce what a user is allowed to do on the server. Never treat a capability check as an authorization boundary. See the [security note](/guide/features/host-rules#security-posture-ux-policy-not-access-control).
:::

## Troubleshooting

- **Child never becomes ready** — the parent is not answering `__nbridge_handshake__`; add case 2 above.
- **Messages silently dropped in the child** — origin mismatch. `event.origin` must equal `iframeParentOrigin` exactly (scheme + host + port, no trailing slash).
- **Parent receives nothing** — the child posts only to its *direct* parent. Nested iframes need relaying at each level.
- **Sent before the iframe loaded** — the child queues nothing by default; the parent should wait for the iframe `load` event (or rely on the handshake) before expecting traffic.
