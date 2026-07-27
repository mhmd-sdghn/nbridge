"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { BridgeBackAction } from "../constants/backAction";
import type { IBridgeManager } from "../types";
import {
  ensureSessionHistoryTracking,
  prepareSessionForRouterBack,
  syncCurrentUrlIntoSession,
} from "./navigation/nextHistorySession";
import {
  type BridgeBackNavigationOptions,
  canNavigateBack,
  resolveNavigationMode,
  setupBackInterception,
} from "./navigation/utils";

export interface CreateBridgeBackNavigationOptions {
  /**
   * Message type sent to the native host when back navigation should close
   * the WebView instead of navigating within the app.
   * @default "shutdown"
   */
  shutdownEvent?: string;
}

/**
 * Binds Next.js back-navigation behavior to an existing bridge instance.
 *
 * @example
 * // src/lib/bridge.ts
 * import { createBridgeHooks } from "nbridge/react";
 * import { createBridgeBackNavigation } from "nbridge/next";
 *
 * export const { useBridgeSend, instance } = createBridgeHooks({ ... });
 * export const { useBridgeBack } = createBridgeBackNavigation(instance);
 */
export function createBridgeBackNavigation(
  bridge: IBridgeManager,
  options: CreateBridgeBackNavigationOptions = {},
) {
  const shutdownEvent = options.shutdownEvent ?? "shutdown";

  function useBridgeBack(navOptions?: BridgeBackNavigationOptions) {
    const router = useRouter();
    const pathname = usePathname();
    const removeInterceptRef = useRef<(() => void) | null>(null);
    // True between issuing router.back() and the resulting route change. Guards
    // against a rapid second tap popping browser history twice before the first
    // traversal's popstate lands.
    const backInFlightRef = useRef(false);
    // The shutdown counterpart of backInFlightRef: guards the window between
    // issuing the send and it settling, so two rapid taps send one shutdown.
    // Released either way once settled — a delivered shutdown does not mean the
    // host closed anything (it may prompt, or ignore the type), and latching it
    // permanently would leave back dead for the rest of the session.
    const shutdownInFlightRef = useRef(false);
    const navigationMode = navOptions?.mode ?? "session";

    // Guarantee back-intercept cleanup on unmount even if caller forgets
    useEffect(() => {
      return () => {
        removeInterceptRef.current?.();
        removeInterceptRef.current = null;
      };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: must re-sync session history on every route change
    useEffect(() => {
      // A route change means any in-flight back() has landed.
      backInFlightRef.current = false;
      const resolvedMode = resolveNavigationMode({ mode: navigationMode });
      if (resolvedMode === "session") {
        ensureSessionHistoryTracking();
        syncCurrentUrlIntoSession();
      }
    }, [pathname, navigationMode]);

    const canRouterBack = useCallback(
      () => canNavigateBack({ mode: navigationMode }),
      [navigationMode],
    );

    const sendShutdownEvent = useCallback(async () => {
      if (shutdownInFlightRef.current) return;
      shutdownInFlightRef.current = true;
      try {
        // The shutdown overtakes the batcher (below), so anything still waiting
        // there would be lost when the host tears the WebView down. Get it out
        // first; a failed batch is not a reason to keep the app open.
        await bridge.flushBatch().catch(() => {});

        // Shutting down is now-or-never: the host tears the WebView down, so a
        // message parked in the retry queue would either never arrive or arrive
        // in a later session and close the app out from under the user.
        // `immediate` keeps it off both the batcher and the queue.
        await bridge.send(shutdownEvent, {}, { immediate: true });
      } catch (err) {
        console.error("[nbridge] Failed to send shutdown message:", err);
      } finally {
        shutdownInFlightRef.current = false;
      }
    }, []);

    const forceBrowserBackToShutdownApp = useCallback(() => {
      if (typeof window === "undefined") return;
      removeInterceptRef.current?.();
      removeInterceptRef.current = setupBackInterception(() => {
        void sendShutdownEvent();
      });
    }, [sendShutdownEvent]);

    const removeForceBrowserBackToShutdownApp = useCallback(() => {
      removeInterceptRef.current?.();
      removeInterceptRef.current = null;
    }, []);

    const routerBackOrShutdown = useCallback(
      async (force?: BridgeBackAction) => {
        const resolvedMode = resolveNavigationMode({ mode: navigationMode });

        const shouldUseRouter =
          (canRouterBack() && force !== BridgeBackAction.AppShutdown) ||
          force === BridgeBackAction.RouterBack;

        if (shouldUseRouter) {
          // Ignore a second invocation while a router.back() is still settling;
          // otherwise the session list is popped twice and the browser ends up
          // multiple entries behind.
          if (backInFlightRef.current) return;
          backInFlightRef.current = true;
          if (resolvedMode === "session") {
            prepareSessionForRouterBack();
          }
          router.back();
        } else if (!force || force === BridgeBackAction.AppShutdown) {
          await sendShutdownEvent();
        }
      },
      [navigationMode, canRouterBack, router, sendShutdownEvent],
    );

    return {
      routerBackOrShutdown,
      canRouterBack,
      forceBrowserBackToShutdownApp,
      removeForceBrowserBackToShutdownApp,
    };
  }

  return { useBridgeBack };
}
