"use client";

import { createBridgeBackNavigation } from "nbridge/next";
import { createBridgeHooks } from "nbridge/react";

/**
 * Single bridge instance for the whole app, created at module scope exactly as
 * the docs prescribe. This module is "use client", but Next still evaluates it
 * during server rendering — `createBridgeHooks` is SSR-safe (the core bails when
 * `window` is undefined), so no guard is needed here.
 *
 * `webLoopback` makes the bridge echo its own messages so the demo works in a
 * plain browser with no native host attached: anything sent comes back as an
 * incoming message.
 */
export const {
  useBridgeSend,
  useBridgeMessage,
  useBridgeReady,
  usePlatform,
  instance,
} = createBridgeHooks({
  config: { webLoopback: true, debug: true },
});

export const { useBridgeBack, BridgeBackAction } = createBridgeBackNavigation(
  instance,
  { shutdownEvent: "shutdown" },
);
