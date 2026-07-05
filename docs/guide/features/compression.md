# Compression

Large payloads (image metadata, long lists, serialized state) can be deflate-compressed before crossing the bridge.

## Enable

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  compression: {
    enabled: true,
    algorithm: "deflate", // wire format — keep "deflate" (see note below)
    threshold: 1024,      // only compress payloads >= 1 KiB of JSON
  },
});
```

Defaults when omitted: disabled, `deflate`, 1024-byte threshold, stats tracking on (`trackStats: true`).

## Behavior

- Before hitting the adapter, the payload is `JSON.stringify`-ed; if it is at or above `threshold` bytes it is deflate-compressed (via [pako](https://github.com/nodeca/pako)), base64-encoded, and the message is flagged:

  ```json
  { "type": "syncState", "id": "…", "payload": "eJyrVspLzE1VslI…", "__compressed": true }
  ```

- Payloads below the threshold ship uncompressed — tiny payloads would grow, not shrink.
- **Incoming compressed messages are always decompressed**, even when your local `compression.enabled` is `false`. The decompressor is constructed unconditionally, so a host may compress toward the web at any time.

::: warning Config type vs. wire format
The `algorithm` field accepts `"gzip" | "deflate" | "br"`, but the current implementation always produces **deflate** on the wire. Leave it at the default `"deflate"`.
:::

::: warning Host contract
Web → native compression requires the host to handle it: when `__compressed` is `true`, base64-decode the payload, inflate it, then `JSON.parse`. If your host does not implement inflation, keep `compression.enabled: false` on the web side (native → web compression still works, since the web decompresses automatically). See [Wire Protocol](/reference/protocol#compression).
:::

## Stats

```ts
const stats = bridge.getCompressionStats();
// {
//   totalCompressed: 12,
//   bytesBeforeCompression: 480_000,
//   bytesAfterCompression: 96_500,
//   averageCompressionRatio: 0.20,   // after / before
// }
// null when compression is disabled

bridge.isCompressionEnabled(); // boolean
```

## Interplay with other features

- **Middleware runs before compression** on the way out — your middleware always sees the uncompressed payload.
- **Batch envelopes compress as a whole** when they clear the threshold, which is exactly where compression pays off most.
