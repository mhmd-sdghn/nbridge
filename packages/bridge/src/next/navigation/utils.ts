import { BackInterceptManager } from "./BackInterceptManager";
import {
  canNavigateBackWithinSession,
  ensureSessionHistoryTracking,
  isSessionHistoryEnabled,
  syncCurrentUrlIntoSession,
} from "./nextHistorySession";

export type BridgeNavigationMode = "session" | "browser";

export interface BridgeBackNavigationOptions {
  mode?: BridgeNavigationMode;
}

export function resolveNavigationMode(
  options?: BridgeBackNavigationOptions,
): BridgeNavigationMode {
  const preferredMode: BridgeNavigationMode = options?.mode ?? "session";
  if (preferredMode === "session" && !isSessionHistoryEnabled()) {
    return "browser";
  }

  return preferredMode;
}

/**
 * Registers a one-shot back intercept via BackInterceptManager and returns a
 * cleanup function that unregisters it. Designed for imperative (non-React) use.
 * The intercept unregisters itself after firing once, so a second back press
 * cannot re-trigger the callback (e.g. double shutdown events).
 */
export function setupBackInterception(onBack: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const manager = BackInterceptManager.getInstance();
  let unregistered = false;
  const id = manager.register(
    () => {
      if (!unregistered) {
        unregistered = true;
        manager.unregister(id);
      }
      onBack();
    },
    "*",
    true,
  );
  return () => {
    if (!unregistered) {
      unregistered = true;
      manager.unregister(id);
    }
  };
}

export function canNavigateBack(
  options?: BridgeBackNavigationOptions,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const mode = resolveNavigationMode(options);

  if (mode === "session") {
    ensureSessionHistoryTracking();
    syncCurrentUrlIntoSession();
    return canNavigateBackWithinSession();
  }

  if (window.history.length <= 1) {
    return false;
  }

  const referrer = typeof document !== "undefined" ? document.referrer : "";

  if (referrer === "") {
    return true;
  }

  try {
    return new URL(referrer).origin === window.location.origin;
  } catch (error) {
    console.warn("[bridge:navigation] Failed to parse referrer:", error);
    return false;
  }
}
