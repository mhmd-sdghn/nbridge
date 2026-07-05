/**
 * PARENT HOST — deliberately does NOT use nbridge.
 *
 * It implements the parent-frame side of the wire contract raw, so this file
 * doubles as documentation for embedding an nbridge-powered app in an iframe:
 *
 *   - nbridge's IframeAdapter posts plain message objects
 *     ({ type, payload?, id?, timestamp? }) to window.parent with the
 *     configured target origin.
 *   - The host must ack `__nbridge_handshake__` with
 *     `__nbridge_handshake_ack__` (posted back into the iframe).
 *   - Request/response: reply `{ type: `${type}_response`, id: <same id>,
 *     payload: <raw result> }`.
 *   - Fire-and-forget messages may arrive wrapped in a `__nbridge_batch__`
 *     envelope whose payload.messages array holds the individual messages.
 */
import "./styles.css";

const HANDSHAKE = "__nbridge_handshake__";
const HANDSHAKE_ACK = "__nbridge_handshake_ack__";
const BATCH = "__nbridge_batch__";

interface WireMessage {
  type: string;
  payload?: unknown;
  id?: string;
  timestamp?: number;
}

// ── DOM / logging ────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const iframe = $<HTMLIFrameElement>("child-frame");
const logEl = $("parent-log");

type LogKind = "recv" | "sent" | "info" | "err";

function log(kind: LogKind, text: string): void {
  const entry = document.createElement("div");
  entry.className = "log-entry";

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date().toLocaleTimeString(undefined, {
    hour12: false,
  });

  const dir = document.createElement("span");
  dir.className = `dir dir-${kind}`;
  dir.textContent =
    kind === "sent"
      ? "SENT →"
      : kind === "recv"
        ? "← RECV"
        : kind === "err"
          ? "ERROR"
          : "INFO";

  const body = document.createElement("span");
  body.className = "body";
  body.textContent = text;

  entry.append(time, dir, body);
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

$("clear-parent-log").addEventListener("click", () => {
  logEl.replaceChildren();
});

// ── Sending into the child ───────────────────────────────────────────────────

function postToChild(message: WireMessage): void {
  const target = iframe.contentWindow;
  if (!target) {
    log("err", "iframe.contentWindow is not available yet");
    return;
  }
  // Same-origin here; in production embedments use the child's exact origin.
  target.postMessage(message, window.location.origin);
  log("sent", `${message.type}${message.id ? ` (id: ${message.id})` : ""}`);
}

// ── Receiving from the child ─────────────────────────────────────────────────

function describe(message: WireMessage): string {
  const payload =
    message.payload === undefined ? "" : ` ${JSON.stringify(message.payload)}`;
  const id = message.id ? ` (id: ${message.id})` : "";
  return `${message.type}${payload}${id}`;
}

let handshakeLogged = false;

function handleChildMessage(message: WireMessage): void {
  log("recv", describe(message));

  switch (message.type) {
    case HANDSHAKE: {
      if (!handshakeLogged) {
        log("info", "Child initiated handshake — acknowledging");
        handshakeLogged = true;
      }
      postToChild({ type: HANDSHAKE_ACK });
      return;
    }

    case BATCH: {
      const entries = (message.payload as { messages?: WireMessage[] })
        ?.messages;
      if (Array.isArray(entries)) {
        log("info", `Unpacking batch of ${entries.length} message(s)`);
        for (const entry of entries) {
          handleChildMessage(entry);
        }
      }
      return;
    }

    case "parent:getTitle": {
      // Correlated response: same id, `${type}_response`, raw payload.
      postToChild({
        type: "parent:getTitle_response",
        id: message.id,
        payload: { title: document.title, url: window.location.href },
      });
      return;
    }

    case "child:event": {
      log("info", "child:event received (fire-and-forget, no reply)");
      return;
    }

    default: {
      log("info", `No handler for "${message.type}" — ignored`);
    }
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  // Security: only accept messages from OUR child iframe on OUR origin.
  if (event.origin !== window.location.origin) return;
  if (event.source !== iframe.contentWindow) return;

  const data = event.data as unknown;
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as WireMessage).type !== "string"
  ) {
    return; // not a bridge message (e.g. devtools noise)
  }

  handleChildMessage(data as WireMessage);
});

// ── Push a message INTO the child ────────────────────────────────────────────

let pingCount = 0;

$("btn-ping-child").addEventListener("click", () => {
  pingCount += 1;
  postToChild({
    type: "parent:ping",
    payload: { count: pingCount, sentAt: Date.now() },
  });
});

log("info", "Parent host listening for messages from the child iframe");
