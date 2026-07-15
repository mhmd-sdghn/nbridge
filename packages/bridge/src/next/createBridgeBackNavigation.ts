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
      try {
        await bridge.send(shutdownEvent, {});
      } catch (err) {
        console.error("[nbridge] Failed to send shutdown message:", err);
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
