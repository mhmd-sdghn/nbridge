import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineHostRules,
  traitFromQuery,
  versionFromQuery,
  versionFromUserAgent,
} from "../src";
import { installAndroidBridge } from "./helpers";

const STORAGE_KEY = "nbridge:host-version";

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  vi.unstubAllGlobals();
  try {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  } catch {
    // ignore
  }
});

describe("capabilities", () => {
  it("resolves per-platform, absent key = false", () => {
    const host = defineHostRules({
      version: "8.5.0",
      capabilities: {
        nativeShare: { android: ">=8.2", ios: true },
        newHeader: { iframe: ">=2", web: true },
      },
    });

    // Default platform in jsdom (no bridge, not an iframe) is web.
    expect(host.info().platform).toBe("web");
    expect(host.supports("nativeShare")).toBe(false); // android/ios absent on web
    expect(host.supports("newHeader")).toBe(true); // web: true

    host.__setOverride({ platform: "android" });
    expect(host.supports("nativeShare")).toBe(true); // 8.5.0 >= 8.2
    expect(host.supports("newHeader")).toBe(false); // no android key -> false

    host.__setOverride({ platform: "iframe" });
    expect(host.supports("newHeader")).toBe(true); // iframe: >=2, and 8.5.0 >= 2
  });

  it("applies the `all` key as a fallback for unlisted platforms (finding 3.4)", () => {
    const host = defineHostRules({
      version: "8.5.0",
      capabilities: {
        // trait-free cross-platform capability without enumerating all four
        promo: { all: true, web: false },
        minVersion: { all: ">=8" },
      },
    });

    host.setOverride({ platform: "android" });
    expect(host.supports("promo")).toBe(true); // all: true
    expect(host.supports("minVersion")).toBe(true); // 8.5.0 >= 8

    host.setOverride({ platform: "web" });
    expect(host.supports("promo")).toBe(false); // explicit web:false overrides all
  });

  it("rejects an unknown platform key at config time (finding 3.4)", () => {
    expect(() =>
      defineHostRules({
        // @ts-expect-error typo'd platform key
        capabilities: { oops: { webb: true } },
      }),
    ).toThrow(/Unknown key "webb"/);
  });

  it("honors boolean literals regardless of version", () => {
    const host = defineHostRules({
      version: () => null, // unknown version
      capabilities: { always: { ios: true }, never: { ios: false } },
    });
    host.__setOverride({ platform: "ios" });
    expect(host.supports("always")).toBe(true);
    expect(host.supports("never")).toBe(false);
  });

  it("denies version-gated capabilities when the version is unknown/unparsable", () => {
    const host = defineHostRules({
      version: () => null,
      capabilities: { cam: { android: ">=9" } },
    });
    host.__setOverride({ platform: "android" });
    expect(host.supports("cam")).toBe(false);

    host.setVersion("abc"); // unparsable -> unknown
    expect(host.supports("cam")).toBe(false);

    host.setVersion("9.1.0");
    expect(host.supports("cam")).toBe(true);
  });

  it("detects Android from the bridge object (detection wins)", () => {
    const native = installAndroidBridge();
    cleanup.push(native.uninstall);

    const host = defineHostRules({
      version: "9.0.0",
      capabilities: { x: { android: true, web: false } },
    });

    expect(host.info().platform).toBe("android");
    expect(host.supports("x")).toBe(true);
  });

  it("treats an explicit `undefined` platform value as absent (off)", () => {
    const host = defineHostRules({
      version: "9.0.0",
      // `android: undefined` is equivalent to omitting the key — fail-safe off.
      capabilities: { flag: { android: undefined, ios: true } },
    });
    host.__setOverride({ platform: "android" });
    expect(host.supports("flag")).toBe(false);
    host.__setOverride({ platform: "ios" });
    expect(host.supports("flag")).toBe(true);
  });

  it("throws on an empty constraint array (no real gate)", () => {
    expect(() =>
      defineHostRules({ capabilities: { flag: { web: [] } } }),
    ).toThrow(/Invalid version constraint/);
  });
});

