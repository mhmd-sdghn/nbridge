/**
 * Built-in version and trait sources for the Host Rules engine.
 *
 * A source is just a `() => string | null` function. The built-ins are
 * factories that return one, so custom sources and built-ins share the same
 * type. The engine invokes the source during resolution; call sites never see
 * the raw value.
 */

/**
 * A pluggable source of the host version. Returns the raw version string, or
 * `null` when it cannot be determined (which the engine treats as unknown =
 * conservative).
 */
export type HostVersionSource = () => string | null;

/**
 * A pluggable source of a trait value. Same shape as {@link HostVersionSource};
 * `null` means the trait is unknown, which the engine treats conservatively (a
 * rule requiring that trait does not match).
 */
export type HostTraitSource = () => string | null;

/** Options for {@link versionFromQuery}. */
export interface VersionFromQueryOptions {
  /**
   * sessionStorage key used to persist the version across client-side
   * navigation that drops the query param.
   * @default "nbridge:host-version" for the canonical "hv" param, otherwise
   *   "nbridge:host-version:<param>" (param-scoped to avoid cross-app collisions)
   */
  storageKey?: string;
  /**
   * Persist the value to sessionStorage so it survives client-side navigation
   * that drops the query param. Set `false` to read only the current URL.
   * @default true
   */
  persist?: boolean;
}

/** Options for {@link traitFromQuery}. */
export interface TraitFromQueryOptions {
  /**
   * sessionStorage key used to persist the trait.
   * @default "nbridge:trait:<param>"
   */
  storageKey?: string;
  /**
   * Persist the value to sessionStorage so it survives client-side navigation
   * that drops the query param. Set `false` to read only the current URL.
   * @default true
   */
  persist?: boolean;
}

const VERSION_STORAGE_KEY = "nbridge:host-version";

/**
 * Read a query param, optionally persisting it to sessionStorage so it survives
 * client-side navigation that drops the param. A fresh param always wins over
 * the stored value. Storage access is wrapped in try/catch (some embedded
 * contexts throw on `sessionStorage`), in which case persistence silently
 * degrades rather than crashing resolution. Shared by both built-in factories.
 */
// Memoize the parse of location.search so N trait sources + the version source
// in one resolution pass do not each rebuild URLSearchParams for the identical
// query string (the engine invokes every source on every re-resolution).
let cachedSearch: string | null = null;
let cachedParams: URLSearchParams | null = null;
function getQueryParams(search: string): URLSearchParams {
  if (cachedSearch !== search || cachedParams === null) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams;
}

function queryParamSource(
  param: string,
  storageKey: string,
  persist: boolean,
): () => string | null {
  return () => {
    if (typeof window === "undefined") return null;

    const raw = getQueryParams(window.location.search).get(param);
    // Treat an empty value (`?hv=` or a bare `?hv`) as absent: it must not
    // clobber a previously persisted good value with "".
    const fromParam = raw !== null && raw.trim() !== "" ? raw : null;
    if (fromParam !== null) {
      if (persist) {
        try {
          // Skip redundant writes (avoids needless cross-frame storage events).
          if (window.sessionStorage.getItem(storageKey) !== fromParam) {
            window.sessionStorage.setItem(storageKey, fromParam);
          }
        } catch {
          // Storage unavailable (private mode, sandboxed iframe): degrade to
          // no persistence rather than crashing resolution.
        }
      }
      return fromParam;
    }

    if (!persist) return null;
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
}

/**
 * Read the host version from a URL query param (default `hv`), persisting it to
 * sessionStorage so it survives client-side navigation that drops the param.
 *
 * This is the zero-config default and the recommended convention: the host
 * appends `?hv=<version>` to the webview/iframe URL.
 */
export function versionFromQuery(
  param = "hv",
  options: VersionFromQueryOptions = {},
): HostVersionSource {
  // Param-scoped default key so two engines on one origin using different
  // params ("appAv", "appBv") do not collide in sessionStorage. The canonical
  // "hv" param keeps the historical unscoped key for back-compat.
  const defaultKey =
    param === "hv" ? VERSION_STORAGE_KEY : `${VERSION_STORAGE_KEY}:${param}`;
  return queryParamSource(
    param,
    options.storageKey ?? defaultKey,
    options.persist ?? true,
  );
}

/**
 * Read a trait value from a URL query param, e.g. `traitFromQuery("mk")` for a
 * `?mk=google` marketing/channel param. Persists to sessionStorage by default
 * (key `nbridge:trait:<param>`) so it survives navigation that drops the param;
 * pass `{ persist: false }` to read only the current URL.
 */
export function traitFromQuery(
  param: string,
  options: TraitFromQueryOptions = {},
): HostTraitSource {
  const storageKey = options.storageKey ?? `nbridge:trait:${param}`;
  return queryParamSource(param, storageKey, options.persist ?? true);
}

/**
 * Read the host version from `navigator.userAgent` using capture group 1 of the
 * supplied regex, e.g. `versionFromUserAgent(/MyApp\/([\d.]+)/)`. Returns `null`
 * when the regex does not match.
 */
export function versionFromUserAgent(regex: RegExp): HostVersionSource {
  // Strip global/sticky flags at factory time: with `g`, String.match ignores
  // capture groups (returns full matches), and `y` carries lastIndex state
  // across calls, so either would make match[1] wrong or stateful.
  const safeRegex =
    regex.global || regex.sticky
      ? new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""))
      : regex;
  return () => {
    if (typeof navigator === "undefined") return null;
    const match = navigator.userAgent.match(safeRegex);
    return match?.[1] ?? null;
  };
}
