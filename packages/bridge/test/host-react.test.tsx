import { act, render, renderHook, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { defineHostRules } from "../src";
import { createHostHooks } from "../src/react";

function makeHooks() {
  const host = defineHostRules({
    version: "9.0.0",
    capabilities: { share: { android: true, web: false } },
    variants: {
      flow: {
        rules: [{ when: { platform: "android" }, use: "B" }],
        default: "A",
      },
    },
  });
  return { host, hooks: createHostHooks(host) };
}

afterEach(() => {
  // Each test builds its own engine; nothing global to reset.
});

describe("hooks render resolved values", () => {
  it("useHostInfo / useCapability / useVariant reflect resolution", () => {
    const { hooks } = makeHooks();
    const { result } = renderHook(() => ({
      info: hooks.useHostInfo(),
      share: hooks.useCapability("share"),
      flow: hooks.useVariant("flow"),
    }));

    expect(result.current.info.platform).toBe("web");
    expect(result.current.share).toBe(false);
    expect(result.current.flow).toBe("A");
  });

  it("re-render on __setOverride (proves subscribe wiring)", () => {
    const { host, hooks } = makeHooks();
    const { result } = renderHook(() => hooks.useCapability("share"));

    expect(result.current).toBe(false);
    act(() => host.__setOverride({ platform: "android" }));
    expect(result.current).toBe(true);
  });
});

describe("gate components", () => {
  it("CapabilityGate shows children when enabled, fallback otherwise", () => {
    const { host, hooks } = makeHooks();
    const { CapabilityGate } = hooks;

    render(
      <CapabilityGate capability="share" fallback={<span>fallback</span>}>
        <span>enabled</span>
      </CapabilityGate>,
    );

    expect(screen.getByText("fallback")).toBeDefined();
    act(() => host.__setOverride({ platform: "android" }));
    expect(screen.getByText("enabled")).toBeDefined();
  });

  it("PlatformOnly shows/hides by platform", () => {
    const { host, hooks } = makeHooks();
    const { PlatformOnly } = hooks;

    render(
      <PlatformOnly
        platforms={["android", "ios"]}
        fallback={<span>web-ui</span>}
      >
        <span>native-ui</span>
      </PlatformOnly>,
    );

    expect(screen.getByText("web-ui")).toBeDefined();
    act(() => host.__setOverride({ platform: "ios" }));
    expect(screen.getByText("native-ui")).toBeDefined();
  });

  it("VariantSwitch picks the matching case, else fallback", () => {
    const { host, hooks } = makeHooks();
    const { VariantSwitch } = hooks;

    render(
      <VariantSwitch
        name="flow"
        cases={{ B: <span>flow-b</span> }}
        fallback={<span>flow-fallback</span>}
      />,
    );

    // web -> default "A", no case for A -> fallback
    expect(screen.getByText("flow-fallback")).toBeDefined();
    act(() => host.__setOverride({ platform: "android" }));
    expect(screen.getByText("flow-b")).toBeDefined();
  });
});

describe("useTrait", () => {
  it("reflects the resolved trait and re-renders on setTrait", () => {
    const host = defineHostRules({ traits: { mk: () => null } });
    const { useTrait } = createHostHooks(host);
    const { result } = renderHook(() => useTrait("mk"));

    expect(result.current).toBeNull();
    act(() => host.setTrait("mk", "google"));
    expect(result.current).toBe("google");
  });
});

describe("snapshot stability", () => {
  it("does not cause a re-render storm (getSnapshot is cached)", () => {
    const { hooks } = makeHooks();
    const renderCount = { current: 0 };

    function Probe() {
      const counter = useRef(0);
      counter.current += 1;
      renderCount.current = counter.current;
      const info = hooks.useHostInfo();
      return <span>{info.platform}</span>;
    }

    render(<Probe />);
    // A stable snapshot ref means React commits once (StrictMode may double it,
    // but it must not loop). Anything beyond a small constant is a storm.
    expect(renderCount.current).toBeLessThanOrEqual(2);
    expect(screen.getByText("web")).toBeDefined();
  });
});
