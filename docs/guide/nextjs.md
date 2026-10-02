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

export const { useBridgeBack } = createBridgeBackNavigation(instance, {
  shutdownEvent: "shutdown", // message type sent to close the WebView (default: "shutdown")
  basePath: process.env.NEXT_PUBLIC_BASE_PATH, // your Next.js basePath, if any
});
```

`basePath` is only used to match [back intercepts](#intercepting-back-on-one-page) to pages. Leave it out when the app has no `basePath`.

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

The send is made with `{ immediate: true }`, so it never enters the batcher or the [retry queue](/guide/features/retry-queue): the host is about to tear the WebView down, so a parked copy would either never arrive or arrive in a later session and close the app out from under the user. A delivery failure is logged rather than retried.

Two details worth knowing:

- Any messages still waiting in the batcher are flushed first, since the shutdown would otherwise overtake them and the host would destroy the WebView before they went out.
- Taps that land while a shutdown is still in flight are ignored, so a double tap sends one shutdown. Once it settles the guard releases — a delivered shutdown does not mean the host closed anything (it may prompt and let the user cancel), so a later tap must still work.

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
| `routerBackOrShutdown(force?)` | `router.back()` when in-app history exists, otherwise send the shutdown event. Force a branch with `BridgeBackAction.RouterBack` or `BridgeBackAction.AppShutdown` (imported from `nbridge`). While a back intercept is armed on the page, it steps past the intercept's extra history entry, so one call always leaves the page. |
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

### Intercepting back on one page

`useBackIntercept` runs a callback instead of navigating when the user presses back — for example, to ask "discard your changes?" on a form:

```tsx
"use client";

import { useBackIntercept } from "nbridge/next";

export function FormHeader({ isDirty }: { isDirty: boolean }) {
  useBackIntercept(
    () => openDiscardDialog(),
    "/point-info-form", // which page it guards
    isDirty, // armed only while there is something to lose
  );
  return null;
}
```

The second argument says which page the intercept belongs to:

| Value | Matches |
| --- | --- |
| `"*"` (default) | every page |
| a string | exactly that page, e.g. `"/point-info-form"` |
| a `RegExp` | any page whose path it matches, e.g. `/^\/work-hours/` |

Paths are the ones your app sees: **without the `basePath`**, and a trailing slash does not matter. That is the value `usePathname()` returns, so passing it straight through works, with or without `trailingSlash: true`. Pass the `basePath` once to `createBridgeBackNavigation` (see [Setup](#setup)).

How it behaves:

- The intercept keeps firing on every back press until you disarm it (pass `false`, or unmount). Guard your callback if it must not run twice.
- When several intercepts match, the most recently registered one fires.
- A forward press never fires it.
- If the user leaves the page while it is armed, the extra history entry it used is skipped when they come back, so no back press is wasted.

## Lower-level exports

For custom setups, `nbridge/next` also exports the pieces `useBridgeBack` is built from:

```ts
import {
  useBackIntercept,          // React hook around the back-intercept manager
  BackInterceptManager,      // singleton managing popstate interception
  type BackInterceptPath,    // "*" | string | RegExp — what an intercept matches
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
