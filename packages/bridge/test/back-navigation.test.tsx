import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeBackAction } from "../src/constants/backAction";
import { createBridgeBackNavigation } from "../src/next/createBridgeBackNavigation";
import { BackInterceptManager } from "../src/next/navigation/BackInterceptManager";
import { setupBackInterception } from "../src/next/navigation/utils";
import type { IBridgeManager } from "../src/types";
import { wait } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  usePathname: () => "/success",
}));

/** Let queued history traversals (async popstate) land. */
const flushHistory = () => wait(20);

afterEach(async () => {
  BackInterceptManager.getInstance().resetForTests();
  await flushHistory(); // drain in-flight pops with no listener attached
  window.history.pushState(null, "", "/"); // fresh entry with clean state
});

describe("BackInterceptManager trap lifecycle", () => {
  it("does not misfire when an intercept is removed and re-registered in the same tick (StrictMode remount)", async () => {
    const onBack = vi.fn();
    const strictModeCleanup = setupBackInterception(onBack); // effect runs
    strictModeCleanup(); // dev-only cleanup runs immediately
    setupBackInterception(onBack); // effect re-runs
    await flushHistory(); // the manager's own trap-release back() lands

    expect(onBack).not.toHaveBeenCalled();

    // A real user back press must still be intercepted afterwards.
    window.history.back();
    await flushHistory();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires the one-shot intercept once and lets later back presses through", async () => {
    const onBack = vi.fn();
    setupBackInterception(onBack);
    await flushHistory();

    window.history.back();
    await flushHistory();
    expect(onBack).toHaveBeenCalledTimes(1);

    window.history.back();
    await flushHistory();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("releases the trap silently when the last intercept is unregistered", async () => {
    const onBack = vi.fn();
    const cleanup = setupBackInterception(onBack);
    await flushHistory();

    cleanup();
    await flushHistory();

    expect(onBack).not.toHaveBeenCalled();
    expect(window.history.state?.__backInterceptTrap).toBeFalsy();
  });

  it("re-registers cleanly after full teardown (stale self-pop never swallows a real back press)", async () => {
    const first = vi.fn();
    const cleanup = setupBackInterception(first);
    cleanup();
    await flushHistory(); // trap-release back() lands while no listener is attached

    const second = vi.fn();
    setupBackInterception(second);
    await flushHistory();

    window.history.back();
    await flushHistory();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("survives unregister/register churn across ticks without firing or navigating away", async () => {
    window.history.pushState(null, "", "/page-a");
    const onBack = vi.fn();
    let cleanup = setupBackInterception(onBack);
    for (let i = 0; i < 3; i++) {
      cleanup();
      cleanup = setupBackInterception(onBack);
      await wait(0); // interleave with in-flight trap-release pops
    }
    await flushHistory();

    expect(onBack).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/page-a");

    window.history.back();
    await flushHistory();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("useBridgeBack force-shutdown effect under StrictMode", () => {
  it("arms on mount with [] deps without instantly sending shutdown, then fires on a real back press", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const flushBatch = vi.fn().mockResolvedValue(undefined);
    const bridge = { send, flushBatch } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    function SuccessScreen() {
      const {
        forceBrowserBackToShutdownApp,
        removeForceBrowserBackToShutdownApp,
      } = useBridgeBack();

      // biome-ignore lint/correctness/useExhaustiveDependencies: the documented usage — must be safe with [] deps
      useEffect(() => {
        forceBrowserBackToShutdownApp();
        return removeForceBrowserBackToShutdownApp;
      }, []);

      return null;
    }

    const view = render(
      <StrictMode>
        <SuccessScreen />
      </StrictMode>,
    );
    await flushHistory();

    // StrictMode's mount → cleanup → remount cycle must not trigger shutdown.
    expect(send).not.toHaveBeenCalled();

    window.history.back();
    await flushHistory();
    expect(send).toHaveBeenCalledTimes(1);
    // `immediate` keeps a shutdown off the batcher and the retry queue: the
    // host tears the WebView down, so a parked copy would either never arrive
    // or arrive in a later session and close the app out from under the user.
    expect(send).toHaveBeenCalledWith("shutdown", {}, { immediate: true });

    view.unmount();
  });

  it("sends one shutdown when back is tapped twice in a row", async () => {
    // The router branch has always had `backInFlightRef`; the shutdown branch
    // had no equivalent, so two rapid taps sent two shutdowns.
    let resolveSend: () => void = () => {};
    const send = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
    );
    const flushBatch = vi.fn().mockResolvedValue(undefined);
    const bridge = { send, flushBatch } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    let shutdown: (() => Promise<void>) | undefined;
    function Screen() {
      const { routerBackOrShutdown } = useBridgeBack({ mode: "browser" });
      shutdown = () => routerBackOrShutdown(BridgeBackAction.AppShutdown);
      return null;
    }

    const view = render(<Screen />);
    await flushHistory();

    // Two taps before the first send settles.
    const first = shutdown?.();
    const second = shutdown?.();
    resolveSend();
    await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it("still sends on a later tap after a successful shutdown", async () => {
    // A delivered shutdown does not mean the host closed anything — it may
    // prompt and let the user cancel, or ignore the type entirely. Latching the
    // in-flight guard on success would leave back dead for the whole session.
    const send = vi.fn().mockResolvedValue(undefined);
    const flushBatch = vi.fn().mockResolvedValue(undefined);
    const bridge = { send, flushBatch } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    let shutdown: (() => Promise<void>) | undefined;
    function Screen() {
      const { routerBackOrShutdown } = useBridgeBack({ mode: "browser" });
      shutdown = () => routerBackOrShutdown(BridgeBackAction.AppShutdown);
      return null;
    }

    const view = render(<Screen />);
    await flushHistory();

    await shutdown?.();
    expect(send).toHaveBeenCalledTimes(1);

    // Host declined to close; the user taps again.
    await shutdown?.();
    expect(send).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it("flushes pending batched messages before the shutdown overtakes them", async () => {
    // `immediate` bypasses the batcher, so anything still waiting there would be
    // lost when the host tears the WebView down.
    const order: string[] = [];
    const send = vi.fn().mockImplementation(async () => {
      order.push("send");
    });
    const flushBatch = vi.fn().mockImplementation(async () => {
      order.push("flushBatch");
    });
    const bridge = { send, flushBatch } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    let shutdown: (() => Promise<void>) | undefined;
    function Screen() {
      const { routerBackOrShutdown } = useBridgeBack({ mode: "browser" });
      shutdown = () => routerBackOrShutdown(BridgeBackAction.AppShutdown);
      return null;
    }

    const view = render(<Screen />);
    await flushHistory();
    await shutdown?.();

    expect(order).toEqual(["flushBatch", "send"]);

    view.unmount();
  });

  it("sends the shutdown even when flushing the batch fails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const flushBatch = vi.fn().mockRejectedValue(new Error("batch failed"));
    const bridge = { send, flushBatch } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    let shutdown: (() => Promise<void>) | undefined;
    function Screen() {
      const { routerBackOrShutdown } = useBridgeBack({ mode: "browser" });
      shutdown = () => routerBackOrShutdown(BridgeBackAction.AppShutdown);
      return null;
    }

    const view = render(<Screen />);
    await flushHistory();
    await shutdown?.();

    // A failed batch is not a reason to keep the app open.
    expect(send).toHaveBeenCalledWith("shutdown", {}, { immediate: true });

    view.unmount();
  });
});
