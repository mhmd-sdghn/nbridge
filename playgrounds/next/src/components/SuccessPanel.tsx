"use client";

import { useEffect, useState } from "react";
import { useBridgeBack, useBridgeMessage } from "@/lib/bridge";

/**
 * Final-screen pattern: arm a one-shot intercept so the hardware/browser back
 * gesture sends the shutdown event instead of navigating back into the flow.
 * The empty dep array is safe under StrictMode (see the nbridge/next docs).
 */
export function SuccessPanel() {
  const { forceBrowserBackToShutdownApp, removeForceBrowserBackToShutdownApp } =
    useBridgeBack();
  const [fired, setFired] = useState(false);

  useBridgeMessage("shutdown", () => setFired(true));

  // biome-ignore lint/correctness/useExhaustiveDependencies: documented [] usage — must be StrictMode-safe
  useEffect(() => {
    forceBrowserBackToShutdownApp();
    return removeForceBrowserBackToShutdownApp;
  }, []);

  return (
    <section className="card">
      <h2>Success 🎉</h2>
      <p>
        Press the browser/hardware back button. Instead of returning to the
        form, the bridge sends <code>shutdown</code> to the host.
      </p>
      <p>
        <strong>Shutdown intercept fired:</strong> {String(fired)}
      </p>
    </section>
  );
}
