import * as v from "valibot";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createBridge, defineMessage } from "../src";
import type { BridgeManager } from "../src/core/BridgeManager";
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

describe("Standard Schema validation — zod", () => {
  const schemas = {
    createUser: defineMessage({
      type: "createUser",
      payloadSchema: z.object({ name: z.string().min(1) }),
      responseSchema: z.object({ id: z.string() }),
    }),
  };

  it("accepts valid payloads", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge({ schemas }), native.uninstall);

    const result = await bridge.send("createUser", { name: "Mo" });
    expect(result.success).toBe(true);
    expect(native.sent[0]?.payload).toEqual({ name: "Mo" });
  });

  it("rejects invalid payloads with issue details", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge({ schemas }), native.uninstall);

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: intentionally wrong payload
      bridge.send("createUser", { name: 123 } as any),
    ).rejects.toThrow(/Payload validation failed for "createUser"/);
    expect(native.sent).toHaveLength(0);
  });

  it("validates responses", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge({ schemas }), native.uninstall);

    const pending = bridge.sendWithResponse("createUser", { name: "Mo" });
    await until(() => native.sent.length === 1);
    receiveFromNative({
      type: "createUser_response",
      id: native.sent[0]?.id,
      payload: { id: 42 }, // wrong type: number
    });

    await expect(pending).rejects.toThrow(
      /Response validation failed for "createUser"/,
    );
  });
});

describe("Standard Schema validation — valibot", () => {
  const schemas = {
    setTheme: defineMessage({
      type: "setTheme",
      payloadSchema: v.object({ theme: v.picklist(["light", "dark"]) }),
    }),
  };

  it("works identically with valibot (validator-agnostic)", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge({ schemas }), native.uninstall);

    await bridge.send("setTheme", { theme: "dark" });
    expect(native.sent[0]?.payload).toEqual({ theme: "dark" });

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: intentionally wrong payload
      bridge.send("setTheme", { theme: "blue" } as any),
    ).rejects.toThrow(/Payload validation failed/);
  });
});

describe("schema transforms", () => {
  it("sends the TRANSFORMED payload (Standard Schema output)", async () => {
    const native = installAndroidBridge();
    const schemas = {
      track: defineMessage({
        type: "track",
        payloadSchema: z
          .object({ event: z.string() })
          .transform((p) => ({ ...p, normalized: p.event.toLowerCase() })),
      }),
    };
    const bridge = track(createBridge({ schemas }), native.uninstall);

    await bridge.send("track", { event: "CLICK" });
    expect(native.sent[0]?.payload).toEqual({
      event: "CLICK",
      normalized: "click",
    });
  });
});

describe("no validator at all", () => {
  it("schemas are optional — untyped sends work with zero validators", async () => {
    const native = installAndroidBridge();
    const bridge = track(createBridge(), native.uninstall);

    await bridge.send("anything", { free: "form" });
    expect(native.sent[0]?.payload).toEqual({ free: "form" });
  });
});
