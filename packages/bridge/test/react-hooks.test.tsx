import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeHooks } from "../src/react";
import { installAndroidBridge, receiveFromNative, until } from "./helpers";

type Hooks = ReturnType<typeof createBridgeHooks>;

let cleanup: Array<() => void> = [];

/**
 * Build a fresh hooks factory over a fake Android host. Each call creates an
 * independent bridge instance (as documented), so every test gets a clean one.
 */
function makeHooks(
  config?: NonNullable<Parameters<typeof createBridgeHooks>[0]>["config"],
  nativeOpts?: Parameters<typeof installAndroidBridge>[0],
): { hooks: Hooks; native: ReturnType<typeof installAndroidBridge> } {
  const native = installAndroidBridge(nativeOpts);
  const hooks = createBridgeHooks({ config });
  cleanup.push(() => {
    hooks.instance.destroy();
    native.uninstall();
  });
  return { hooks, native };
}

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

describe("useBridgeReady / useBridgeReadyState", () => {
  it("becomes ready after mount when handshake is disabled (SSR-safe: starts false)", async () => {
    const { hooks } = makeHooks();
    const { result } = renderHook(() => hooks.useBridgeReady());
    // First render is intentionally false so it matches server-rendered HTML;
    // it flips to ready after the mount effect resolves.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("surfaces the handshake timeout as an error instead of an unhandled rejection", async () => {
    const { hooks } = makeHooks({
      handshake: { enabled: true, timeout: 80, retryInterval: 40 },
    });
    const { result } = renderHook(() => hooks.useBridgeReadyState());

    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.ready).toBe(false);
    expect(result.current.error?.message).toMatch(/handshake/i);
  });

  it("flips to ready once the native side acks the handshake", async () => {
    const { hooks, native } = makeHooks({
      handshake: { enabled: true, retryInterval: 20 },
    });
    const { result } = renderHook(() => hooks.useBridgeReadyState());

    expect(result.current.ready).toBe(false);
    await until(() =>
      native.sent.some((m) => m.type === "__nbridge_handshake__"),
    );
    act(() => receiveFromNative({ type: "__nbridge_handshake_ack__" }));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
  });
});

describe("useBridgeMessage", () => {
  it("dispatches incoming messages to the handler with the latest closure", async () => {
    const { hooks } = makeHooks();
    const received: unknown[] = [];
    const { rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        hooks.useBridgeMessage("ping", (payload) => {
          received.push({ tag, payload });
        }),
      { initialProps: { tag: "first" } },
    );

    // Re-render with a new closure must NOT re-subscribe but must use the
    // latest handler (the ref-update behavior in useBridgeMessage).
    rerender({ tag: "second" });

    act(() => receiveFromNative({ type: "ping", payload: { n: 42 } }));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ tag: "second", payload: { n: 42 } });
  });

  it("stops delivering after the hook unmounts", async () => {
    const { hooks } = makeHooks();
    const received: unknown[] = [];
    const { unmount } = renderHook(() =>
      hooks.useBridgeMessage("tick", (p) => {
        received.push(p);
      }),
    );

    act(() => receiveFromNative({ type: "tick", payload: 1 }));
    await waitFor(() => expect(received).toHaveLength(1));

    unmount();
    act(() => receiveFromNative({ type: "tick", payload: 2 }));
    // Give any errant delivery a chance to land before asserting it didn't.
    await Promise.resolve();
    expect(received).toEqual([1]);
  });
});

describe("useBridgeRequest", () => {
  it("tracks loading, resolves data, and correlates the response by id", async () => {
    const { hooks, native } = makeHooks();
    const { result } = renderHook(() => hooks.useBridgeRequest("getUser"));

    expect(result.current.loading).toBe(false);

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.request({ id: "1" }, 2000);
    });
    expect(result.current.loading).toBe(true);

    await until(() => native.sent.length === 1);
    act(() =>
      receiveFromNative({
        type: "getUser_response",
        id: native.sent[0]?.id,
        payload: { name: "Mo" },
      }),
    );

    await act(async () => {
      await pending;
    });

    expect(result.current.data).toEqual({ name: "Mo" });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("captures a rejection (timeout) into error and clears loading", async () => {
    const { hooks } = makeHooks();
    const { result } = renderHook(() => hooks.useBridgeRequest("noAnswer"));

    await act(async () => {
      await result.current.request({}, 60);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/timed out/i);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe("useBridgeRPC", () => {
  it("correlates concurrent calls by message id and ignores foreign responses", async () => {
    const { hooks, native } = makeHooks();
    const { result } = renderHook(() =>
      hooks.useBridgeRPC<{ n: number }, string>("fetch"),
    );

    await act(async () => {
      await result.current.call({ n: 1 });
    });
    await act(async () => {
      await result.current.call({ n: 2 });
    });

    await until(() => native.sent.length === 2);
    const idA = native.sent[0]?.id;
    const idB = native.sent[1]?.id;
    expect(result.current.loading).toBe(true);

    // A response for an unknown id must be ignored (no state change).
    act(() =>
      receiveFromNative({
        type: "fetch_response",
        id: "not-a-pending-id",
        payload: "bogus",
      }),
    );
    expect(result.current.response).toBeNull();

    // Answer the FIRST call — one call still outstanding, so loading stays.
    act(() =>
      receiveFromNative({ type: "fetch_response", id: idA, payload: "A" }),
    );
    await waitFor(() => expect(result.current.response).toBe("A"));
    expect(result.current.loading).toBe(true);

    // Answer the SECOND call — now everything is settled.
    act(() =>
      receiveFromNative({ type: "fetch_response", id: idB, payload: "B" }),
    );
    await waitFor(() => expect(result.current.response).toBe("B"));
    expect(result.current.loading).toBe(false);
  });
});