describe("variants", () => {
  const makeHost = () =>
    defineHostRules({
      version: "9.0.0",
      variants: {
        saveFlow: {
          rules: [
            { when: { platform: "ios" }, use: "B" },
            { when: { platform: "android", version: ">=9" }, use: "B" },
            { when: { platform: "iframe", version: [">=2", "<4"] }, use: "C" },
          ],
          default: "A",
        },
      },
    });

  it("returns the default when no rule matches", () => {
    const host = makeHost();
    expect(host.variant("saveFlow")).toBe("A"); // web
  });

  it("matches the first rule that fully matches (order matters)", () => {
    const host = makeHost();
    host.__setOverride({ platform: "ios" });
    expect(host.variant("saveFlow")).toBe("B");
  });

  it("requires the version constraint to pass on a version-gated rule", () => {
    const host = makeHost();
    host.__setOverride({ platform: "android" });
    host.setVersion("9.2.0");
    expect(host.variant("saveFlow")).toBe("B");

    host.setVersion("8.0.0"); // < 9 -> rule skipped -> default
    expect(host.variant("saveFlow")).toBe("A");
  });

  it("skips a version-gated rule when the version is unknown", () => {
    const host = makeHost();
    host.__setOverride({ platform: "iframe" });
    host.setVersion(""); // "" is unparsable -> unknown -> iframe rule skipped
    expect(host.variant("saveFlow")).toBe("A");

    host.setVersion("2.5.0"); // within [>=2, <4]
    expect(host.variant("saveFlow")).toBe("C");
  });

  it("throws on an empty constraint array in a variant rule", () => {
    expect(() =>
      defineHostRules({
        variants: {
          v: { rules: [{ when: { version: [] }, use: "B" }], default: "A" },
        },
      }),
    ).toThrow(/Invalid version constraint/);
  });
});

describe("select", () => {
  it("picks the per-platform value, falling back to default", () => {
    const host = defineHostRules({ version: "1.0.0" });
    expect(host.select({ ios: "x", default: "y" })).toBe("y"); // web
    host.__setOverride({ platform: "ios" });
    expect(host.select({ ios: "x", default: "y" })).toBe("x");
  });
});

describe("version sources", () => {
  it("uses a static string", () => {
    const host = defineHostRules({ version: "3.2.1" });
    expect(host.info().version).toBe("3.2.1");
  });

  it("uses a custom function", () => {
    const host = defineHostRules({ version: () => "4.5.6" });
    expect(host.info().version).toBe("4.5.6");
  });

  it("versionFromQuery reads the param and persists to sessionStorage", () => {
    window.history.replaceState(null, "", "?hv=5.5.0");
    const source = versionFromQuery("hv");
    expect(source()).toBe("5.5.0");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("5.5.0");
  });

  it("versionFromQuery falls back to stored value when the param is gone", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "6.0.0");
    window.history.replaceState(null, "", "/");
    const source = versionFromQuery("hv");
    expect(source()).toBe("6.0.0");
  });

  it("versionFromQuery swallows storage exceptions", () => {
    window.history.replaceState(null, "", "/");
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const source = versionFromQuery("hv");
    expect(source()).toBeNull();
  });

  it("versionFromUserAgent uses capture group 1", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 MyApp/4.5.6",
    );
    expect(versionFromUserAgent(/MyApp\/([\d.]+)/)()).toBe("4.5.6");
    expect(versionFromUserAgent(/Other\/([\d.]+)/)()).toBeNull();
  });
});

