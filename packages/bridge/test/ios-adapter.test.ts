import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge } from "../src";
import type { BridgeManager } from "../src/core/BridgeManager";
import type { BridgeMessage } from "../src/types";

/**
 * iOS delivers the raw message OBJECT to webkit.messageHandlers[handler]
 * (WKScriptMessage.body), unlike Android which receives a JSON string. This is
 * a load-bearing wire contract ("Do not align them"): a refactor that
 * stringifies the iOS path would break every iOS host and still pass the
 * Android-based tests. This test pins the object contract.
 */

let cleanup: Array<() => void> = [];
// biome-ignore lint/suspicious/noExplicitAny: test bridges use any schema shape
function track(bridge: BridgeManager<any>, uninstall?: () => void) {
  cleanup.push(() => {
    bridge.destroy();
    uninstall?.();
  });
  return bridge;
}

function installIOSBridge(handlerName = "iosBridge") {
  const posted: unknown[] = [];
  const postMessage = vi.fn((body: unknown) => {
    posted.push(body);
  });
  (window as unknown as Record<string, unknown>).webkit = {
    messageHandlers: { [handlerName]: { postMessage } },
  };
  return {
    posted,
    postMessage,
    uninstall: () => {
      delete (window as unknown as Record<string, unknown>).webkit;
    },
  };
}

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

describe("iOS adapter wire format", () => {
  it("posts the raw message object (not a JSON string) to the iOS handler", async () => {
    const ios = installIOSBridge();
    const bridge = track(createBridge(), ios.uninstall);

    await bridge.send("greet", { name: "mo" });

    expect(ios.posted).toHaveLength(1);
    const body = ios.posted[0] as BridgeMessage;
    // Must be an object with the message shape, NOT a string.
    expect(typeof body).toBe("object");
    expect(body).toMatchObject({ type: "greet", payload: { name: "mo" } });
    expect(body.id).toBeTruthy();
  });

  it("selects the iOS platform when webkit.messageHandlers is present", () => {
    const ios = installIOSBridge();
    const bridge = track(createBridge(), ios.uninstall);
    expect(bridge.getPlatform().platform).toBe("ios");
    expect(bridge.getPlatform().isNative).toBe(true);
  });
});
