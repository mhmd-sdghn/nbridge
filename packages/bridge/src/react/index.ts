"use client";

/**
 * nbridge/react — React hooks for the bridge.
 * Framework-agnostic React only; Next.js back-navigation lives in nbridge/next.
 */
export {
  type BridgeReadyState,
  type CreateBridgeHooksOptions,
  createBridgeHooks,
} from "./createBridgeHooks";
export {
  type CapabilityGateProps,
  createHostHooks,
  type PlatformOnlyProps,
  type VariantSwitchProps,
} from "./createHostHooks";
