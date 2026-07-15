import { afterEach, describe, expect, it } from "vitest";
import { createBridge, PROTOCOL } from "../src";
import type { BridgeManager } from "../src/core/BridgeManager";
import type { BridgeMessage } from "../src/types";
import {
  installAndroidBridge,
  receiveFromNative,
  until,
  wait,
} from "./helpers";

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

describe("compression wiring", () => {
  it("compresses large outgoing payloads on the wire", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({
        compression: { enabled: true, algorithm: "deflate", threshold: 100 },
      }),
      native.uninstall,
    );

    const bigPayload = { text: "x".repeat(2000) };
    await bridge.send("big", bigPayload);

    expect(native.sent).toHaveLength(1);
    const wire = native.sent[0];
    expect(wire?.__compressed).toBe(true);
    expect(typeof wire?.payload).toBe("string");
    expect((wire?.payload as string).length).toBeLessThan(2000);
    expect(bridge.getCompressionStats()?.totalCompressed).toBe(1);
  });

  it("leaves small payloads uncompressed (below threshold)", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({
        compression: { enabled: true, algorithm: "deflate", threshold: 1024 },
      }),
      native.uninstall,
    );

    await bridge.send("small", { a: 1 });
    expect(native.sent[0]?.__compressed).toBeUndefined();
    expect(native.sent[0]?.payload).toEqual({ a: 1 });
  });

  it("decompresses incoming compressed payloads even when local compression is off", async () => {
    const nativeA = installAndroidBridge();
    // Sender bridge with compression on, to produce a compressed wire message
    const sender = createBridge({
      compression: { enabled: true, algorithm: "deflate", threshold: 10 },
    });
    await sender.send("data", { text: "y".repeat(500) });
    const wireMessage = nativeA.sent[0] as BridgeMessage;
    sender.destroy();

    // Receiver bridge with compression DISABLED must still decode it
    const nativeB = installAndroidBridge();
    const receiver = track(createBridge(), nativeB.uninstall);

    const received: unknown[] = [];
    receiver.on("data", (payload) => {
      received.push(payload);
    });

    receiveFromNative(wireMessage);
    await until(() => received.length === 1);
    expect(received[0]).toEqual({ text: "y".repeat(500) });
  });
});

describe("batching wiring", () => {
  it("groups fire-and-forget sends into one batch envelope on the wire", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ batching: { enabled: true, maxSize: 10, maxWait: 50 } }),
      native.uninstall,
    );

    await bridge.send("a", { n: 1 });
    await bridge.send("b", { n: 2 });
    await bridge.send("c", { n: 3 });

    expect(native.sent).toHaveLength(0); // nothing on the wire yet

    await until(() => native.sent.length === 1);
    const envelope = native.sent[0];
    expect(envelope?.type).toBe(PROTOCOL.BATCH);
    const inner = (envelope?.payload as { messages: BridgeMessage[] }).messages;
    expect(inner.map((m) => m.type)).toEqual(["a", "b", "c"]);

    await until(() => bridge.getBatchStats()?.sent === 3);
    expect(bridge.getBatchStats()).toMatchObject({ sent: 3, failed: 0 });
  });

  it("flushes immediately when the batch is full", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ batching: { enabled: true, maxSize: 2, maxWait: 5000 } }),
      native.uninstall,
    );

    await bridge.send("a", 1);
    await bridge.send("b", 2);

    await until(() => native.sent.length === 1);
    expect(native.sent[0]?.type).toBe(PROTOCOL.BATCH);
  });

  it("does not batch messages expecting a response", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ batching: { enabled: true, maxSize: 10, maxWait: 5000 } }),
      native.uninstall,
    );

    void bridge
      .send("rpc", {}, { expectResponse: true, timeout: 60 })
      .catch(() => {});
    await until(() => native.sent.length === 1);
    expect(native.sent[0]?.type).toBe("rpc"); // straight to the wire
  });

  it("unpacks incoming batch envelopes into individual messages", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const seen: string[] = [];
    bridge.on("x", () => {
      seen.push("x");
    });
    bridge.on("y", () => {
      seen.push("y");
    });

    receiveFromNative({
      type: PROTOCOL.BATCH,
      payload: {
        messages: [
          { type: "x", payload: {} },
          { type: "y", payload: {} },
        ],
      },
    });

    await until(() => seen.length === 2);
    expect(seen).toEqual(["x", "y"]);
  });
});

