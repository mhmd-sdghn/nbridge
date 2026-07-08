"use client";

import { useBridgeBack } from "@/lib/bridge";

/**
 * `router.back()` while there is in-app history to go back to (session mode),
 * otherwise send the shutdown event to the native host.
 */
export function BackButton() {
  const { routerBackOrShutdown, canRouterBack } = useBridgeBack();

  return (
    <button type="button" onClick={() => routerBackOrShutdown()}>
      {canRouterBack() ? "← Back" : "Close WebView"}
    </button>
  );
}
