import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const bridge = { send } as unknown as IBridgeManager;
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
    expect(send).toHaveBeenCalledWith("shutdown", {});

    view.unmount();
  });
});
