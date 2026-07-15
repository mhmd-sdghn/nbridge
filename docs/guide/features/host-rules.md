# Host Rules

Host Rules lets you decide UI and logic from the host your app runs in: its **platform** (Android WebView, iOS WKWebView, iframe, or plain web) and its **version**. Show a button only where it works, swap a whole save flow on iOS, hide a feature on old Android, all keyed on the platform, the version, or both.

You describe those differences once, in a single config file, as **capabilities** (is a feature available here?) and **variants** (which of several options here?). Everywhere else you just ask `host.supports("nativeShare")` or `host.variant("saveFlow")`. Platform names and version numbers stay in that one file instead of leaking into `if (platform === "ios")` checks scattered across your components.

The engine is synchronous, needs no network, and is independent of the messaging bridge, so importing the config on a server is safe.

## Capabilities vs variants

|  | Capability | Variant |
| --- | --- | --- |
| Answers | "is this feature available here?" | "which of several options here?" |
| Shape | a boolean per platform | ordered rules that resolve to a string |
| You call | `host.supports("nativeShare")` | `host.variant("saveFlow")` |

Use a **capability** for an on/off feature (does this host have a native share sheet?). Use a **variant** to choose between concrete alternatives (which save flow does this host get?).

One thing worth stating up front: capabilities are **off by default**. A platform you do not list resolves to `false`, so you only write down the hosts where a feature is on. (If a feature were on everywhere, you would not gate it at all.) When you want the opposite, "everyone gets X unless I say otherwise", reach for a variant instead: its `default` is what everyone gets, and the rules are the exceptions.

## 1. Define the rules

Call `defineHostRules` once, in a single file per app.

```ts
// src/lib/host-rules.ts
import { defineHostRules, versionFromQuery } from "nbridge";

export const host = defineHostRules({
  // Where the host version comes from. This is the default, shown explicitly.
  version: versionFromQuery("hv"),

  // Boolean features. Each platform maps to true/false or a version constraint.
  // A platform you omit is false there.
  capabilities: {
    nativeShare: { android: ">=8.2", ios: true }, // iframe and web omitted, so false
    newHeader: { iframe: ">=2", web: true },
  },

  // Pick-one choices. Rules run top to bottom, first match wins, `default` is required.
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
```

Malformed version constraints and empty `when: {}` clauses throw right here, at startup, not silently later during evaluation.

## 2. Read the rules (plain JS or TS)

Without a framework you call the engine directly, and if the version can change, re-run your render when it does.

::: code-group

```js [JavaScript]
import { host } from "./host-rules.js";

const shareBtn = document.querySelector("#share");
const saveBtn = document.querySelector("#save");

function render() {
  shareBtn.hidden = !host.supports("nativeShare");
  saveBtn.dataset.flow = host.variant("saveFlow"); // "A", "B", or "C"
}

// Re-run when the version arrives late or a dev override changes it.
host.subscribe(render);
render();
```

```ts [TypeScript]
import { host } from "./host-rules";

host.supports("nativeShare"); // boolean. "nativShare" is a compile error.
host.variant("saveFlow");     // typed union: "A" | "B" | "C"

// Pick one value per platform, with a required fallback.
const shareLabel = host.select({ ios: "Share", default: "Copy link" });
```

:::

The two examples are the same calls. TypeScript adds compile-time safety: capability and variant names are checked, and `variant()` returns the exact union of its values.

For a flow that differs a lot between hosts, resolve a strategy object once instead of scattering `variant()` calls:

```ts
const flows = { A: mvpSaveFlow, B: nativeSaveFlow, C: iframeSaveFlow };
const saveFlow = flows[host.variant("saveFlow")]; // choose once, use everywhere
```

## 3. Read the rules in React

`nbridge/react` turns the engine into hooks and components. Create them once, next to the engine:

```ts
// src/lib/host-hooks.ts
import { createHostHooks } from "nbridge/react";
import { host } from "./host-rules";

export const {
  useHostInfo,
  useCapability,
  useVariant,
  CapabilityGate,
  PlatformOnly,
  VariantSwitch,
} = createHostHooks(host);
```

