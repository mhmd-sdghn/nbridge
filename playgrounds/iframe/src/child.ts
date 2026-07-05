/**
 * CHILD APP — runs inside the parent's <iframe> and uses nbridge.
 *
 * window.parent !== window here, so platform auto-detection picks "iframe".
 * `iframeParentOrigin` restricts both which origins we accept messages from
 * and the targetOrigin used when posting to the parent.
 */
import { createBridge } from "nbridge";
import "./styles.css";

const bridge = createBridge({
  debug: true,
  handshake: { enabled: true },
  iframeParentOrigin: window.location.origin,
});

// ── DOM / logging ────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const logEl = $("child-log");

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

$("clear-child-log").addEventListener("click", () => {
  logEl.replaceChildren();
});

// ── Status badges ────────────────────────────────────────────────────────────

const platform = bridge.getPlatform();
$("platform-badge").textContent = `platform: ${platform.platform}`;
log("info", `Detected platform "${platform.platform}"`);

const readyBadge = $("ready-badge");
bridge
  .waitForReady()
  .then(() => {
    readyBadge.textContent = "ready";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-ok");
    log("info", "Parent acked the handshake — bridge is ready");
  })
  .catch((error: unknown) => {
    readyBadge.textContent = "handshake failed";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-err");
    log("err", error instanceof Error ? error.message : String(error));
  });

// ── Incoming pushes from the parent ──────────────────────────────────────────

bridge.on<{ count: number; sentAt: number }>("parent:ping", (payload) => {
  log("recv", `parent:ping ${JSON.stringify(payload)}`);
});

// ── Actions ──────────────────────────────────────────────────────────────────

let eventCount = 0;

$("btn-send").addEventListener("click", () => {
  eventCount += 1;
  const payload = { name: "button_click", count: eventCount };
  bridge
    .send("child:event", payload)
    .then(() => {
      log("sent", `child:event ${JSON.stringify(payload)}`);
    })
    .catch((error: unknown) => {
      log("err", error instanceof Error ? error.message : String(error));
    });
});

const titleBtn = $<HTMLButtonElement>("btn-title");
const titleResult = $("title-result");

titleBtn.addEventListener("click", async () => {
  titleBtn.disabled = true;
  titleResult.textContent = "waiting for parent…";
  log("sent", "parent:getTitle (expecting response)");

  try {
    const result = await bridge.sendWithResponse<
      undefined,
      { title: string; url: string }
    >("parent:getTitle", undefined, 3000);
    titleResult.textContent = JSON.stringify(result, null, 2);
    titleResult.classList.remove("dim");
    log("recv", `parent:getTitle_response ${JSON.stringify(result)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    titleResult.textContent = `Error: ${message}`;
    log("err", message);
  } finally {
    titleBtn.disabled = false;
  }
});
