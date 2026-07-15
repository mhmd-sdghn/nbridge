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

// A host with traits: `mk` has a declared value domain, `tenant` is open-ended.
const traitHost = defineHostRules({
  traits: {
    mk: { source: () => null, values: ["google", "bing"] as const },
    tenant: () => null,
  },
  capabilities: {
    promo: { web: true, when: { traits: { mk: "google" } } },
  },
  variants: {
    channel: {
      rules: [
        { when: { traits: { mk: "google" } }, use: "G" },
        { when: { traits: { mk: ["bing"] } }, use: "B" }, // array = one of
        { when: { traits: { tenant: "acme" } }, use: "T" }, // open-ended: any string
      ],
      default: "D",
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

  // A declared-domain trait rejects values outside its `values` list.
  defineHostRules({
    traits: { mk: { source: () => null, values: ["google", "bing"] as const } },
    variants: {
      f: {
        rules: [
          { when: { traits: { mk: "google" } }, use: "A" },
          // @ts-expect-error — "gogle" is not a declared value of trait "mk"
          { when: { traits: { mk: "gogle" } }, use: "B" },
        ],
        default: "A",
      },
    },
  });

  // setTrait is typed to declared trait names.
  traitHost.setTrait("mk", "bing");
  traitHost.setTrait("tenant", "acme");
  // @ts-expect-error — "nope" is not a declared trait
  traitHost.setTrait("nope", "x");

  // variant() value union still includes every rule's `use` plus the default.
  expectTypeOf(traitHost.variant("channel")).toEqualTypeOf<
    "G" | "B" | "T" | "D"
  >();
}

describe("Host Rules type inference", () => {
  it("compiles the type-level assertions", () => {
    // The real assertions are enforced by `tsc` on _typeAssertions above.
    expectTypeOf(host.variant("saveFlow")).toEqualTypeOf<"A" | "B" | "C">();
  });
});
