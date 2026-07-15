# Next.js

`nbridge/next` solves one specific, painful WebView problem: **back navigation**. Inside a native app, "back" should navigate within your Next.js App Router history while there is somewhere to go back to — and tell the native host to close the WebView when there is not.

Requires the optional `next` peer dependency (>= 14) and the App Router.

## Setup

Bind the back-navigation hooks to your existing bridge instance:

```ts
// src/lib/bridge.ts
import { createBridgeHooks } from "nbridge/react";
import { createBridgeBackNavigation } from "nbridge/next";

export const { useBridgeSend, instance } = createBridgeHooks({
  config: { debug: true },
});

export const { useBridgeBack } = createBridgeBackNavigation(
  instance,
  { shutdownEvent: "shutdown" }, // message type sent to close the WebView (default: "shutdown")
);
```

::: tip Server Components
`BridgeBackAction` is a plain string-constant object exported from the **root
`nbridge` entry**, not from `nbridge/next`. The framework entries are
client-only (`"use client"`), so importing values from them in a Server
Component yields `undefined`. Import it from `nbridge` and it works anywhere —
Server Components, Client Components, and any future framework entry:

```ts
import { BridgeBackAction } from "nbridge";

<PageHeader backAction={BridgeBackAction.AppShutdown} />
```
:::

When the WebView should close, the bridge sends `{ type: "shutdown", payload: {} }` to the host — the host implements the actual close.

## `useBridgeBack`

```tsx
"use client";

import { useBridgeBack } from "@/lib/bridge";

export function BackButton() {
  const { routerBackOrShutdown, canRouterBack } = useBridgeBack();

  return (
    <button onClick={() => routerBackOrShutdown()}>
      {canRouterBack() ? "Back" : "Close"}
    </button>
  );
}
```

Returned API:

| Function | Behavior |
| --- | --- |
| `routerBackOrShutdown(force?)` | `router.back()` when in-app history exists, otherwise send the shutdown event. Force a branch with `BridgeBackAction.RouterBack` or `BridgeBackAction.AppShutdown` (imported from `nbridge`). |
| `canRouterBack()` | `true` when a router back-step is available. |
| `forceBrowserBackToShutdownApp()` | Arms a one-shot intercept of the browser/hardware back gesture that sends the shutdown event instead of navigating. |
| `removeForceBrowserBackToShutdownApp()` | Disarms the intercept (also removed automatically on unmount). |

### Navigation modes

```tsx
const { routerBackOrShutdown } = useBridgeBack({ mode: "session" }); // default
```

- **`"session"`** (default) — tracks the in-app history in `sessionStorage`, so "can I go back?" reflects *this WebView session* only, not whatever the WebView's browser history contains. This is what you want in native apps.
- **`"browser"`** — falls back to `window.history.length` plus a same-origin referrer check.

The hook keeps the session history in sync with the current pathname automatically.

### Hardware back on Android

A common pattern for a flow's final screen (e.g. a success page where "back" should exit rather than re-open the form):

```tsx
"use client";

import { useEffect } from "react";
import { useBridgeBack } from "@/lib/bridge";

export function SuccessScreen() {
  const { forceBrowserBackToShutdownApp, removeForceBrowserBackToShutdownApp } =
    useBridgeBack();

  useEffect(() => {
    forceBrowserBackToShutdownApp();
    return removeForceBrowserBackToShutdownApp;
  }, []);

  return <p>Done!</p>;
}
```

The intercept is one-shot: after it fires once (sending the shutdown event) it unregisters itself, so a second back press can never double-fire.

An empty dependency array is fine here — the effect is safe under React StrictMode's dev-only mount → cleanup → remount cycle (the intercept manager distinguishes its own history cleanup from a real back press, so remounting never triggers a shutdown). All functions returned by `useBridgeBack` are also referentially stable (`useCallback`), so including them in a dependency array is equally safe.

## Lower-level exports

For custom setups, `nbridge/next` also exports the pieces `useBridgeBack` is built from:

```ts
import {
  useBackIntercept,          // React hook around the back-intercept manager
  BackInterceptManager,      // singleton managing popstate interception
  setupBackInterception,     // imperative one-shot intercept, returns cleanup
  canNavigateBack,           // session- or browser-mode back check
  resolveNavigationMode,
  // session-history utilities
  ensureSessionHistoryTracking,
  syncCurrentUrlIntoSession,
  prepareSessionForRouterBack,
  getSessionHistorySnapshot,
  clearSessionHistory,
  isSessionHistoryEnabled,
  teardownSessionHistoryTracking,
} from "nbridge/next";
```

::: tip Host side
The shutdown event is an ordinary bridge message. On Android, handle it in your `@JavascriptInterface` and call `finish()`; on iOS, dismiss the view controller. See the [platform guides](/guide/platforms/android).
:::
