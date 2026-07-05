# iOS WKWebView

On iOS, nBridge talks to a [`WKScriptMessageHandler`](https://developer.apple.com/documentation/webkit/wkscriptmessagehandler) registered on the WKWebView's user content controller.

**The contract:**

- **Web → native:** nBridge calls `window.webkit.messageHandlers.iosBridge.postMessage(object)`. Unlike Android, iOS receives the **raw object** — `WKScriptMessage.body` is a dictionary, not a JSON string. The handler name is configurable via `iosHandler` (default `"iosBridge"`).
- **Native → web:** your app evaluates `window.sendBridgeMessage(jsonString)` — nBridge attaches this global at initialization.

The full message shape, response convention, handshake, batching, and compression rules are specified in the [Wire Protocol](/reference/protocol).

## Web side

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  iosHandler: "iosBridge",      // must match contentController.add(_, name:)
  handshake: { enabled: true }, // recommended once the native side acks
});
```

Detection is automatic: when `window.webkit.messageHandlers.iosBridge` exists, the iOS adapter is used.

## Native side (Swift)

### 1. The message handler

```swift
import WebKit

final class NBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        // WKScriptMessage.body is the raw message object
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        let payload = body["payload"]
        let id = body["id"] as? String

        switch type {
        // Handshake: reply so the web side's waitForReady() resolves
        case "__nbridge_handshake__":
            sendToWeb(["type": "__nbridge_handshake_ack__"])

        // Batch envelope: unpack and process each entry
        case "__nbridge_batch__":
            if let dict = payload as? [String: Any],
               let messages = dict["messages"] as? [[String: Any]] {
                for entry in messages {
                    handle(type: entry["type"] as? String ?? "",
                           payload: entry["payload"],
                           id: entry["id"] as? String)
                }
            }

        default:
            handle(type: type, payload: payload, id: id)
        }
    }

    private func handle(type: String, payload: Any?, id: String?) {
        switch type {
        // A request from the web — answer with "<type>_response" + same id
        case "getUser":
            guard let requestId = id else { return }
            sendToWeb([
                "type": "getUser_response",
                "id": requestId,
                "payload": ["name": "Ada Lovelace", "email": "ada@example.com"],
            ])

        // Fire-and-forget events
        case "shutdown":
            // dismiss the hosting view controller
            break

        default:
            print("NBridge: unhandled type \(type)")
        }
    }

    private func sendToWeb(_ message: [String: Any]) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8),
              // JS-escape by JSON-encoding the string itself
              let arg = try? JSONSerialization.data(withJSONObject: [json]),
              let argStr = String(data: arg, encoding: .utf8) else { return }

        // argStr is ["...escaped json..."] — index into it to pass one argument
        let script = "window.sendBridgeMessage(\(argStr)[0])"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    // Push an event to the web at any time
    func emit(type: String, payload: Any) {
        sendToWeb(["type": type, "payload": payload])
    }
}
```

### 2. Register it

```swift
import UIKit
import WebKit

final class ViewController: UIViewController {
    var webView: WKWebView!
    let bridge = NBridge()

    override func viewDidLoad() {
        super.viewDidLoad()

        let contentController = WKUserContentController()
        contentController.add(bridge, name: "iosBridge") // name must match config

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        bridge.webView = webView
        view.addSubview(webView)

        webView.load(URLRequest(url: URL(string: "https://your-app.example.com")!))
    }
}
```

### 3. Reporting a failure

To reject a web request instead of answering it, reply with `<type>_error` and an `{ error }` payload:

```swift
sendToWeb([
    "type": "getUser_error",
    "id": requestId,
    "payload": ["error": "User not found"],
])
```

::: warning Retain cycles
`contentController.add(_:name:)` retains its handler, and the handler typically references the web view — keep the `webView` reference `weak` (as above), and call `removeScriptMessageHandler(forName:)` in teardown for long-lived controllers.
:::

## Troubleshooting

- **Web sends, native never receives** — the handler name in `contentController.add` must exactly match `iosHandler`; also confirm the handler object is still alive (not deallocated).
- **Native sends, web never receives** — check JSON serialization succeeds and the script string is properly escaped; inspect with Safari's Web Inspector (Develop menu → your device).
- **`waitForReady()` times out** — the native side is not answering `__nbridge_handshake__`. Add the handshake case above, or disable `handshake.enabled` on the web side.
- **Type confusion** — remember `message.body` is already a dictionary. Do not `JSONSerialization.jsonObject` it again.
