/**
 * Forced behavior for bridge back navigation.
 *
 * Lives in the framework-agnostic root entry (`nbridge`) so it can be
 * imported anywhere — including Server Components — while the hooks that
 * consume it stay in the client-only framework entries (`nbridge/next`).
 *
 * @example
 * ```typescript
 * import { BridgeBackAction } from "nbridge";
 *
 * <PageHeader backAction={BridgeBackAction.AppShutdown} />
 * ```
 */
export const BridgeBackAction = {
  RouterBack: "router-back",
  AppShutdown: "app-shutdown",
} as const;

export type BridgeBackAction =
  (typeof BridgeBackAction)[keyof typeof BridgeBackAction];
