import { afterEach, describe, expect, it } from "vitest";
import { createBridge, MessagePriority, PROTOCOL } from "../src";
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
        compression: { enabled: true, threshold: 100 },
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
        compression: { enabled: true, threshold: 1024 },
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
      compression: { enabled: true, threshold: 10 },
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

  it("a corrupt compressed payload is dropped without killing the bridge", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    const received: unknown[] = [];
    bridge.on("data", (payload) => {
      received.push(payload);
    });

    // Garbage base64 with the __compressed flag: decompression throws.
    receiveFromNative({
      type: "data",
      __compressed: true,
      payload: "!!!not-valid-deflate!!!",
    });

    await wait(30);
    // The corrupt message is dropped (not dispatched)...
    expect(received).toHaveLength(0);

    // ...and the bridge still works for the next, valid message.
    receiveFromNative({ type: "data", payload: { ok: true } });
    await until(() => received.length === 1);
    expect(received[0]).toEqual({ ok: true });
  });

  it("leaves an incompressible payload uncompressed (no wire inflation)", async () => {
    const native = installAndroidBridge();
    const bridge = track(
      createBridge({ compression: { enabled: true, threshold: 10 } }),
      native.uninstall,
    );

    // Random-ish, already-dense content above threshold: base64 of deflate is
    // not smaller, so it must ship uncompressed.
    const incompressible = Array.from({ length: 40 }, (_, i) =>
      String.fromCharCode(33 + (i % 90)),
    ).join("");
    await bridge.send("blob", { d: incompressible });

    expect(native.sent[0]?.__compressed).toBeUndefined();
    expect(native.sent[0]?.payload).toEqual({ d: incompressible });
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

  it("accepts the MessagePriority constant values (lowercase) as well as uppercase names", async () => {
    // failTimes matches the 2 initial sends so both are queued; the flush then
    // delivers them in priority order.
    const native = installAndroidBridge({ failTimes: 2 });
    const bridge = track(
      createBridge({
        queue: {
          enabled: true,
          maxSize: 10,
          persist: false,
          storageKey: "t2b",
          autoFlush: false,
          flushInterval: 0,
        },
      }),
      native.uninstall,
    );

    // Using MessagePriority.HIGH ("high") previously mapped to undefined and
    // dropped the message; it must now queue and flush at HIGH priority.
    await bridge.send("low", {}, { priority: MessagePriority.LOW });
    await bridge.send("high", {}, { priority: MessagePriority.HIGH });
    expect(bridge.getQueueStats()?.size).toBe(2);

    await bridge.flushQueue();
    expect(native.sent.map((m) => m.type)).toEqual(["high", "low"]);
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

  it("rejects a send instead of silently dropping when the queue is full", async () => {
    // Adapter always fails; queue caps at 1. First failed send is queued,
    // the second cannot be queued and must reject rather than resolve success.
    const native = installAndroidBridge({ failTimes: 10 });
    const bridge = track(
      createBridge({
        queue: {
          enabled: true,
          maxSize: 1,
          persist: false,
          storageKey: "t-overflow",
          autoFlush: false,
          flushInterval: 0,
        },
      }),
      native.uninstall,
    );

    await bridge.send("first", {}); // fails at adapter → queued (size 1)
    expect(bridge.getQueueStats()?.size).toBe(1);

    // Second send fails at adapter, queue is full → must reject, not resolve.
    await expect(bridge.send("second", {})).rejects.toThrow();
    expect(bridge.getQueueStats()?.size).toBe(1);
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

  it("successRate reflects mixed success and failure (not stuck at 1.0)", async () => {
    // Fails the first send, succeeds the second.
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

    await expect(bridge.send("a", {})).rejects.toThrow(); // failure
    await bridge.send("b", {}); // success

    const metrics = bridge.getMetrics();
    expect(metrics?.messagesSent).toBe(1);
    expect(metrics?.messagesFailed).toBe(1);
    // 1 success / (1 success + 1 failure) = 0.5, not the old stuck-at-1.0.
    expect(metrics?.successRate).toBeCloseTo(0.5, 5);
  });

  it("successRate is not 1.0 when every send fails", async () => {
    const native = installAndroidBridge({ failTimes: 5 });
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

    await expect(bridge.send("x", {})).rejects.toThrow();
    expect(bridge.getMetrics()?.successRate).toBe(0);
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