describe("offline queue wiring", () => {
  it("queues messages when the adapter fails, then flushes successfully", async () => {
    const native = installAndroidBridge({ failTimes: 1 });
    const bridge = track(
      createBridge({
        queue: {
          enabled: true,
          maxSize: 10,
          persist: false,
          storageKey: "t",
          autoFlush: false,
          flushInterval: 0,
        },
      }),
      native.uninstall,
    );

    // First send fails at the adapter → parked in the queue, not thrown
    await bridge.send("important", { v: 1 });
    expect(bridge.getQueueStats()?.size).toBe(1);
    expect(native.sent).toHaveLength(0);

    // Native is back — flush delivers the queued message
    await bridge.flushQueue();
    expect(native.sent).toHaveLength(1);
    expect(native.sent[0]).toMatchObject({ type: "important" });
    expect(bridge.getQueueStats()?.size).toBe(0);
    expect(bridge.getQueueStats()?.completed).toBe(1);
  });

  it("honors priority ordering on flush", async () => {
    const native = installAndroidBridge({ failTimes: 3 });
    const bridge = track(
      createBridge({
        queue: {
          enabled: true,
          maxSize: 10,
          persist: false,
          storageKey: "t2",
          autoFlush: false,
          flushInterval: 0,
        },
      }),
      native.uninstall,
    );

    await bridge.send("low", {}, { priority: "LOW" });
    await bridge.send("normal", {});
    await bridge.send("high", {}, { priority: "HIGH" });
    expect(bridge.getQueueStats()?.size).toBe(3);

    await bridge.flushQueue();
    expect(native.sent.map((m) => m.type)).toEqual(["high", "normal", "low"]);
  });

  it("migrates persisted queues keyed by legacy numeric priorities", async () => {
    const storageKey = "t3";
    const legacyEntry = (type: string, priority: number) => ({
      message: { type, payload: {} },
      retries: 0,
      attempts: 0,
      priority,
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        queueData: {
          "0": [legacyEntry("high", 0)],
          "1": [legacyEntry("normal", 1)],
          "2": [legacyEntry("low", 2)],
        },
        stats: { size: 3, pending: 3, failed: 0, completed: 0 },
      }),
    );

    const native = installAndroidBridge();
    const bridge = track(
      createBridge({
        queue: {
          enabled: true,
          maxSize: 10,
          persist: true,
          storageKey,
          autoFlush: false,
          flushInterval: 0,
        },
      }),
      native.uninstall,
    );
    cleanup.push(() => localStorage.removeItem(storageKey));

    expect(bridge.getQueueStats()?.size).toBe(3);
    await bridge.flushQueue();
    expect(native.sent.map((m) => m.type)).toEqual(["high", "normal", "low"]);
  });
});

describe("metrics wiring", () => {
  it("records sent/received counts and byte sizes from the real pipeline", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({
        metrics: { enabled: true, updateInterval: 60000, detailedTiming: true },
      }),
      native.uninstall,
    );

    await bridge.send("m1", { hello: "world" });
    await bridge.send("m2", { n: 2 });
    receiveFromNative({ type: "incoming", payload: { z: 1 } });

    await until(() => (bridge.getMetrics()?.messagesReceived ?? 0) === 1);

    const metrics = bridge.getMetrics();
    expect(metrics?.messagesSent).toBe(2);
    expect(metrics?.messagesReceived).toBe(1);
    expect(metrics?.bytesSent).toBeGreaterThan(0);
    expect(metrics?.bytesReceived).toBeGreaterThan(0);
  });

  it("records failures when a send cannot be delivered", async () => {
    const native = installAndroidBridge({ failTimes: 1 });
    const bridge = track(
      createBridge({
        metrics: {
          enabled: true,
          updateInterval: 60000,
          detailedTiming: false,
        },
      }),
      native.uninstall,
    );

    await expect(bridge.send("fail", {})).rejects.toThrow();
    expect(bridge.getMetrics()?.messagesFailed).toBe(1);
  });
});

describe("middleware", () => {
  it("outgoing middleware can transform messages before the wire", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    bridge.use(async (message, context, next) => {
      if (context.direction === "outgoing") {
        await next({
          ...message,
          payload: { ...(message.payload as object), stamped: true },
        });
      } else {
        await next(message);
      }
    });

    await bridge.send("stamp", { base: 1 });
    expect(native.sent[0]?.payload).toEqual({ base: 1, stamped: true });
  });

  it("incoming middleware errors do not become unhandled rejections", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    bridge.use(async () => {
      throw new Error("middleware exploded");
    });

    // Must not throw or leave an unhandled rejection
    receiveFromNative({ type: "boom", payload: {} });
    await wait(50);
  });
});
