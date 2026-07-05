import { afterEach, describe, expect, it } from "vitest";
import { createBridge } from "../src";
import type { BridgeManager } from "../src/core/BridgeManager";
import { installAndroidBridge, receiveFromNative, until } from "./helpers";

let cleanup: Array<() => void> = [];
function track(bridge: BridgeManager, uninstall?: () => void) {
  cleanup.push(() => {
    bridge.destroy();
    uninstall?.();
  });
  return bridge;
}

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

describe("core messaging (Android adapter)", () => {
  it("sends messages as JSON strings to the native interface", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const result = await bridge.send("hello", { a: 1 });

    expect(result.success).toBe(true);
    expect(native.sent).toHaveLength(1);
    expect(native.sent[0]).toMatchObject({ type: "hello", payload: { a: 1 } });
    expect(native.sent[0]?.id).toBeTruthy();
  });

  it("dispatches incoming messages to registered handlers", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const received: unknown[] = [];
    bridge.on("ping", (payload) => {
      received.push(payload);
    });

    receiveFromNative({ type: "ping", payload: { n: 42 } });
    await until(() => received.length === 1);

    expect(received[0]).toEqual({ n: 42 });
  });

  it("correlates responses via message id (sendWithResponse)", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const pending = bridge.sendWithResponse<unknown, { ok: boolean }>(
      "getUser",
      { id: "1" },
      2000,
    );

    await until(() => native.sent.length === 1);
    const request = native.sent[0];
    receiveFromNative({
      type: "getUser_response",
      id: request?.id,
      payload: { ok: true },
    });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("rejects sendWithResponse on timeout", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    await expect(bridge.sendWithResponse("noAnswer", {}, 100)).rejects.toThrow(
      /timed out/i,
    );
  });

  it("onWithResponse answers incoming requests", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    bridge.onWithResponse("sum", (payload: { a: number; b: number }) => {
      return { total: payload.a + payload.b };
    });

    receiveFromNative({ type: "sum", id: "req-1", payload: { a: 2, b: 3 } });
    await until(() => native.sent.length === 1);

    expect(native.sent[0]).toMatchObject({
      type: "sum_response",
      id: "req-1",
      payload: { total: 5 },
    });
  });
});

describe("handshake / readiness", () => {
  it("is ready immediately when handshake is disabled (default)", () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    expect(bridge.isReady()).toBe(true);
  });

  it("is NOT ready until the native side acks when handshake is enabled", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ handshake: { enabled: true, retryInterval: 20 } }),
      native.uninstall,
    );

    expect(bridge.isReady()).toBe(false);

    // Native acks the handshake
    await until(() =>
      native.sent.some((m) => m.type === "__nbridge_handshake__"),
    );
    receiveFromNative({ type: "__nbridge_handshake_ack__" });

    await bridge.waitForReady(1000);
    expect(bridge.isReady()).toBe(true);
  });

  it("becomes ready when the NATIVE side initiates the handshake, and acks it", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ handshake: { enabled: true, retryInterval: 5000 } }),
      native.uninstall,
    );

    receiveFromNative({ type: "__nbridge_handshake__" });
    await bridge.waitForReady(1000);

    expect(bridge.isReady()).toBe(true);
    expect(
      native.sent.some((m) => m.type === "__nbridge_handshake_ack__"),
    ).toBe(true);
  });

  it("waitForReady rejects when the handshake times out", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({
        handshake: { enabled: true, timeout: 120, retryInterval: 30 },
      }),
      native.uninstall,
    );

    await expect(bridge.waitForReady(2000)).rejects.toThrow(/handshake/i);
    expect(bridge.isReady()).toBe(false);
  });
});

describe("web adapter honesty", () => {
  it("send() fails loudly in a plain browser instead of silently dropping", async () => {
    // no android/ios/iframe installed, no loopback
    const bridge = track(createBridge());
    await expect(bridge.send("anything", {})).rejects.toThrow(
      /no native bridge or parent frame/i,
    );
  });

  it("loopback mode round-trips messages for local development", async () => {
    const bridge = track(createBridge({ webLoopback: true }));

    const received: unknown[] = [];
    bridge.on("echo", (payload) => {
      received.push(payload);
    });

    await bridge.send("echo", { hi: true });
    await until(() => received.length === 1);
    expect(received[0]).toEqual({ hi: true });
  });
});