Then gate UI declaratively:

```tsx
import { CapabilityGate, VariantSwitch } from "@/lib/host-hooks";

<CapabilityGate capability="nativeShare" fallback={<CopyLinkButton />}>
  <NativeShareButton />
</CapabilityGate>

<VariantSwitch name="saveFlow" cases={{ A: <FlowA />, B: <FlowB />, C: <FlowC /> }} />;
```

The hooks are reactive: when the version arrives asynchronously or a dev override is applied, gated UI re-renders on its own. There is no provider or context. Like `createBridgeHooks`, the factory closes over the single engine instance, so call it once and import the results everywhere.

## 4. Read the rules in Next.js

The hooks behave the same in the App Router, with two things to keep in mind.

The hooks are client-only, so call them from a Client Component:

```tsx
"use client";

import { useCapability } from "@/lib/host-hooks";

export function ShareButton() {
  return useCapability("nativeShare") ? <NativeShareButton /> : <CopyLinkButton />;
}
```

The engine itself is safe to import anywhere, including Server Components. On the server there is no `window`, so it resolves conservatively: platform `"web"`, version unknown. That is also what the client renders on its first paint, so hydration always matches the server markup. After the page mounts, the client re-resolves to the real host and updates. On an SSR page you may therefore see a brief flash of the conservative UI before the host-specific UI appears. For a flash-sensitive spot, render it only after mount, or pass the platform to the server through the URL.

## Where the version comes from

The platform is always detected from the bridge (an Android bridge object present means `android`, and so on). The version is up to you, because nBridge does not assume where your host keeps it. Supply it one of four ways:

```ts
version: "9.2.0"                                 // a static string you already know
version: versionFromQuery("hv")                  // ?hv= in the URL, remembered in sessionStorage (default)
version: versionFromUserAgent(/MyApp\/([\d.]+)/) // capture group 1 of the user agent
version: () => window.__APP_VERSION__ ?? null    // any custom function returning string or null
```

`versionFromQuery("hv")` is the default and the recommended convention: the host appends `?hv=<version>` to the WebView or iframe URL. The value is saved to `sessionStorage`, so it survives client-side navigation that drops the query param. A fresh param always beats the saved value.

### When the version arrives after load

Sometimes the version comes in later, for example over a bridge message. Configure nothing special and push it when it lands:

```ts
bridge.on("hostInfo", ({ version }) => host.setVersion(version));
```

Until that happens the version is `null`, so version-gated features stay off and version-gated variant rules are skipped (see the next section). When the value arrives, subscribers re-render and the gated UI appears. "Unknown means oldest host" doubles as the loading state, so there is no separate ready flag to manage.

`setVersion(v)` beats the configured source and survives `refresh()`. `setVersion(null)` clears it, so the next `refresh()` falls back to the source.

## Unknown version is conservative

If a rule needs a version and the host gave none (or something unparsable), the rule does not match: the capability is denied and the variant rule is skipped, so `default` wins. A capability set to plain `true` (no version needed) still passes. This is deliberate. nBridge never turns on a version-gated feature for a host it cannot confirm.

## Preview any host in DevTools

Pass the engine to the [DevTools](/guide/devtools) panel to get a **Host** tab. It shows the resolved platform, the raw and parsed version, and every capability and variant with its current value:

```tsx
<DevToolsUI bridge={instance} host={host} />
```

The tab's controls let QA preview any `(platform, version)` in a normal desktop browser, the one exception to "detection wins". Under the hood they call `host.__setOverride({ platform, version })`, a dev-only hatch you should never ship in product code.

::: warning Security: this is UX policy, not access control
Host Rules decides what the UI shows, not what a user is allowed to do. An iframe embedder controls the URL and can fake `?hv=`, and a user agent can be spoofed. Gate presentation with Host Rules, and enforce real permissions on the server, every time. Never treat `host.supports(...)` as an authorization check.
:::

See the [Host Rules reference](/reference/host-rules) for the full config schema, the version constraint grammar, resolution order, and every engine method.
