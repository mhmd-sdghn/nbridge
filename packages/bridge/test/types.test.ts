import * as v from "valibot";
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineMessage } from "../src";
import type {
  ExtractPayload,
  ExtractResponse,
  MessageTypes,
  PayloadFor,
  ResponseFor,
} from "../src/types/schema";

/**
 * Compile-time contract for schema inference. These run as no-op assertions at
 * runtime; the real checks happen during `pnpm typecheck` (tsc includes `test`),
 * so a broken inference chain fails the build, not just this suite.
 */
describe("defineMessage inference", () => {
  it("infers payload and response output types from the schemas", () => {
    const getUser = defineMessage({
      type: "getUser",
      payloadSchema: z.object({ id: z.string() }),
      responseSchema: z.object({ name: z.string() }),
    });

    expectTypeOf<ExtractPayload<typeof getUser>>().toEqualTypeOf<{
      id: string;
    }>();
    expectTypeOf<ExtractResponse<typeof getUser>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("is validator-agnostic (valibot infers the same way)", () => {
    const setTheme = defineMessage({
      type: "setTheme",
      payloadSchema: v.object({ theme: v.picklist(["light", "dark"]) }),
    });

    expectTypeOf<ExtractPayload<typeof setTheme>>().toEqualTypeOf<{
      theme: "light" | "dark";
    }>();
    // No response schema → response stays unknown.
    expectTypeOf<ExtractResponse<typeof setTheme>>().toEqualTypeOf<unknown>();
  });

  it("reflects the TRANSFORMED output shape, not the input", () => {
    const track = defineMessage({
      type: "track",
      payloadSchema: z
        .object({ event: z.string() })
        .transform((p) => ({ ...p, normalized: p.event.toLowerCase() })),
    });

    expectTypeOf<ExtractPayload<typeof track>>().toEqualTypeOf<{
      event: string;
      normalized: string;
    }>();
  });

  it("falls back to unknown when no schema is provided", () => {
    const ping = defineMessage({ type: "ping" });
    expectTypeOf<ExtractPayload<typeof ping>>().toEqualTypeOf<unknown>();
    expectTypeOf<ExtractResponse<typeof ping>>().toEqualTypeOf<unknown>();
  });
});

describe("registry lookups", () => {
  const schemas = {
    getUser: defineMessage({
      type: "getUser",
      payloadSchema: z.object({ id: z.string() }),
      responseSchema: z.object({ name: z.string() }),
    }),
    setTheme: defineMessage({
      type: "setTheme",
      payloadSchema: v.object({ theme: v.picklist(["light", "dark"]) }),
    }),
  };
  type Schemas = typeof schemas;

  it("MessageTypes is the exact union of registered keys", () => {
    expectTypeOf<MessageTypes<Schemas>>().toEqualTypeOf<
      "getUser" | "setTheme"
    >();
  });

  it("PayloadFor/ResponseFor resolve per message type", () => {
    expectTypeOf<PayloadFor<Schemas, "getUser">>().toEqualTypeOf<{
      id: string;
    }>();
    expectTypeOf<ResponseFor<Schemas, "getUser">>().toEqualTypeOf<{
      name: string;
    }>();
    expectTypeOf<PayloadFor<Schemas, "setTheme">>().toEqualTypeOf<{
      theme: "light" | "dark";
    }>();
  });
});
