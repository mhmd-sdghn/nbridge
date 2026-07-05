/**
 * nbridge vanilla playground.
 *
 * Runs on the web-fallback adapter with `webLoopback: true`: every message
 * sent is posted back to the same window, so the handshake self-completes
 * (the bridge receives its own HANDSHAKE, acks it, and marks itself ready)
 * and locally registered handlers receive everything we send.
 */
import { createBridge } from "nbridge";
import "./style.css";

// ── Bridge ───────────────────────────────────────────────────────────────────

const bridge = createBridge({
  debug: true,
  webLoopback: true,
  handshake: { enabled: true },
});

// ── DOM handles ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const platformBadge = $("platform-badge");
const readyBadge = $("ready-badge");
const sendForm = $<HTMLFormElement>("send-form");
const msgType = $<HTMLInputElement>("msg-type");
const msgPayload = $<HTMLTextAreaElement>("msg-payload");
const sendError = $("send-error");
const squareN = $<HTMLInputElement>("square-n");
const squareBtn = $<HTMLButtonElement>("square-btn");
const squareResult = $("square-result");
const logEl = $("log");
const clearLogBtn = $("clear-log");

// ── Log panel ────────────────────────────────────────────────────────────────

type Direction = "sent" | "recv" | "info" | "err";

function addLog(direction: Direction, body: string): void {
  const entry = document.createElement("div");
  entry.className = "log-entry";

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date().toLocaleTimeString(undefined, {
    hour12: false,
  });

  const dir = document.createElement("span");
  dir.className = `dir dir-${direction}`;
  dir.textContent =
    direction === "sent"
      ? "SENT →"
      : direction === "recv"
        ? "← RECV"
        : direction === "err"
          ? "ERROR"
          : "INFO";

  const text = document.createElement("span");
  text.className = "body";
  text.textContent = body;

  entry.append(time, dir, text);
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

clearLogBtn.addEventListener("click", () => {
  logEl.replaceChildren();
});

// ── Status badges ────────────────────────────────────────────────────────────

const platform = bridge.getPlatform();
platformBadge.textContent = `platform: ${platform.platform}`;
addLog(
  "info",
  `Detected platform "${platform.platform}" (isNative: ${platform.isNative})`,
);

bridge
  .waitForReady()
  .then(() => {
    readyBadge.textContent = "ready";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-ok");
    addLog("info", "Handshake complete — bridge is ready");
  })
  .catch((error: unknown) => {
    readyBadge.textContent = "handshake failed";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-err");
    addLog("err", error instanceof Error ? error.message : String(error));
  });

// ── Echo listeners ───────────────────────────────────────────────────────────
// Loopback means anything we send comes back as an incoming message. Register
// one bridge.on() listener per message type so the echo shows up in the log.

const subscribedTypes = new Set<string>();

function ensureEchoListener(type: string): void {
  if (subscribedTypes.has(type)) return;
  subscribedTypes.add(type);
  bridge.on(type, (payload, message) => {
    addLog(
      "recv",
      `${message.type} ${JSON.stringify(payload)} (id: ${message.id})`,
    );
  });
}

// ── Send form ────────────────────────────────────────────────────────────────

sendForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendError.hidden = true;

  const type = msgType.value.trim();
  if (!type) {
    sendError.textContent = "Message type is required.";
    sendError.hidden = false;
    return;
  }

  let payload: unknown;
  const rawPayload = msgPayload.value.trim();
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      sendError.textContent = "Payload is not valid JSON.";
      sendError.hidden = false;
      return;
    }
  }

  ensureEchoListener(type);

  bridge
    .send(type, payload)
    .then((response) => {
      addLog(
        "sent",
        `${type} ${rawPayload || "(no payload)"} (id: ${response.id})`,
      );
    })
    .catch((error: unknown) => {
      addLog("err", error instanceof Error ? error.message : String(error));
    });
});

// ── Request/response demo ────────────────────────────────────────────────────
// onWithResponse registers a responder on THIS bridge; sendWithResponse loops
// the request out and back, the responder replies "math:square_response" with
// the same id, and the promise resolves with the raw response payload.

bridge.onWithResponse<{ n: number }, { n: number; square: number }>(
  "math:square",
  (payload) => {
    addLog("info", `Responder math:square handling n=${payload.n}`);
    return { n: payload.n, square: payload.n * payload.n };
  },
);

squareBtn.addEventListener("click", async () => {
  const n = Number(squareN.value);
  squareBtn.disabled = true;
  squareResult.textContent = "waiting for response…";
  addLog("sent", `math:square ${JSON.stringify({ n })} (expecting response)`);

  try {
    const result = await bridge.sendWithResponse<
      { n: number },
      { n: number; square: number }
    >("math:square", { n }, 3000);
    squareResult.textContent = JSON.stringify(result, null, 2);
    squareResult.classList.remove("dim");
    addLog("recv", `math:square_response ${JSON.stringify(result)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    squareResult.textContent = `Error: ${message}`;
    addLog("err", message);
  } finally {
    squareBtn.disabled = false;
  }
});
