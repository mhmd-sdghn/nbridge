/**
 * Built-in version sources for the Host Rules engine.
 *
 * A version source is just a `() => string | null` function — the built-ins
 * are factories that return one, so custom sources and built-ins share the
 * same type. The engine invokes the source during resolution; call sites never
 * see the raw version.
 */

/**
 * A pluggable source of the host version. Returns the raw version string, or
 * `null` when it cannot be determined (which the engine treats as unknown =
 * conservative).
 */
export type HostVersionSource = () => string | null;

/** Options for {@link versionFromQuery}. */
export interface VersionFromQueryOptions {
  /**
   * sessionStorage key used to persist the version across client-side
   * navigation that drops the query param.
   * @default "nbridge:host-version"
   */
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "nbridge:host-version";

/**
 * Read the host version from a URL query param (default `hv`), persisting it to
 * sessionStorage so it survives client-side navigation that drops the param.
 *
 * Precedence: a fresh param wins over a stored value; when the param is absent,
 * the stored value is used; otherwise `null`. This is the zero-config default
 * and the recommended convention — the host appends `?hv=<version>` to the
 * webview/iframe URL.
 *
 * Storage access is wrapped in try/catch — some embedded contexts throw on
 * `sessionStorage`, in which case persistence silently degrades (never crashes).
 */
export function versionFromQuery(
  param = "hv",
  options: VersionFromQueryOptions = {},
): HostVersionSource {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;

  return () => {
    if (typeof window === "undefined") return null;

    const fromParam = new URLSearchParams(window.location.search).get(param);
    if (fromParam !== null) {
      try {
        window.sessionStorage.setItem(storageKey, fromParam);
      } catch {
        // Storage unavailable (private mode, sandboxed iframe) — degrade to
        // no persistence rather than crashing resolution.
      }
      return fromParam;
    }

    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
}

/**
 * Read the host version from `navigator.userAgent` using capture group 1 of the
 * supplied regex, e.g. `versionFromUserAgent(/MyApp\/([\d.]+)/)`. Returns `null`
 * when the regex does not match.
 */
export function versionFromUserAgent(regex: RegExp): HostVersionSource {
  return () => {
    if (typeof navigator === "undefined") return null;
    const match = navigator.userAgent.match(regex);
    return match?.[1] ?? null;
  };
}
