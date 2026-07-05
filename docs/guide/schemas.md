# Schemas & Validation

nBridge is **bring-your-own-validator**. Schemas are defined against the [Standard Schema](https://standardschema.dev) interface, so any compliant library plugs in directly:

- **zod** 3.24+ / 4
- **valibot** 1.x
- **ArkType** 2.x
- …or none at all — schemas are entirely optional, and nBridge ships zero validator dependencies.

## `defineMessage`

```ts
import { z } from "zod";
import { defineMessage } from "nbridge";

const getUser = defineMessage({
  type: "getUser",
  payloadSchema: z.object({ id: z.string() }),        // validates what you send
  responseSchema: z.object({ name: z.string() }),      // validates what comes back
  description: "Fetch a user profile from the host",   // optional, shown in DevTools
  direction: "outgoing",                                // optional documentation hint
  example: { id: "42" },                                // optional, used by the DevTools event sender
});
```

Both `payloadSchema` and `responseSchema` are optional. A schema without them still contributes its `type` to autocompletion.

## Registering schemas

Pass a registry (a plain object keyed by message type) to the bridge:

```ts
import { z } from "zod";
import { createBridge, defineMessage } from "nbridge";

const schemas = {
  getUser: defineMessage({
    type: "getUser",
    payloadSchema: z.object({ id: z.string() }),
    responseSchema: z.object({ name: z.string(), email: z.string() }),
  }),
  themeChanged: defineMessage({
    type: "themeChanged",
    payloadSchema: z.object({ theme: z.enum(["light", "dark"]) }),
    direction: "incoming",
  }),
};

const bridge = createBridge({ schemas });
```

With schemas registered you get:

- **Autocomplete** — `bridge.send("…")` only accepts known message types
- **Typed payloads** — `on("themeChanged", (payload) => …)` infers `{ theme: "light" | "dark" }`
- **Runtime validation** — outgoing payloads are checked before sending; responses are checked before `sendWithResponse` resolves

```ts
const user = await bridge.sendWithResponse("getUser", { id: "42" });
user.name;  // typed as string

bridge.on("themeChanged", ({ theme }) => {
  // theme: "light" | "dark"
});
```

::: tip Untyped escape hatch
A bridge created **without** `schemas` accepts any `string` type and `unknown` payloads — nothing forces you to adopt schemas up front.
:::

## Other validators

::: code-group

```ts [valibot]
import * as v from "valibot";
import { defineMessage } from "nbridge";

const getUser = defineMessage({
  type: "getUser",
  payloadSchema: v.object({ id: v.string() }),
  responseSchema: v.object({ name: v.string() }),
});
```

```ts [ArkType]
import { type } from "arktype";
import { defineMessage } from "nbridge";

const getUser = defineMessage({
  type: "getUser",
  payloadSchema: type({ id: "string" }),
  responseSchema: type({ name: "string" }),
});
```

```ts [types only, no runtime validation]
import type { MessageSchema } from "nbridge";

// No payloadSchema/responseSchema — supply types via the MessageSchema
// generics instead. You get autocompletion and static typing, but no
// runtime checks.
const getUser: MessageSchema<{ id: string }, { name: string }> = {
  type: "getUser",
  description: "Typed by hand, validated by no one",
};
```

:::

### Wrapping a non-Standard-Schema library (e.g. yup)

Any object with a `~standard.validate` function satisfies the interface, so you can adapt legacy validators yourself:

```ts
import type { StandardSchemaV1 } from "nbridge";
import * as yup from "yup";

function fromYup<T>(schema: yup.Schema<T>): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "yup",
      validate: async (value) => {
        try {
          return { value: await schema.validate(value) };
        } catch (err) {
          const e = err as yup.ValidationError;
          return { issues: [{ message: e.message, path: e.path ? [e.path] : undefined }] };
        }
      },
    },
  };
}

const getUser = defineMessage({
  type: "getUser",
  payloadSchema: fromYup(yup.object({ id: yup.string().required() })),
});
```

## Transforms

Validation returns the schema's **output** value, so transforms and defaults apply on the way out and on the way in:

```ts
import { z } from "zod";

const track = defineMessage({
  type: "track",
  payloadSchema: z.object({
    event: z.string().trim().toLowerCase(),   // transformed before sending
    ts: z.number().default(() => Date.now()), // defaulted if omitted
  }),
});
```

The transformed value is what actually crosses the wire. Async validators are supported too — the Standard Schema spec allows `validate` to return a promise, and nBridge awaits it.

## `BridgeValidationError`

When validation fails, the send (or response) rejects with a `BridgeValidationError`:

```ts
import { BridgeValidationError } from "nbridge";

try {
  await bridge.send("getUser", { id: 42 as unknown as string });
} catch (err) {
  if (err instanceof BridgeValidationError) {
    err.messageType; // "getUser"
    err.stage;       // "payload" | "response"
    err.issues;      // ReadonlyArray<StandardSchemaV1.Issue>
    err.message;     // 'Payload validation failed for "getUser": id: Expected string…'
  }
}
```

- `stage: "payload"` — what *you* tried to send was invalid; the message never left the app.
- `stage: "response"` — the *host* answered with data that fails `responseSchema`; treat it as a contract violation on the native side.

`formatIssues(issues)` is exported if you want the same `path: message; path: message` formatting elsewhere.
