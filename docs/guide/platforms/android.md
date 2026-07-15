# Android WebView

On Android, nBridge talks to a [`JavascriptInterface`](https://developer.android.com/reference/android/webkit/JavascriptInterface) object injected into the WebView.

**The contract:**

- **Web → native:** nBridge calls `window.AndroidBridge.postMessage(jsonString)` — one JSON string per message. The interface name is configurable via `androidInterface` (default `"AndroidBridge"`).
- **Native → web:** your app evaluates `window.sendBridgeMessage(jsonString)` — nBridge attaches this global at initialization.

The full message shape, response convention, handshake, batching, and compression rules are specified in the [Wire Protocol](/reference/protocol).

## Web side

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  androidInterface: "AndroidBridge", // must match addJavascriptInterface(...)
  handshake: { enabled: true },      // recommended once the native side acks
});
```

Detection is automatic: when `window.AndroidBridge` exists, the Android adapter is used.

## Native side (Kotlin)

### 1. The bridge object

```kotlin
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

class NBridge(private val webView: WebView) {

    @JavascriptInterface
    fun postMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.getString("type")
            val payload = json.optJSONObject("payload")
            val id = json.optString("id")

            when (type) {
                // Handshake: reply so the web side's waitForReady() resolves
                "__nbridge_handshake__" -> {
                    sendToWeb(JSONObject().put("type", "__nbridge_handshake_ack__"))
                }

                // Batch envelope: unpack and process each entry
                "__nbridge_batch__" -> {
                    val messages = payload?.optJSONArray("messages") ?: return
                    for (i in 0 until messages.length()) {
                        postMessage(messages.getJSONObject(i).toString())
                    }
                }

                // A request from the web — answer with "<type>_response" + same id
                "getUser" -> {
                    val userId = payload?.optString("id")
                    val user = JSONObject()
                        .put("name", "Ada Lovelace")
                        .put("email", "ada@example.com")
                    if (id.isNotEmpty()) {
                        sendToWeb(
                            JSONObject()
                                .put("type", "getUser_response")
                                .put("id", id)
                                .put("payload", user)
                        )
                    }
                }

                // Fire-and-forget events
                "shutdown" -> { /* finish() the hosting Activity */ }

                else -> android.util.Log.w("NBridge", "Unhandled type: $type")
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sendToWeb(message: JSONObject) {
        // JSON-escape the payload as a JS string literal
        val js = "window.sendBridgeMessage(${JSONObject.quote(message.toString())})"
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }

    // Push an event to the web at any time
    fun emit(type: String, payload: Any?) {
        sendToWeb(JSONObject().put("type", type).put("payload", payload))
    }
}
```

### 2. Register it

```kotlin
val webView = findViewById<WebView>(R.id.webview)
webView.settings.javaScriptEnabled = true
webView.addJavascriptInterface(NBridge(webView), "AndroidBridge") // name must match config

webView.loadUrl("https://your-app.example.com")
```

### 3. Reporting a failure

To reject a web request instead of answering it, reply with `<type>_error` and an `{ error }` payload:

```kotlin
sendToWeb(
    JSONObject()
        .put("type", "getUser_error")
        .put("id", id)
        .put("payload", JSONObject().put("error", "User not found"))
)
```

::: tip Escaping
Always build the `evaluateJavascript` call with proper escaping (`JSONObject.quote` above). Interpolating raw JSON into single quotes breaks on payloads containing quotes or newlines.
:::

## Passing the host version

[Host Rules](/guide/features/host-rules) vary UI and behavior by app version. The simplest way to tell the web side which version it is running in is to append `?hv=<version>` to the URL you load — the zero-config `versionFromQuery("hv")` source reads it:

```kotlin
val appVersion = packageManager.getPackageInfo(packageName, 0).versionName
webView.loadUrl("https://your-app.example.com/?hv=$appVersion")
```

The version is persisted to `sessionStorage`, so it survives client-side navigation that drops the param. If you'd rather deliver it over the bridge (e.g. via `emit("hostInfo", …)`), call `host.setVersion(version)` when it arrives instead — see [async acquisition](/guide/features/host-rules#async-acquisition-via-setversion).

## Troubleshooting

- **Web sends, native never receives** — check `javaScriptEnabled = true` and that the `addJavascriptInterface` name exactly matches `androidInterface`. Enable `WebView.setWebContentsDebuggingEnabled(true)` and inspect via `chrome://inspect`.
- **Native sends, web never receives** — use `evaluateJavascript` (not `loadUrl("javascript:…")`), wrap in `webView.post { }` for thread safety, and verify the JSON string escaping.
- **`waitForReady()` times out** — the native side is not answering `__nbridge_handshake__`. Add the handshake case above, or disable `handshake.enabled` on the web side.
- **Batches arrive as one weird message** — implement the `__nbridge_batch__` unpack case, or disable [batching](/guide/features/batching).
