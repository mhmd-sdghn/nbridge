import { isTestEnv } from "../../utils/env";

const SESSION_STORAGE_KEY = "__nbridge_next_history_v1__";
const MAX_HISTORY_ENTRIES = 50;

let sessionAvailability: boolean | null = null;
let trackingInitialized = false;
let originalPushState: History["pushState"] | null = null;
let originalReplaceState: History["replaceState"] | null = null;
let popstateListener: ((event: PopStateEvent) => void) | null = null;

function supportsSessionStorage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (sessionAvailability !== null) {
    return sessionAvailability;
  }

  try {
    const { sessionStorage } = window;
    const testKey = `${SESSION_STORAGE_KEY}__test`;
    sessionStorage.setItem(testKey, "1");
    sessionStorage.removeItem(testKey);
    sessionAvailability = true;
  } catch (error) {
    if (!isTestEnv()) {
      console.warn(
        "[bridge:sessionHistory] sessionStorage unavailable:",
        error,
      );
    }
    sessionAvailability = false;
  }

  return sessionAvailability;
}

function readHistory(): string[] {
  if (!supportsSessionStorage()) {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string")
    ) {
      return parsed as string[];
    }
  } catch (error) {
    console.warn("[bridge:sessionHistory] Failed to parse history:", error);
  }

  return [];
}

function writeHistory(entries: string[]): void {
  if (!supportsSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_HISTORY_ENTRIES)),
    );
  } catch (error) {
    console.warn("[bridge:sessionHistory] Failed to write history:", error);
  }
}

function normalizeUrl(url: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return new URL(url, window.location.origin).href;
  } catch (error) {
    console.warn(
      "[bridge:sessionHistory] Failed to normalize url:",
      url,
      error,
    );
    return null;
  }
}

/**
 * Record the current URL into the session mirror.
 *
 * @param source - Which navigation caused this sync. On "popstate" a URL that
 *   already exists earlier in the list means the user went back, so we truncate
 *   to that entry. On "push" (pushState) the same URL appearing earlier means a
 *   forward re-visit of a previously seen page (e.g. list → detail → list), so
 *   we must APPEND rather than truncate — truncating there would make the
 *   session look shorter than real history and trigger a premature shutdown.
 */
export function syncCurrentUrlIntoSession(
  source: "push" | "popstate" | "init" = "init",
): void {
  if (!supportsSessionStorage() || typeof window === "undefined") {
    return;
  }

  const normalizedCurrent = normalizeUrl(window.location.href);
  if (!normalizedCurrent) {
    return;
  }

  const history = readHistory();
  const existingIndex = history.lastIndexOf(normalizedCurrent);

  if (existingIndex >= 0 && existingIndex === history.length - 1) {
    return;
  }

  // Only interpret a re-visit as "went back" (truncate) for popstate/init.
  // A pushState to a previously-seen URL is a forward navigation: append.
  if (existingIndex >= 0 && source !== "push") {
    writeHistory(history.slice(0, existingIndex + 1));
    return;
  }

  history.push(normalizedCurrent);
  writeHistory(history);
}

/**
 * True when the current document was loaded by a fresh navigation (not a
 * back/forward traversal or reload). Used to fence the session mirror across
 * hard document-load boundaries (e.g. a payment/OAuth hard-nav out and back),
 * which the mirror cannot reconcile with real browser history.
 */
function isFreshDocumentLoad(): boolean {
  try {
    const entries = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    const nav = entries[0];
    return nav?.type === "navigate";
  } catch {
    return false;
  }
}

export function prepareSessionForRouterBack(): void {
  if (!supportsSessionStorage()) {
    return;
  }

  const history = readHistory();
  if (history.length <= 1) {
    return;
  }

  history.pop();
  writeHistory(history);
}

export function canNavigateBackWithinSession(): boolean {
  if (!supportsSessionStorage() || typeof window === "undefined") {
    return false;
  }

  const history = readHistory();
  if (history.length <= 1) {
    return false;
  }

  const previousUrl = history[history.length - 2];
  if (!previousUrl) {
    return false;
  }
  const normalizedPrevious = normalizeUrl(previousUrl);

  if (!normalizedPrevious) {
    return false;
  }

  try {
    return new URL(normalizedPrevious).origin === window.location.origin;
  } catch (error) {
    console.warn("[bridge:sessionHistory] Failed to compare origins:", error);
    return false;
  }
}

export function ensureSessionHistoryTracking(): void {
  if (!supportsSessionStorage() || typeof window === "undefined") {
    return;
  }

  if (trackingInitialized) {
    return;
  }

  trackingInitialized = true;

  // Fence across hard document loads: if this document was freshly loaded
  // (not back/forward or reload), any pre-existing session entries may be
  // separated from real browser history by an external hard navigation
  // (payment/OAuth return). Trusting them could router.back() onto that
  // external page, so start the mirror fresh.
  if (isFreshDocumentLoad()) {
    clearSessionHistory();
  }

  const { history } = window;
  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);

  history.pushState = ((...args) => {
    originalPushState?.(...args);
    syncCurrentUrlIntoSession("push");
  }) as History["pushState"];

  history.replaceState = ((...args) => {
    originalReplaceState?.(...args);
    // replaceState swaps the current entry in place: treat like push (append
    // if new) rather than a back-truncation.
    syncCurrentUrlIntoSession("push");
  }) as History["replaceState"];

  popstateListener = () => {
    syncCurrentUrlIntoSession("popstate");
  };

  window.addEventListener("popstate", popstateListener);

  syncCurrentUrlIntoSession("init");
}

export function isSessionHistoryEnabled(): boolean {
  return supportsSessionStorage();
}

export function clearSessionHistory(): void {
  if (!supportsSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn("[bridge:sessionHistory] Failed to clear history:", error);
  }
}

export function getSessionHistorySnapshot(): string[] {
  return readHistory();
}

/**
 * Restore the original history.pushState/replaceState and remove the
 * popstate listener. Call when tearing the bridge down in a real app —
 * previously this was only reachable from the test helper, leaving the
 * history monkey-patches installed forever.
 */
export function teardownSessionHistoryTracking(): void {
  if (!trackingInitialized || typeof window === "undefined") {
    return;
  }

  trackingInitialized = false;

  if (originalPushState) {
    window.history.pushState = originalPushState;
    originalPushState = null;
  }

  if (originalReplaceState) {
    window.history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }

  if (popstateListener) {
    window.removeEventListener("popstate", popstateListener);
    popstateListener = null;
  }
}

export function resetSessionHistoryStateForTests(): void {
  teardownSessionHistoryTracking();
  // Clear stored data while availability is still known, so we don't trigger
  // a redundant re-check (and a spurious console.warn) when storage is disabled.
  if (sessionAvailability === true) {
    clearSessionHistory();
  }
  sessionAvailability = null;
}
