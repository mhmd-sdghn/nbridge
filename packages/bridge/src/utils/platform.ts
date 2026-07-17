import type { BridgePlatform, PlatformInfo } from "../types";

export function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // If we can't access window.top due to cross-origin, we're in an iframe
    return true;
  }
}

export function hasAndroidBridge(interfaceName = "AndroidBridge"): boolean {
  if (typeof window === "undefined") return false;
  const candidate = (window as unknown as Record<string, unknown>)[
    interfaceName
  ] as { postMessage?: unknown } | undefined;
  // Require a callable postMessage: a bare object (or a DOM element exposed via
  // window[id] named-property access, e.g. <div id="AndroidBridge">) is not a
  // real WebView bridge and must not hijack platform detection.
  return typeof candidate?.postMessage === "function";
}

export function hasIOSBridge(handlerName = "iosBridge"): boolean {
  if (typeof window === "undefined") return false;
  return (
    "webkit" in window &&
    typeof (window as { webkit?: unknown }).webkit === "object" &&
    (window as { webkit?: { messageHandlers?: Record<string, unknown> } })
      .webkit?.messageHandlers?.[handlerName] !== undefined
  );
}

export function detectPlatform(
  androidInterface = "AndroidBridge",
  iosHandler = "iosBridge",
): BridgePlatform {
  if (typeof window === "undefined") return "web";

  // Check for native bridges first (more specific)
  if (hasAndroidBridge(androidInterface)) return "android";
  if (hasIOSBridge(iosHandler)) return "ios";

  // Check for iframe
  if (isIframe()) return "iframe";

  // Default to web
  return "web";
}

export function getPlatformInfo(
  androidInterface = "AndroidBridge",
  iosHandler = "iosBridge",
): PlatformInfo {
  const platform = detectPlatform(androidInterface, iosHandler);

  return {
    platform,
    isNative: platform === "android" || platform === "ios",
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
  };
}
