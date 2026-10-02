"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  BackInterceptManager,
  type BackInterceptPath,
} from "./BackInterceptManager";

/**
 * Declarative hook that intercepts the browser back button.
 *
 * When the user presses back, `onBackCallback` is called instead of navigating
 * away. Uses the BackInterceptManager singleton — only the top active entry in
 * the stack fires per back press (LIFO).
 *
 * @param onBackCallback - Callback invoked when the user presses browser back.
 *   Changing this does NOT cause re-registration (preserves stack position).
 * @param pathName - Optional page to scope the intercept to. A string matches
 *   that app path exactly (no `basePath`, trailing slash ignored — the value
 *   `usePathname()` returns); a `RegExp` is tested against the same path.
 *   Defaults to global ("*"). Set the `basePath` through
 *   `createBridgeBackNavigation(bridge, { basePath })`.
 * @param isActive - Whether the intercept is enabled. Toggling this prop
 *   updates the entry in-place (via manager.update) without changing its stack
 *   position, so a declarative `useBackIntercept(cb, path, isModalOpen)` works.
 *   Defaults to true.
 */
export function useBackIntercept(
  onBackCallback: () => void,
  pathName?: BackInterceptPath,
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

  // An inline regex literal is a new object every render; key on its source
  // and flags so it does not re-register (and lose its stack position) each time.
  const pathRef = useRef(pathName);
  pathRef.current = pathName;
  const pathKey = pathName instanceof RegExp ? String(pathName) : pathName;

  // biome-ignore lint/correctness/useExhaustiveDependencies: manager is a stable singleton; initiallyActive and the path object are read from refs, keyed by pathKey
  useEffect(() => {
    idRef.current = manager.register(
      () => callbackRef.current(),
      pathRef.current,
      initiallyActiveRef.current,
    );
    return () => {
      if (idRef.current) {
        manager.unregister(idRef.current);
        idRef.current = null;
      }
    };
  }, [pathKey]);

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
