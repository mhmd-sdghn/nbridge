/**
 * Bridge singleton for the React playground.
 *
 * createBridgeHooks() must be called ONCE, at module scope — the returned
 * hooks close over the bridge instance, no Provider/context needed.
 *
 * Runs over the web-fallback adapter with `webLoopback: true`, so every sent
 * message echoes back into the incoming pipeline: the handshake
 * self-completes and the `user:get` responder below answers our own
 * useBridgeRequest calls.
 */
import { createBridgeHooks } from "nbridge/react";

export const {
  useBridgeSend,
  useBridgeMessage,
  useBridgeReadyState,
  useBridgeRequest,
  usePlatform,
  useBridgeMetrics,
  instance,
} = createBridgeHooks({
  config: {
    debug: true,
    webLoopback: true,
    handshake: { enabled: true },
    metrics: { enabled: true, updateInterval: 1000, detailedTiming: false },
    devTools: {
      enabled: true,
      maxMessageHistory: 100,
      logDestination: "both",
    },
  },
});

export interface User {
  id: string;
  name: string;
  email: string;
  plan: "free" | "pro";
}

// Demo responder: registered imperatively on the instance (no React lifecycle
// needed). Over loopback, sendWithResponse("user:get") reaches this handler,
// which replies with a correlated `user:get_response`.
instance.onWithResponse<{ id: string }, User>("user:get", async (payload) => {
  instance.info(`Responder user:get handling id=${payload?.id ?? "?"}`);
  // Simulate a little host-side latency so the loading state is visible.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    id: payload?.id ?? "1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    plan: "pro",
  };
});
