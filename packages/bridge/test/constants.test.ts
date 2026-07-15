import { describe, expect, expectTypeOf, it } from "vitest";
import { BridgeBackAction, MessagePriority } from "../src";

/**
 * These constants must stay importable from the framework-agnostic root entry
 * (no "use client") so Server Components can read them — see docs/guide/nextjs.md.
 */
describe("root-entry constants", () => {
  it("exposes BridgeBackAction with stable wire values", () => {
    expect(BridgeBackAction).toEqual({
      RouterBack: "router-back",
      AppShutdown: "app-shutdown",
    });
  });

  it("exposes MessagePriority with stable wire values", () => {
    expect(MessagePriority).toEqual({
      HIGH: "high",
      NORMAL: "normal",
      LOW: "low",
    });
  });

  it("derives the union types from the object values", () => {
    expectTypeOf<BridgeBackAction>().toEqualTypeOf<
      "router-back" | "app-shutdown"
    >();
    expectTypeOf<MessagePriority>().toEqualTypeOf<"high" | "normal" | "low">();
  });
});
