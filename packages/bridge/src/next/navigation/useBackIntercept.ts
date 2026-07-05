"use client";

import { useEffect, useRef } from "react";
import { BackInterceptManager } from "./BackInterceptManager";

/**
 * Declarative hook that intercepts the browser back button.
 *
 * When the user presses back, `onBackCallback` is called instead of navigating
 * away. Uses the BackInterceptManager singleton — only the top active entry in
 * the stack fires per back press (LIFO).
 *
 * @param onBackCallback - Callback invoked when the user presses browser back.
 *   Changing this does NOT cause re-registration (preserves stack position).
 * @param pathName - Optional path to scope the intercept. When provided, only
 *   fires when the current URL pathname matches. Defaults to global ("*").
 * @param initiallyActive - Whether the intercept is enabled. Toggling this updates
 *   the entry in-place without changing its stack position. Defaults to true.
 */
export function useBackIntercept(
  onBackCallback: () => void,
  pathName?: string,
  initiallyActive = true,
) {
  const manager = BackInterceptManager.getInstance();
  const idRef = useRef<string | null>(null);
  const callbackRef = useRef(onBackCallback);

  useEffect(() => {
    callbackRef.current = onBackCallback;
  });

  // Re-register when pathName changes. initiallyActive is applied on
  // registration only (later toggles go through activate/deActivate) — the
  // ref keeps the registration-time value without forcing a re-register.
  const initiallyActiveRef = useRef(initiallyActive);
  initiallyActiveRef.current = initiallyActive;

  // biome-ignore lint/correctness/useExhaustiveDependencies: manager is a stable singleton; initiallyActive intentionally read from ref
  useEffect(() => {
    idRef.current = manager.register(
      () => callbackRef.current(),
      pathName,
      initiallyActiveRef.current,
    );
    return () => {
      if (idRef.current) {
        manager.unregister(idRef.current);
        idRef.current = null;
      }
    };
  }, [pathName]);

  const activateIntercept = () =>
    idRef.current && manager.update(idRef.current, { isActive: true });

  const deActivateIntercept = () =>
    idRef.current && manager.update(idRef.current, { isActive: false });

  return { activateIntercept, deActivateIntercept };
}
