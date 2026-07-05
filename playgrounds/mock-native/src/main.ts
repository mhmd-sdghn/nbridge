/**
 * nbridge mock-native playground.
 *
 * LEFT column: a web app talking through nbridge.
 * RIGHT column: a fake Android host (installed BEFORE the bridge is created,
 * so platform auto-detection picks "android" and every message travels over
 * the real AndroidBridge.postMessage / window.sendBridgeMessage wire).
 */
import { createBridge } from "nbridge";
import { installFakeAndroidHost } from "./fakeHost";
import "./style.css";

// ── DOM helpers ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

type LogKind = "recv" | "sent" | "batch" | "info" | "err";

function makeLogger(container: HTMLElement) {
  return (kind: LogKind, text: string, inner = false): void => {
    const entry = document.createElement("div");
    entry.className = `log-entry${inner ? " inner" : ""}`;

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
          : kind === "batch"
            ? "BATCH"
            : kind === "err"
              ? "ERROR"
              : "INFO";

    const body = document.createElement("span");
    body.className = "body";
    body.textContent = text;

    entry.append(time, dir, body);
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  };
}

const webLog = makeLogger($("web-log"));
const nativeLog = makeLogger($("native-log"));

$("clear-web-log").addEventListener("click", () => {
  $("web-log").replaceChildren();
});
$("clear-native-log").addEventListener("click", () => {
  $("native-log").replaceChildren();
});

// ── Fake Android toast ───────────────────────────────────────────────────────

const toastRoot = $("toast-root");

function showToast(text: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  toastRoot.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 350);
  }, 2200);
}

// ── 1. Install the fake host BEFORE creating the bridge ─────────────────────
// nbridge probes window.AndroidBridge first, so this makes it pick the
// android adapter instead of falling back to web.

installFakeAndroidHost({ log: nativeLog, showToast });

// ── 2. Create the bridge (auto-detects "android") ────────────────────────────

const bridge = createBridge({
  debug: true,
  handshake: { enabled: true },
  batching: { enabled: true, maxSize: 5, maxWait: 300 },
  metrics: { enabled: true, updateInterval: 500, detailedTiming: false },
});

const platform = bridge.getPlatform();
$("platform-badge").textContent = `platform: ${platform.platform}`;
webLog(
  "info",
  `Detected platform "${platform.platform}" (isNative: ${platform.isNative})`,
);

const readyBadge = $("ready-badge");
bridge
  .waitForReady()
  .then(() => {
    readyBadge.textContent = "ready";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-ok");
    webLog("info", "Handshake acked by native host — bridge is ready");
  })
  .catch((error: unknown) => {
    readyBadge.textContent = "handshake failed";
    readyBadge.classList.remove("badge-wait");
    readyBadge.classList.add("badge-err");
    webLog("err", error instanceof Error ? error.message : String(error));
  });

// ── Live metrics ─────────────────────────────────────────────────────────────

bridge.onMetricsUpdate((metrics) => {
  $("m-sent").textContent = String(metrics.messagesSent);
  $("m-received").textContent = String(metrics.messagesReceived);
  $("m-bytes-sent").textContent = String(metrics.bytesSent);
  $("m-bytes-received").textContent = String(metrics.bytesReceived);
  $("m-avg").textContent = `${Math.round(metrics.averageResponseTime)} ms`;
  $("m-success").textContent = `${Math.round(metrics.successRate * 100)}%`;
});

// ── Actions ──────────────────────────────────────────────────────────────────

interface DeviceInfo {
  model: string;
  os: string;
  apiLevel: number;
  locale: string;
}

const deviceInfoBtn = $<HTMLButtonElement>("btn-device-info");
const deviceInfoResult = $("device-info-result");

deviceInfoBtn.addEventListener("click", async () => {
  deviceInfoBtn.disabled = true;
  deviceInfoResult.textContent = "waiting for native response…";
  webLog("sent", "device:getInfo (expecting response — bypasses batching)");

  try {
    const info = await bridge.sendWithResponse<undefined, DeviceInfo>(
      "device:getInfo",
      undefined,
      5000,
    );
    deviceInfoResult.textContent = JSON.stringify(info, null, 2);
    deviceInfoResult.classList.remove("dim");
    webLog("recv", `device:getInfo_response ${JSON.stringify(info)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deviceInfoResult.textContent = `Error: ${message}`;
    webLog("err", message);
  } finally {
    deviceInfoBtn.disabled = false;
  }
});

let toastCount = 0;

$("btn-toast").addEventListener("click", () => {
  toastCount += 1;
  const payload = { text: `Hello from the web side! (#${toastCount})` };
  bridge
    .send("toast:show", payload)
    .then(() => {
      webLog(
        "sent",
        `toast:show ${JSON.stringify(payload)} — fire-and-forget, so it rides the batcher (flushes within 300ms)`,
      );
    })
    .catch((error: unknown) => {
      webLog("err", error instanceof Error ? error.message : String(error));
    });
});

$("btn-batch").addEventListener("click", () => {
  webLog(
    "info",
    "Queuing 5 analytics events — batcher maxSize is 5, so they flush immediately as one __nbridge_batch__ envelope",
  );
  for (let i = 1; i <= 5; i++) {
    const payload = { name: "demo_event", index: i, at: Date.now() };
    bridge
      .send("analytics:event", payload)
      .then(() => {
        webLog("sent", `analytics:event ${JSON.stringify(payload)}`);
      })
      .catch((error: unknown) => {
        webLog("err", error instanceof Error ? error.message : String(error));
      });
  }
});
