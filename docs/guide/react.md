# React

`nbridge/react` provides a hook factory. No provider, no context — `createBridgeHooks` creates the bridge instance at module load time and returns hooks that close over it, all fully typed by your schema registry.

```sh
npm i nbridge react
```

## Setup

Call the factory **once per app, at module scope**:

```ts
// src/lib/bridge.ts
import { z } from "zod";
import { defineMessage } from "nbridge";
import { createBridgeHooks } from "nbridge/react";

const schemas = {
  getUser: defineMessage({
    type: "getUser",
    payloadSchema: z.object({ id: z.string() }),
    responseSchema: z.object({ name: z.string() }),
  }),
  themeChanged: defineMessage({
    type: "themeChanged",
    payloadSchema: z.object({ theme: z.enum(["light", "dark"]) }),
  }),
};

export const {
  useBridgeSend,
  useBridgeMessage,
  useBridgeMessageState,
  useBridgeReady,
  useBridgeReadyState,
  useBridgeRequest,
  useBridgeRPC,
  usePlatform,
  useIsNative,
  useBridgeMetrics,
  useBridgeQueue,
  instance, // the underlying BridgeManager — for use outside React
} = createBridgeHooks({
  config: { schemas, handshake: { enabled: true } },
});
```

::: warning One factory call per app
Each `createBridgeHooks()` call creates an independent bridge with its own adapter listeners. Export the hooks from a single module and import them everywhere.
:::

The `instance` escape hatch is a full [`BridgeManager`](/reference/bridge-manager) — use it for imperative, non-React listeners:

```ts
instance.on("error", (payload) => instance.error(payload));
```

## Sending

### `useBridgeSend`

```tsx
function BuyButton() {
  const { send, sendWithResponse } = useBridgeSend();

  return (
    <button
      onClick={async () => {
        await send("themeChanged", { theme: "dark" });          // fire-and-forget
        const user = await sendWithResponse("getUser", { id: "42" }); // typed reply
      }}
    >
      Go
    </button>
  );
}
```

### `useBridgeRequest`

Request state machine — `loading` / `error` / `data`, plus `reset`:

```tsx
function Profile() {
  const { request, loading, error, data } = useBridgeRequest("getUser");

  if (loading) return <Spinner />;
  if (error) return <p>{error.message}</p>;

  return (
    <div>
      <button onClick={() => request({ id: "42" })}>Load</button>
      {data && <p>{data.name}</p>}
    </div>
  );
}
```

### `useBridgeRPC`

For hosts that answer with a **separate event** (`<type>_response` as a standalone message) rather than the correlated response protocol. The response subscription lives for the whole lifetime of the hook, so an answer arriving before React commits an effect is never missed; concurrent calls are correlated by id when the host echoes it.

```tsx
const { call, response, loading, error, reset } = useBridgeRPC<
  { id: string },
  { name: string }
>("getUser"); // listens for "getUser_response" by default; override with a 2nd arg

await call({ id: "42" });
// response updates when the host answers
```

Prefer `useBridgeRequest` when the host echoes message ids.

## Receiving

### `useBridgeMessage`

Subscribes on mount, unsubscribes on unmount. The handler ref is kept current, so you never re-subscribe (or capture stale closures) as the component re-renders:

```tsx
useBridgeMessage("themeChanged", ({ theme }) => {
  document.documentElement.dataset.theme = theme;
});

// Pass `enabled` to gate the subscription:
useBridgeMessage("themeChanged", handler, isSettingsOpen);
```

### `useBridgeMessageState`

Stores the latest payload as state:

```tsx
const [theme, message] = useBridgeMessageState("themeChanged", { theme: "light" });
// theme: { theme: "light" | "dark" }, message: the full BridgeMessage (or null)
```

## Lifecycle

### `useBridgeReady` / `useBridgeReadyState`

```tsx
function Gate({ children }: { children: React.ReactNode }) {
  const { ready, error } = useBridgeReadyState();

  if (error) return <p>Bridge failed: {error.message}</p>; // e.g. handshake timeout
  if (!ready) return <Spinner />;
  return <>{children}</>;
}
```

`useBridgeReady()` returns just the boolean. Prefer `useBridgeReadyState` when the [handshake](/guide/core-concepts#with-handshake-ready-means-the-other-side-answered) is enabled — a timed-out handshake surfaces as `error` instead of a forever-false flag.

## Environment

```tsx
const { platform, isNative, userAgent } = usePlatform(); // non-reactive; platform can't change after load
const native = useIsNative();
```

## Observability

### `useBridgeMetrics`

```tsx
const metrics = useBridgeMetrics(); // BridgeMetrics | null, re-renders on each update
```

### `useBridgeQueue`

```tsx
const { stats, flush, hasMessages } = useBridgeQueue(1000); // poll interval in ms

return hasMessages ? (
  <button onClick={flush}>Send {stats?.size} pending messages</button>
) : null;
```

Both return `null`-ish values when the corresponding feature is disabled in the bridge config.
