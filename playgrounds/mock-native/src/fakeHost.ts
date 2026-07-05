/**
 * Fake Android WebView host.
 *
 * This module is executable documentation of the native side of the nbridge
 * wire contract:
 *
 *   web → native   window.AndroidBridge.postMessage(jsonString)
 *   native → web   window.sendBridgeMessage(jsonString)   (attached by nbridge)
 *
 * Wire messages are `{ type, payload?, id?, timestamp? }`. The host must:
 *   1. Reply to `__nbridge_handshake__` with `__nbridge_handshake_ack__`.
 *   2. Unpack `__nbridge_batch__` envelopes (`payload.messages` is an array of
 *      inner messages) and process each entry individually.
 *   3. Answer request/response messages with `{ type: `${type}_response`,
 *      id: <same id>, payload: <raw result> }`.
 */

const HANDSHAKE = "__nbridge_handshake__";
const HANDSHAKE_ACK = "__nbridge_handshake_ack__";
const BATCH = "__nbridge_batch__";

interface WireMessage {
  type: string;
  payload?: unknown;
  id?: string;
  timestamp?: number;
}

export type HostLogKind = "recv" | "sent" | "batch" | "info" | "err";

export interface FakeHostOptions {
  /** Receives one line per host event, for the "native log" panel. */
  log: (kind: HostLogKind, text: string, inner?: boolean) => void;
  /** Renders the fake Android toast overlay. */
  showToast: (text: string) => void;
}

declare global {
  interface Window {
    AndroidBridge?: { postMessage: (raw: string) => void };
    /** Attached by nbridge's AndroidAdapter once the bridge initializes. */
    sendBridgeMessage?: (json: string) => void;
  }
}

/**
 * Install `window.AndroidBridge` so nbridge auto-detects the "android"
 * platform. MUST run before `createBridge()`.
 */
export function installFakeAndroidHost(options: FakeHostOptions): void {
  const { log, showToast } = options;
  let handshakeAcked = false;

  /** Simulated IPC latency: the native side never answers synchronously. */
  function replyLater(message: WireMessage): void {
    const delay = 80 + Math.floor(Math.random() * 270);
    setTimeout(() => {
      const json = JSON.stringify(message);
      if (typeof window.sendBridgeMessage !== "function") {
        log(
          "err",
          "window.sendBridgeMessage is not attached — is the bridge created?",
        );
        return;
      }
      log(
        "sent",
        `${message.type} ${JSON.stringify(message.payload ?? null)} (after ${delay}ms)`,
      );
      window.sendBridgeMessage(json);
    }, delay);
  }

  function describe(message: WireMessage): string {
    const payload =
      message.payload === undefined
        ? ""
        : ` ${JSON.stringify(message.payload)}`;
    const id = message.id ? ` (id: ${message.id})` : "";
    return `${message.type}${payload}${id}`;
  }

  function handleMessage(message: WireMessage, inner = false): void {
    log("recv", describe(message), inner);

    switch (message.type) {
      case HANDSHAKE: {
        if (!handshakeAcked) {
          log("info", "Handshake received — acknowledging", inner);
          handshakeAcked = true;
        }
        // The web side retries the handshake until acked; answer every time.
        replyLater({ type: HANDSHAKE_ACK });
        return;
      }

      case BATCH: {
        const entries = (message.payload as { messages?: WireMessage[] })
          ?.messages;
        if (!Array.isArray(entries)) {
          log("err", "Batch envelope without payload.messages", inner);
          return;
        }
        log("batch", `Unpacking batch of ${entries.length} message(s)`, inner);
        for (const entry of entries) {
          handleMessage(entry, true);
        }
        return;
      }

      case "device:getInfo": {
        replyLater({
          type: "device:getInfo_response",
          id: message.id,
          payload: {
            model: "Pixel Mock",
            os: "Android 15",
            apiLevel: 35,
            locale: "en-US",
          },
        });
        return;
      }

      case "toast:show": {
        const text =
          (message.payload as { text?: string } | undefined)?.text ??
          "(empty toast)";
        log("info", `Showing toast: "${text}"`, inner);
        showToast(text);
        return;
      }

      case "analytics:event": {
        log(
          "info",
          "Analytics event recorded (fire-and-forget, no reply)",
          inner,
        );
        return;
      }

      default: {
        log("info", `No handler for "${message.type}" — ignored`, inner);
      }
    }
  }

  window.AndroidBridge = {
    postMessage(raw: string): void {
      let message: WireMessage;
      try {
        message = JSON.parse(raw) as WireMessage;
      } catch {
        log("err", `Received unparseable message: ${raw}`);
        return;
      }
      handleMessage(message);
    },
  };

  log("info", "Fake AndroidBridge installed on window");
}
