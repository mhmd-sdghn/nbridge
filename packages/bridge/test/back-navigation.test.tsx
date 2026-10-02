import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeBackAction } from "../src/constants/backAction";
import { createBridgeBackNavigation } from "../src/next/createBridgeBackNavigation";
import { BackInterceptManager } from "../src/next/navigation/BackInterceptManager";
import { useBackIntercept } from "../src/next/navigation/useBackIntercept";
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

describe("BackInterceptManager path matching", () => {
  const manager = () => BackInterceptManager.getInstance();
  const go = (url: string) => window.history.pushState({}, "", url);

  // An app served under `basePath: "/add-point"` with `trailingSlash: true`:
  // usePathname() reports "/point-info-form/" while the browser is at
  // "/add-point/point-info-form/".
  const onFormUnderBasePath = () => {
    manager().configure({ basePath: "/add-point" });
    go("/add-point/options/");
    go("/add-point/point-info-form/");
  };

  it.each([
    "/point-info-form/",
    "/point-info-form",
    "point-info-form",
  ])("matches %j exactly against the app path under a basePath", async (path) => {
    onFormUnderBasePath();
    const onBack = vi.fn();
    manager().register(onBack, path, true);
    await flushHistory();

    window.history.back();
    await flushHistory();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/add-point/point-info-form/");
  });

  it("does not match a string path by suffix", async () => {
    manager().configure({ basePath: "/add-point" });
    go("/add-point/options/");
    go("/add-point/nested/point-info-form/");
    const onBack = vi.fn();
    manager().register(onBack, "/point-info-form", true);
    await flushHistory();

    window.history.back();
    await flushHistory(); // the press lands under the trap
    await flushHistory(); // the manager completes the back

    expect(onBack).not.toHaveBeenCalled();
    // The press is not swallowed: the user leaves the page in one press.
    expect(window.location.pathname).toBe("/add-point/options/");
  });

  it("matches a RegExp against the app path", async () => {
    manager().configure({ basePath: "/add-point" });
    go("/add-point/options/");
    go("/add-point/work-hours/");
    const onBack = vi.fn();
    manager().register(onBack, /^\/work-hours\/?$/, true);
    await flushHistory();

    window.history.back();
    await flushHistory();

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not fire a RegExp that does not match the app path", async () => {
    onFormUnderBasePath();
    const onBack = vi.fn();
    manager().register(onBack, /^\/work-hours/, true);
    await flushHistory();

    window.history.back();
    await flushHistory(); // the press lands under the trap
    await flushHistory(); // the manager completes the back

    expect(onBack).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/add-point/options/");
  });

  it("matches the full pathname when no basePath is configured", async () => {
    go("/a/");
    go("/b/");
    const onBack = vi.fn();
    manager().register(onBack, "/b", true);
    await flushHistory();

    window.history.back();
    await flushHistory();

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("useBackIntercept with a RegExp path", () => {
  it("does not re-register when an inline regex literal re-renders", () => {
    const register = vi.spyOn(BackInterceptManager.getInstance(), "register");
    function Screen({ tick }: { tick: number }) {
      useBackIntercept(() => {}, /^\/work-hours/);
      return <span>{tick}</span>;
    }

    const view = render(<Screen tick={0} />);
    view.rerender(<Screen tick={1} />);
    view.rerender(<Screen tick={2} />);

    expect(register).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe("BackInterceptManager trap bookkeeping", () => {
  const manager = () => BackInterceptManager.getInstance();
  const go = (url: string) => window.history.pushState({}, "", url);

  it("skips a trap left behind on a page the user moved on from", async () => {
    go("/options/");
    go("/form/");
    const id = manager().register(vi.fn(), "/form", true); // trap on /form/
    await flushHistory();
    go("/rewards/"); // the user moves on
    manager().unregister(id); // the form unmounts
    await flushHistory();

    window.history.back(); // rewards → form (lands on the leftover trap)
    await flushHistory();
    await flushHistory(); // the manager steps past the trap
    expect(window.location.pathname).toBe("/form/");
    expect(window.history.state?.__backInterceptTrap).toBeFalsy();

    window.history.back(); // must leave the form, not stay on its duplicate
    await flushHistory();
    expect(window.location.pathname).toBe("/options/");
  });

  it("does not fire on a forward press", async () => {
    go("/a/");
    const onBack = vi.fn();
    manager().register(onBack, "*", true); // trap on /a/
    await flushHistory();
    go("/b/");

    window.history.back(); // onto the /a/ trap entry — swallowed
    await flushHistory();
    window.history.forward(); // back to /b/
    await flushHistory();

    expect(onBack).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/b/");
  });
});

describe("routerBackOrShutdown with an intercept trap on top", () => {
  it("leaves the page in one call instead of only popping the trap", async () => {
    window.history.pushState({}, "", "/list/");
    window.history.pushState({}, "", "/detail/");
    BackInterceptManager.getInstance().register(vi.fn(), "/detail", true);
    await flushHistory();

    const bridge = {
      send: vi.fn().mockResolvedValue(undefined),
      flushBatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as IBridgeManager;
    const { useBridgeBack } = createBridgeBackNavigation(bridge);

    let goBack: (() => Promise<void>) | undefined;
    function Screen() {
      const { routerBackOrShutdown } = useBridgeBack({ mode: "browser" });
      goBack = () => routerBackOrShutdown(BridgeBackAction.RouterBack);
      return null;
    }

    const view = render(<Screen />);
    await flushHistory();
    await goBack?.();
    await flushHistory();

    expect(window.location.pathname).toBe("/list/");

    view.unmount();
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
