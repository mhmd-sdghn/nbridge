/**
 * Host Rules config + React bindings for the playground.
 *
 * defineHostRules() and createHostHooks() are each called ONCE at module
 * scope; the returned hooks/gates close over this single engine instance
 * (same pattern as createBridgeHooks in ./bridge.ts).
 *
 * The version comes from `?hv=<version>` on the URL (versionFromQuery, the
 * zero-config default), and a `mk` trait comes from `?mk=<channel>`. This
 * playground runs on the web platform, so the demo keys rules on `web` version
 * and on the trait to make both query params visibly change the resolved state:
 *
 *   (no ?hv)     betaBanner: off   saveFlow: A
 *   ?hv=2        betaBanner: on    saveFlow: A
 *   ?hv=3        betaBanner: on    saveFlow: C
 *   ?mk=google   promoBanner: on
 *   ?mk=bing     saveFlow: B
 *
 * Open the DevTools "Host" tab (Ctrl+Shift+B) to override the platform (watch
 * the native-only capabilities light up) or the `mk` trait from a dropdown.
 */
import { defineHostRules, traitFromQuery, versionFromQuery } from "nbridge";
import { createHostHooks } from "nbridge/react";

export const host = defineHostRules({
  version: versionFromQuery("hv"),

  traits: {
    // Marketing channel from ?mk=. `values` makes it a typed enum + a DevTools
    // dropdown; a typo in a rule below would be a compile error.
    mk: { source: traitFromQuery("mk"), values: ["google", "bing"] as const },
  },

  capabilities: {
    // Native-only share sheet — try overriding the platform in DevTools.
    nativeShare: { android: ">=8.2", ios: true },
    // Rolled out to web + iframe hosts from v2 — drive with ?hv=2.
    betaBanner: { web: ">=2", iframe: ">=2" },
    // A web feature gated on the marketing channel — drive with ?mk=google.
    promoBanner: { web: true, when: { traits: { mk: "google" } } },
  },

  variants: {
    saveFlow: {
      rules: [
        { when: { platform: "web", version: ">=3" }, use: "C" },
        { when: { traits: { mk: "bing" } }, use: "B" }, // ?mk=bing
        { when: { platform: "ios" }, use: "B" },
        { when: { platform: "android", version: ">=9" }, use: "B" },
      ],
      default: "A",
    },
  },
});

export const {
  useHostInfo,
  useCapability,
  useVariant,
  useTrait,
  CapabilityGate,
  VariantSwitch,
} = createHostHooks(host);
