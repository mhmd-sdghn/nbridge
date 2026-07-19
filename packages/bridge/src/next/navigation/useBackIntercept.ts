"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * @param isActive - Whether the intercept is enabled. Toggling this prop
 *   updates the entry in-place (via manager.update) without changing its stack
 *   position, so a declarative `useBackIntercept(cb, path, isModalOpen)` works.
 *   Defaults to true.
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

  // Re-register only when pathName changes (re-registering would reset stack
  // position). The registration-time active value is read from a ref so a
  // change to initiallyActive does not force a re-register.
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

  // Honor the documented contract: toggling initiallyActive updates the entry
  // in place (preserving its stack position) instead of being ignored.
  useEffect(() => {
    if (idRef.current) {
      manager.update(idRef.current, { isActive: initiallyActive });
    }
  }, [initiallyActive, manager]);

  const activateIntercept = useCallback(() => {
    if (idRef.current) manager.update(idRef.current, { isActive: true });
  }, [manager]);

  const deactivateIntercept = useCallback(() => {
    if (idRef.current) manager.update(idRef.current, { isActive: false });
  }, [manager]);

  return {
    activateIntercept,
    deactivateIntercept,
    /** @deprecated Misspelled casing; use `deactivateIntercept`. */
    deActivateIntercept: deactivateIntercept,
  };
}
