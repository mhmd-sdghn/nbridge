import { describe, expectTypeOf, it } from "vitest";
import { defineHostRules } from "../src";

/**
 * Type-level assertions for Host Rules inference (acceptance step 7). These are
 * validated by `tsc` at typecheck time. They live in a function that is never
 * invoked — some calls (e.g. an unknown variant) throw at runtime, and we only
 * care that they type-check (or fail to).
 */
const host = defineHostRules({
  version: "9.0.0",
  capabilities: {
    nativeShare: { android: ">=8.2", ios: true },
  },
  variants: {
    saveFlow: {
      rules: [
        { when: { platform: "ios" }, use: "B" },
        { when: { platform: "iframe", version: ">=2" }, use: "C" },
      ],
      default: "A",
    },
  },
});

function _typeAssertions() {
  // Capability names are inferred literals — a typo is a compile error.
  host.supports("nativeShare");
  // @ts-expect-error — "nativShare" is not a defined capability
  host.supports("nativShare");

  // variant() returns the union of every rule's `use` plus the default.
  expectTypeOf(host.variant("saveFlow")).toEqualTypeOf<"A" | "B" | "C">();

  // @ts-expect-error — "unknownVariant" is not a defined variant
  host.variant("unknownVariant");

  // select() requires a `default`.
  expectTypeOf(host.select({ ios: 1, default: 2 })).toEqualTypeOf<number>();
  // @ts-expect-error — missing required `default`
  host.select({ ios: 1 });
}

describe("Host Rules type inference", () => {
  it("compiles the type-level assertions", () => {
    // The real assertions are enforced by `tsc` on _typeAssertions above.
    expectTypeOf(host.variant("saveFlow")).toEqualTypeOf<"A" | "B" | "C">();
  });
});
