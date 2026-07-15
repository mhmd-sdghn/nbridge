"use client";

/**
 * nbridge/next — Next.js App Router back-navigation for WebView apps.
 * Requires the optional `next` peer dependency.
 *
 * This entry is client-only. Pure values usable in Server Components
 * (e.g. `BridgeBackAction`) are exported from the root `nbridge` entry.
 */
export {
  type CreateBridgeBackNavigationOptions,
  createBridgeBackNavigation,
} from "./createBridgeBackNavigation";
export { BackInterceptManager } from "./navigation/BackInterceptManager";
export {
  clearSessionHistory,
  ensureSessionHistoryTracking,
  getSessionHistorySnapshot,
  isSessionHistoryEnabled,
  prepareSessionForRouterBack,
  resetSessionHistoryStateForTests,
  syncCurrentUrlIntoSession,
  teardownSessionHistoryTracking,
} from "./navigation/nextHistorySession";
export { useBackIntercept } from "./navigation/useBackIntercept";
export {
  type BridgeBackNavigationOptions,
  type BridgeNavigationMode,
  canNavigateBack,
  resolveNavigationMode,
  setupBackInterception,
} from "./navigation/utils";
