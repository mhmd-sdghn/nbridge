"use client";

/**
 * nbridge/next — Next.js App Router back-navigation for WebView apps.
 * Requires the optional `next` peer dependency.
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
  BridgeBackAction,
  type BridgeBackNavigationOptions,
  type BridgeNavigationMode,
  canNavigateBack,
  resolveNavigationMode,
  setupBackInterception,
} from "./navigation/utils";
