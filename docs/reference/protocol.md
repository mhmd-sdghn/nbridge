# Wire Protocol

This page is the contract between nBridge on the web side and whatever hosts it — an Android `JavascriptInterface`, an iOS `WKScriptMessageHandler`, or a parent page. Implement this and any web app using nBridge can talk to you.

The protocol constants are exported:

```ts
import { PROTOCOL } from "nbridge";

PROTOCOL.HANDSHAKE;     // "__nbridge_handshake__"
PROTOCOL.HANDSHAKE_ACK; // "__nbridge_handshake_ack__"
PROTOCOL.BATCH;         // "__nbridge_batch__"
```

## Transport summary

| Platform | Web → host | Host → web |
| --- | --- | --- |
| Android | `window.<androidInterface>.postMessage(jsonString)` — JSON **string** (default interface `"AndroidBridge"`) | evaluate `window.sendBridgeMessage(jsonString)` |
| iOS | `webkit.messageHandlers.<iosHandler>.postMessage(object)` — raw **object** (`WKScriptMessage.body`; default handler `"iosBridge"`) | evaluate `window.sendBridgeMessage(jsonString)` |
| Iframe (child) | `window.parent.postMessage(object, iframeParentOrigin ?? "*")` | `iframe.contentWindow.postMessage(object, childOrigin)` — the child accepts messages **only from `window.parent`**, origin-checked when `iframeParentOrigin` is set. Objects or JSON strings both accepted. |

`window.sendBridgeMessage` is attached by nBridge at initialization on Android and iOS; it accepts a JSON string (or an already-parsed object) and feeds the incoming pipeline.

## Message shape

Every message, in both directions:

```json
{
  "type": "getUser",
  "payload": { "id": "42" },
  "id": "1751712345678-x3k9q2f",
  "timestamp": 1751712345678,
  "__compressed": false
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | ✅ | Message kind. The only required field — anything without a string `type` is discarded. |
| `payload` | — | Arbitrary JSON data. |
| `id` | — | Unique id, set by the sender. **Echo it back when replying to a request.** |
| `timestamp` | — | Epoch ms at creation. |
| `__compressed` | — | When `true`, `payload` is a compressed string (see [Compression](#compression)). Never set by hand. |

## Request / response

To answer a message with id `X` and type `T`, send back:

```json
{ "type": "T_response", "id": "X", "payload": { "...": "raw response data" } }
```

To report failure instead:

```json
{ "type": "T_error", "id": "X", "payload": { "error": "human-readable reason" } }
```

Rules:

- The suffixes are literal: `getUser` → `getUser_response` / `getUser_error`.
- `id` must be **exactly** the id of the request; that is the whole correlation mechanism.
- `payload` of a `_response` is delivered to the web caller as the resolved data (after `responseSchema` validation, if registered).
- Both variants settle the pending web-side promise; an `_error` reply currently arrives as data shaped `{ "error": string }` rather than a rejection.
- Messages ending in `_response` / `_error` whose id matches no pending request are dispatched as ordinary events.
- Requests time out on the web side (default 5000 ms) — a host that answers late is answering nobody.

The direction is symmetric: when the *host* sends a message with an `id` and the web app answers via `onWithResponse`, the web side produces exactly the same `T_response` / `T_error` shapes.

## Handshake

Optional but strongly recommended — enabled on the web via `handshake: { enabled: true }`.

1. Web sends `{ "type": "__nbridge_handshake__", "id": "...", "timestamp": ... }`, retrying every `retryInterval` ms (default 500) for up to `timeout` ms (default 10000).
2. Host replies `{ "type": "__nbridge_handshake_ack__" }`.
3. Web marks itself ready; `waitForReady()` resolves.

The host may also **initiate**: on receiving `__nbridge_handshake__`, the web side automatically replies with `__nbridge_handshake_ack__` and marks itself ready. Handshake messages are handled before middleware and are never dispatched to user handlers, queued, batched, or compressed.

Minimal host logic:

```text
if (message.type == "__nbridge_handshake__")
    send { "type": "__nbridge_handshake_ack__" }
```

## Batching

When batching is enabled on the sender, fire-and-forget messages arrive as one envelope:

```json
{
  "type": "__nbridge_batch__",
  "id": "…",
  "timestamp": 1751712345678,
  "payload": {
    "messages": [
      { "type": "analytics", "payload": { "event": "scroll" } },
      { "type": "analytics", "payload": { "event": "click" } }
    ]
  }
}
```

**Hosts must unpack `payload.messages` and process each entry as an individual message.** Entries without a string `type` are skipped. The web side unpacks incoming batch envelopes automatically, so hosts may batch toward the web as well.

## Compression

When a message carries `"__compressed": true`, its `payload` is:

```
base64( deflate( JSON.stringify(originalPayload) ) )
```

To read it: base64-decode → inflate (zlib/deflate) → `JSON.parse`.

- The web side decompresses incoming compressed payloads **automatically and unconditionally** — hosts may compress toward the web without any web-side configuration.
- The web side only compresses outgoing payloads when `compression.enabled` is set and the JSON payload is at or above `threshold` bytes (default 1024). If your host cannot inflate, leave web-side compression off.
- The wire format is always deflate in the current implementation.

## Validity rules

- A message is valid iff it is an object with a string `type`. Everything else is dropped (with a warning when debug logging is on).
- Unknown `type`s are not errors — they are simply dispatched to zero handlers. Hosts should likewise ignore unknown types instead of failing.
- Ids are opaque strings (currently `"<epoch ms>-<random base36>"`); never parse or reuse them.

## Reserved names

Treat these as reserved by the protocol:

- `__nbridge_handshake__`, `__nbridge_handshake_ack__`, `__nbridge_batch__`
- the suffixes `_response` and `_error` (response correlation)
- the payload keys `__metadata` (stamped by `metadataMiddleware`) and `encrypted` (used by `encryptionMiddleware`)
- the message flag `__compressed`
