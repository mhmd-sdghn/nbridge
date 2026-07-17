import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge } from "../src";
import type { BridgeManager } from "../src/core/BridgeManager";
import {
  encryptionMiddleware,
  filterMiddleware,
  metadataMiddleware,
  retryMiddleware,
  throttleMiddleware,
} from "../src/middleware";
import { installAndroidBridge, receiveFromNative, until } from "./helpers";

let cleanup: Array<() => void> = [];
// biome-ignore lint/suspicious/noExplicitAny: tests use bridges with any schema shape
function track(bridge: BridgeManager<any>, uninstall?: () => void) {
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

describe("MiddlewareManager chain semantics", () => {
  it("does not skip a middleware registered after a retrying one (chain re-entry)", async () => {
    const native = installAndroidBridge({ failTimes: 1 });
    const bridge = track(createBridge(), native.uninstall);

    const stamps: string[] = [];
    // Registered BEFORE retry: runs once per send() call.
    bridge.use(async (message, ctx, next) => {
      if (ctx.direction === "outgoing") stamps.push("outer");
      await next(message);
    });
    // Retry re-drives only what comes AFTER it (the transport).
    bridge.use(retryMiddleware(2, 0));
    // Registered AFTER retry: must run on every retry attempt, not be skipped.
    bridge.use(async (message, ctx, next) => {
      if (ctx.direction === "outgoing") stamps.push("inner");
      await next(message);
    });

    await bridge.send("x", {});

    // outer once; inner twice (first attempt fails at transport, retry succeeds)
    expect(stamps.filter((s) => s === "outer")).toHaveLength(1);
    expect(stamps.filter((s) => s === "inner")).toHaveLength(2);
    expect(native.sent).toHaveLength(1);
  });

  it("runs every middleware in order (no skips) for a normal send", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const order: number[] = [];
    for (let i = 0; i < 3; i++) {
      bridge.use(async (message, _ctx, next) => {
        order.push(i);
        await next(message);
      });
    }

    await bridge.send("x", {});
    expect(order).toEqual([0, 1, 2]);
  });
});

describe("built-in middlewares", () => {
  it("encryption middleware round-trips over a bridge pair", async () => {
    const encrypt = (data: unknown) => `enc:${JSON.stringify(data)}`;
    const decrypt = (s: string) => JSON.parse(s.replace(/^enc:/, ""));

    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    bridge.use(encryptionMiddleware(encrypt, decrypt));

    // Outgoing: payload is wrapped in a tagged encrypted envelope on the wire.
    await bridge.send("secret", { token: "abc" });
    const wire = native.sent[0];
    expect(wire?.payload).toMatchObject({ __nbridgeEncrypted: true });
    expect((wire?.payload as { encrypted: string }).encrypted).toContain("abc");
  });

  it("encryption middleware ignores an incoming payload lacking the marker", async () => {
    const decrypt = vi.fn();
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    bridge.use(encryptionMiddleware((d) => JSON.stringify(d), decrypt));

    const received: unknown[] = [];
    bridge.on("plain", (payload) => {
      received.push(payload);
    });

    // A normal user payload that happens to have an `encrypted` key must NOT be
    // fed to decrypt().
    receiveFromNative({
      type: "plain",
      payload: { encrypted: "not-ours" },
    });

    await until(() => received.length === 1);
    expect(decrypt).not.toHaveBeenCalled();
    expect(received[0]).toEqual({ encrypted: "not-ours" });
  });

  it("filter middleware blocks matching outgoing messages from the wire", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    bridge.use(filterMiddleware((message) => message.type !== "blocked"));

    await bridge.send("allowed", { a: 1 });
    await bridge.send("blocked", { a: 2 });

    expect(native.sent.map((m) => m.type)).toEqual(["allowed"]);
  });

  it("metadata middleware leaves array/primitive payloads untouched", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    bridge.use(metadataMiddleware({ v: 1 }));

    await bridge.send("obj", { a: 1 });
    await bridge.send("arr", [1, 2, 3]);

    expect(native.sent[0]?.payload).toMatchObject({
      a: 1,
      __metadata: { v: 1 },
    });
    // Array payload is passed through unchanged (no __metadata injection).
    expect(native.sent[1]?.payload).toEqual([1, 2, 3]);
  });

  it("throttle middleware spaces out a burst instead of releasing all at once", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);
    bridge.use(throttleMiddleware(100)); // 10ms min interval

    const start = Date.now();
    await Promise.all([
      bridge.send("a", {}),
      bridge.send("b", {}),
      bridge.send("c", {}),
    ]);
    const elapsed = Date.now() - start;

    expect(native.sent).toHaveLength(3);
    // 3 messages at >=10ms spacing take at least ~20ms; a broken throttle
    // releases them all immediately (~0ms).
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});
