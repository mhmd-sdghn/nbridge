/**
 * nbridge vanilla playground.
 *
 * Runs on the web-fallback adapter with `webLoopback: true`: every message
 * sent is posted back to the same window, so the handshake self-completes
 * (the bridge receives its own HANDSHAKE, acks it, and marks itself ready)
 * and locally registered handlers receive everything we send.
 */
import {
  type BridgePlatform,
  createBridge,
  defineHostRules,
  traitFromQuery,
  versionFromQuery,
} from "nbridge";
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

// ── Host Rules demo ──────────────────────────────────────────────────────────
// defineHostRules() compiles a per-app config into capability/variant resolvers
// keyed on (platform, version) plus arbitrary traits. It is independent of the
// bridge above. The version comes from `?hv=<n>` and a `mk` trait from
// `?mk=<channel>`; this playground runs on the web platform, so rules key on
// `web` version and the trait to make the query params visibly change state:
//
//   (no ?hv)     betaBanner: off   saveFlow: A
//   ?hv=2        betaBanner: on    saveFlow: A
//   ?hv=3        betaBanner: on    saveFlow: C
//   ?mk=google   promoBanner: on
//   ?mk=bing     saveFlow: B

// Demo-owned storage keys so "Reset" can fully clear the persisted values
// (versionFromQuery/traitFromQuery cache the last param in sessionStorage;
// without clearing, Reset would re-read the stale value and appear to do nothing).
const HOST_VERSION_STORAGE_KEY = "nbridge:playground-hv";
const HOST_MK_STORAGE_KEY = "nbridge:playground-mk";

const host = defineHostRules({
  version: versionFromQuery("hv", { storageKey: HOST_VERSION_STORAGE_KEY }),
  traits: {
    mk: {
      source: traitFromQuery("mk", { storageKey: HOST_MK_STORAGE_KEY }),
      values: ["google", "bing"] as const,
    },
  },
  capabilities: {
    nativeShare: { android: ">=8.2", ios: true },
    betaBanner: { web: ">=2", iframe: ">=2" },
    promoBanner: { web: true, when: { traits: { mk: "google" } } },
  },
  variants: {
    saveFlow: {
      rules: [
        { when: { platform: "web", version: ">=3" }, use: "C" },
        { when: { traits: { mk: "bing" } }, use: "B" },
        { when: { platform: "ios" }, use: "B" },
        { when: { platform: "android", version: ">=9" }, use: "B" },
      ],
      default: "A",
    },
  },
});

const hostInfoBadge = $("host-info");
const capNativeShare = $("cap-nativeShare");
const capBetaBanner = $("cap-betaBanner");
const capPromoBanner = $("cap-promoBanner");
const varSaveFlow = $("var-saveFlow");
const traitMk = $("trait-mk");
const shareBtn = $<HTMLButtonElement>("share-btn");
const saveFlowEl = $("save-flow");
const platformSelect = $<HTMLSelectElement>("host-platform");
const versionInput = $<HTMLInputElement>("host-version");
const mkInput = $<HTMLInputElement>("host-mk");

const SAVE_FLOW_ROUTES: Record<string, string> = {
  A: "/save (default flow A)",
  B: "/save/native (flow B)",
  C: "/save/v3 (flow C)",
};

function setCapBadge(el: HTMLElement, label: string, on: boolean): void {
  el.textContent = `${label}: ${on}`;
  el.classList.toggle("badge-ok", on);
  el.classList.toggle("badge-err", !on);
}

// Re-render the whole panel from the resolved host state. Registered with
// host.subscribe below, so setVersion()/__setOverride() refresh it live.
function renderHost(): void {
  const info = host.info();
  hostInfoBadge.textContent = `${info.platform} @ ${info.version ?? "none"}`;

  const nativeShare = host.supports("nativeShare");
  setCapBadge(capNativeShare, "nativeShare", nativeShare);
  setCapBadge(capBetaBanner, "betaBanner", host.supports("betaBanner"));
  setCapBadge(capPromoBanner, "promoBanner", host.supports("promoBanner"));

  traitMk.textContent = `mk: ${info.traits.mk ?? "none"}`;

  const saveFlow = host.variant("saveFlow");
  varSaveFlow.textContent = `saveFlow: ${saveFlow}`;

  // Gate the button on the capability (a copy-link fallback when off).
  shareBtn.disabled = !nativeShare;
  shareBtn.textContent = nativeShare
    ? "Native share"
    : "Copy link (nativeShare off)";

  saveFlowEl.textContent = `Save button routes to: ${SAVE_FLOW_ROUTES[saveFlow] ?? "unknown"}`;
}

host.subscribe(renderHost);
renderHost();

// Dev controls — setVersion() is a production API; __setOverride() is the
// dev-only escape hatch the DevTools "Host" tab uses in the React playground.
$<HTMLButtonElement>("host-apply").addEventListener("click", () => {
  const platform = platformSelect.value as BridgePlatform | "";
  const version = versionInput.value.trim();
  const mk = mkInput.value.trim();
  if (platform) {
    // Omit blank fields so they fall back to their source (?hv / ?mk), matching
    // the React DevTools Host panel's override semantics.
    host.__setOverride({
      platform,
      ...(version ? { version } : {}),
      ...(mk ? { traits: { mk } } : {}),
    });
  } else {
    host.__setOverride(null);
    host.setVersion(version || null);
    host.setTrait("mk", mk || null);
  }
});

$<HTMLButtonElement>("host-reset").addEventListener("click", () => {
  platformSelect.value = "";
  versionInput.value = "";
  mkInput.value = "";
  host.__setOverride(null);
  host.setVersion(null);
  host.setTrait("mk", null);
  // Clear the persisted `?hv` / `?mk` so Reset truly returns to the default.
  try {
    window.sessionStorage.removeItem(HOST_VERSION_STORAGE_KEY);
    window.sessionStorage.removeItem(HOST_MK_STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable (private mode / sandboxed iframe).
  }
  host.refresh();
});