describe("setVersion / refresh / subscribe / override", () => {
  it("setVersion re-resolves and notifies subscribers", () => {
    const host = defineHostRules({ version: () => "1.0.0" });
    const listener = vi.fn();
    host.subscribe(listener);

    host.setVersion("9.9.9");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.info().version).toBe("9.9.9");
  });

  it("explicit version beats the source and persists across refresh", () => {
    let sourceValue = "1.0.0";
    const host = defineHostRules({ version: () => sourceValue });
    host.setVersion("9.9.9");
    sourceValue = "2.0.0";
    host.refresh();
    expect(host.info().version).toBe("9.9.9"); // explicit persists
  });

  it("setVersion(null) clears the explicit value; refresh falls back to source", () => {
    let sourceValue = "1.0.0";
    const host = defineHostRules({ version: () => sourceValue });
    host.setVersion("9.9.9");
    host.setVersion(null);
    sourceValue = "2.0.0";
    host.refresh();
    expect(host.info().version).toBe("2.0.0");
  });

  it("unsubscribe stops notifications", () => {
    const host = defineHostRules({ version: "1.0.0" });
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    unsubscribe();
    host.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it("__setOverride round-trips platform and version, and null resets", () => {
    const native = installAndroidBridge();
    cleanup.push(native.uninstall);

    const host = defineHostRules({ version: "9.0.0" });
    expect(host.info().platform).toBe("android");

    host.__setOverride({ platform: "ios", version: "1.2.3" });
    expect(host.info().platform).toBe("ios");
    expect(host.info().version).toBe("1.2.3");

    host.__setOverride(null);
    expect(host.info().platform).toBe("android");
    expect(host.info().version).toBe("9.0.0");
  });
});

describe("platform source (3.9)", () => {
  it("defers to a supplied platform detect function", () => {
    const host = defineHostRules({
      platform: { detect: () => "ios" },
      capabilities: { nativeShare: { ios: true } },
    });
    // jsdom would detect "web", but the supplied source forces "ios".
    expect(host.info().platform).toBe("ios");
    expect(host.supports("nativeShare")).toBe(true);
  });

  it("accepts a BridgeManager-like object with getPlatform()", () => {
    const fakeBridge = {
      getPlatform: () => ({ platform: "android" as const }),
    };
    const host = defineHostRules({
      platform: { detect: fakeBridge },
      capabilities: { cam: { android: true } },
    });
    expect(host.info().platform).toBe("android");
    expect(host.supports("cam")).toBe(true);
  });
});

describe("SSR (window absent)", () => {
  it("resolves to web / null version", () => {
    vi.stubGlobal("window", undefined);
    const host = defineHostRules({
      version: "9.0.0",
      capabilities: { x: { web: true, android: ">=1" } },
    });
    expect(host.info().platform).toBe("web");
    expect(host.info().version).toBeNull();
    expect(host.supports("x")).toBe(true); // web: true works with unknown version
  });
});

describe("__serverSnapshot (hydration consistency)", () => {
  it("is the conservative web/null view even when the client resolves a version", () => {
    // Simulate the client: a query version is present, so the LIVE engine
    // resolves web@3 → betaBanner on, saveFlow C.
    window.history.replaceState(null, "", "?hv=3");
    const host = defineHostRules({
      version: versionFromQuery("hv"),
      capabilities: {
        betaBanner: { web: ">=2" },
        alwaysWeb: { web: true },
      },
      variants: {
        saveFlow: {
          rules: [{ when: { platform: "web", version: ">=3" }, use: "C" }],
          default: "A",
        },
      },
    });

    // Live client resolution.
    expect(host.supports("betaBanner")).toBe(true);
    expect(host.variant("saveFlow")).toBe("C");

    // The server snapshot ignores the client version — it is what SSR rendered
    // (web, version unknown), so hydration reads the same values the server did.
    const snap = host.__serverSnapshot();
    expect(snap.info.platform).toBe("web");
    expect(snap.info.version).toBeNull();
    expect(snap.supports.betaBanner).toBe(false); // version-gated → denied when unknown
    expect(snap.supports.alwaysWeb).toBe(true); // boolean literal survives
    expect(snap.variants.saveFlow).toBe("A"); // version-gated rule skipped → default
  });

  it("returns a stable identity (no getSnapshot loop)", () => {
    const host = defineHostRules({ capabilities: { x: { web: true } } });
    expect(host.__serverSnapshot()).toBe(host.__serverSnapshot());
  });
});

describe("traits", () => {
  it("selects a variant by trait value, including one-of arrays", () => {
    const host = defineHostRules({
      traits: { mk: () => null },
      variants: {
        channel: {
          rules: [
            { when: { traits: { mk: "google" } }, use: "G" },
            { when: { traits: { mk: ["bing", "duck"] } }, use: "B" },
          ],
          default: "D",
        },
      },
    });

    expect(host.variant("channel")).toBe("D"); // unknown mk -> default
    host.setTrait("mk", "google");
    expect(host.variant("channel")).toBe("G");
    host.setTrait("mk", "duck");
    expect(host.variant("channel")).toBe("B"); // one-of
    host.setTrait("mk", "other");
    expect(host.variant("channel")).toBe("D"); // no rule matches
  });

  it("gates a capability with a `when` clause (ANDed on top of platform)", () => {
    const host = defineHostRules({
      traits: { mk: () => null },
      capabilities: {
        promo: { web: true, when: { traits: { mk: "google" } } },
      },
    });

    // Default platform is web, but the trait gate fails while mk is unknown.
    expect(host.supports("promo")).toBe(false);
    host.setTrait("mk", "google");
    expect(host.supports("promo")).toBe(true);
    host.setTrait("mk", "bing");
    expect(host.supports("promo")).toBe(false);
  });

  it("a `when` gate never enables an unlisted platform", () => {
    const host = defineHostRules({
      traits: { mk: () => null },
      capabilities: {
        promo: { web: true, when: { traits: { mk: "google" } } },
      },
    });
    // android is not listed; the matching trait cannot turn it on.
    host.__setOverride({ platform: "android", traits: { mk: "google" } });
    expect(host.supports("promo")).toBe(false);
  });

  it("combines platform and trait conditions with AND", () => {
    const host = defineHostRules({
      traits: { mk: () => null },
      variants: {
        f: {
          rules: [
            { when: { platform: "ios", traits: { mk: "google" } }, use: "X" },
          ],
          default: "D",
        },
      },
    });

    host.__setOverride({ platform: "ios", traits: { mk: "google" } });
    expect(host.variant("f")).toBe("X");
    host.__setOverride({ platform: "ios", traits: { mk: "bing" } });
    expect(host.variant("f")).toBe("D"); // trait mismatch
    host.__setOverride({ platform: "web", traits: { mk: "google" } });
    expect(host.variant("f")).toBe("D"); // platform mismatch
  });

  it("setTrait persists across refresh; null clears back to the source", () => {
    let source = "a";
    const host = defineHostRules({ traits: { mk: () => source } });
    host.setTrait("mk", "b");
    source = "c";
    host.refresh();
    expect(host.info().traits.mk).toBe("b"); // explicit beats source
    host.setTrait("mk", null);
    host.refresh();
    expect(host.info().traits.mk).toBe("c"); // fell back to source
  });

  it("setTrait re-resolves and notifies subscribers", () => {
    const host = defineHostRules({ traits: { mk: () => null } });
    const listener = vi.fn();
    host.subscribe(listener);
    host.setTrait("mk", "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.info().traits.mk).toBe("x");
  });

  it("a rule with only `traits` is valid (no empty-when throw)", () => {
    expect(() =>
      defineHostRules({
        traits: { mk: () => null },
        variants: {
          channel: {
            rules: [{ when: { traits: { mk: "g" } }, use: "G" }],
            default: "D",
          },
        },
      }),
    ).not.toThrow();
  });

  it("traitFromQuery reads the param and persists to sessionStorage", () => {
    window.history.replaceState(null, "", "?mk=google");
    const host = defineHostRules({ traits: { mk: traitFromQuery("mk") } });
    expect(host.info().traits.mk).toBe("google");
    expect(window.sessionStorage.getItem("nbridge:trait:mk")).toBe("google");
  });

  it("traitFromQuery falls back to storage; { persist: false } does not", () => {
    window.sessionStorage.setItem("nbridge:trait:mk", "bing");
    window.history.replaceState(null, "", "/");
    expect(
      defineHostRules({ traits: { mk: traitFromQuery("mk") } }).info().traits
        .mk,
    ).toBe("bing");
    expect(
      defineHostRules({
        traits: { mk: traitFromQuery("mk", { persist: false }) },
      }).info().traits.mk,
    ).toBeNull();
  });

  it("__introspect reports traits with any declared values", () => {
    const host = defineHostRules({
      traits: {
        mk: { source: () => null, values: ["google", "bing"] as const },
        tenant: () => null,
      },
    });
    expect(host.__introspect().traits).toEqual([
      { name: "mk", values: ["google", "bing"] },
      { name: "tenant", values: undefined },
    ]);
  });

  it("traits are unknown on the server, so trait-gated rules are conservative", () => {
    vi.stubGlobal("window", undefined);
    const host = defineHostRules({
      traits: { mk: () => "google" },
      capabilities: {
        promo: { web: true, when: { traits: { mk: "google" } } },
      },
      variants: {
        channel: {
          rules: [{ when: { traits: { mk: "google" } }, use: "G" }],
          default: "D",
        },
      },
    });
    expect(host.info().traits.mk).toBeNull();
    expect(host.supports("promo")).toBe(false);
    expect(host.variant("channel")).toBe("D");
  });

  it("__serverSnapshot ignores client trait values", () => {
    const host = defineHostRules({
      traits: { mk: () => null },
      capabilities: {
        promo: { web: true, when: { traits: { mk: "google" } } },
      },
      variants: {
        channel: {
          rules: [{ when: { traits: { mk: "google" } }, use: "G" }],
          default: "D",
        },
      },
    });
    host.setTrait("mk", "google");
    expect(host.supports("promo")).toBe(true);

    const snap = host.__serverSnapshot();
    expect(snap.supports.promo).toBe(false);
    expect(snap.variants.channel).toBe("D");
    expect(snap.info.traits.mk).toBeNull();
  });
});
