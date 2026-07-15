/**
 * Host Rules config + React bindings for the playground.
 *
 * defineHostRules() and createHostHooks() are each called ONCE at module
 * scope; the returned hooks/gates close over this single engine instance
 * (same pattern as createBridgeHooks in ./bridge.ts).
 *
 * The version comes from `?hv=<version>` on the URL (versionFromQuery, the
 * zero-config default). This playground runs on the web platform, so the demo
 * config keys a few rules on `web` version to make the query param visibly
 * change the resolved state:
 *
 *   (no ?hv)   betaBanner: off   saveFlow: A
 *   ?hv=2      betaBanner: on    saveFlow: A
 *   ?hv=3      betaBanner: on    saveFlow: C
 *
 * Open the DevTools "Host" tab (Ctrl+Shift+B) and override the platform to
 * android/ios to watch the native-only capabilities light up.
 */
import { defineHostRules, versionFromQuery } from "nbridge";
import { createHostHooks } from "nbridge/react";

export const host = defineHostRules({
  version: versionFromQuery("hv"),

  capabilities: {
    // Native-only share sheet — try overriding the platform in DevTools.
    nativeShare: { android: ">=8.2", ios: true },
    // Rolled out to web + iframe hosts from v2 — drive with ?hv=2.
    betaBanner: { web: ">=2", iframe: ">=2" },
  },

  variants: {
    saveFlow: {
      rules: [
        { when: { platform: "web", version: ">=3" }, use: "C" },
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
  CapabilityGate,
  VariantSwitch,
} = createHostHooks(host);
