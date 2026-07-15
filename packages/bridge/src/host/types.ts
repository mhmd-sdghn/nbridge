/**
 * Public types for the Host Rules engine — a local, deterministic
 * capability/variant engine keyed on `(platform, version)`.
 *
 * Capability and variant names are inferred as literal types from the config
 * passed to `defineHostRules`, so call sites are fully typed: a misspelled
 * capability name is a compile error, and `variant()` returns the exact union
 * of its rule values plus its default.
 */

import type { BridgePlatform } from "../types";
import type { HostVersionSource } from "./sources";

/**
 * A version constraint: a single string (`">=8.2"`, `"3"`) or an array of
 * strings interpreted as a logical AND (`[">=2", "<4"]`).
 */
export type VersionConstraint = string | string[];

/**
 * A named capability's per-platform rule. Each platform maps to:
 * - `boolean` — allowed/denied regardless of version, or
 * - a {@link VersionConstraint} — allowed when the host version satisfies it.
 *
 * An absent platform key (or an explicit `undefined`) means the capability is
 * `false` on that platform — a missing value is fail-safe, never enabling.
 */
export type CapabilityRule = Partial<
  Record<BridgePlatform, boolean | VersionConstraint>
>;

/**
 * The match clause of a variant rule. `platform` and `version` are each
 * optional and may appear together or alone, but at least one must be present
 * (an empty `when` is rejected at `defineHostRules()` time). Kept an object so
 * an embedder-identity field could be added later without a breaking change.
 */
export interface VariantWhen {
  platform?: BridgePlatform;
  version?: VersionConstraint;
}

/** A single ordered variant rule: when `when` matches, `use` this value. */
export interface VariantRule<TUse extends string = string> {
  when: VariantWhen;
  use: TUse;
}

/**
 * A named variant: an ordered list of rules (first match wins) plus a required
 * `default` used when no rule matches.
 */
export interface VariantDef<TUse extends string = string> {
  rules: ReadonlyArray<VariantRule<TUse>>;
  default: TUse;
}

/** Passthrough options to `detectPlatform()`. */
export interface HostPlatformConfig {
  /** @default "AndroidBridge" */
  androidInterface?: string;
  /** @default "iosBridge" */
  iosHandler?: string;
}

/**
 * Config passed to `defineHostRules`. One file per consuming app defines its
 * own capability and variant names.
 */
export interface HostRulesConfig<
  TCaps extends Record<string, CapabilityRule> = Record<string, CapabilityRule>,
  TVariants extends Record<string, VariantDef> = Record<string, VariantDef>,
> {
  /**
   * How to acquire the host version. Accepts a static string, a custom
   * `() => string | null` function, or a built-in source (`versionFromQuery`,
   * `versionFromUserAgent`).
   * @default versionFromQuery("hv")
   */
  version?: string | HostVersionSource;

  /** Bridge-detection options forwarded to `detectPlatform()`. */
  platform?: HostPlatformConfig;

  /** Named boolean capabilities. */
  capabilities?: TCaps;

  /** Named variants (string enums). */
  variants?: TVariants;
}

/** Resolved host state exposed by `host.info()`. */
export interface HostInfo {
  /** Detected platform (or `"web"` on the server / plain browser). */
  platform: BridgePlatform;
  /** The version string when it parsed successfully, else `null`. */
  version: string | null;
  /** The raw value the version source returned, kept for diagnostics. */
  versionRaw: string | null;
  /** `true` for `android` / `ios`. */
  isNative: boolean;
}

/** Dev-only override applied via `host.__setOverride()`. */
export interface HostOverride {
  platform?: BridgePlatform;
  version?: string | null;
}

/**
 * The conservative snapshot the server renders — platform `"web"`, version
 * unknown. Used by the React bindings' `getServerSnapshot` so hydration matches
 * the server output regardless of the client's query/version source.
 */
export interface HostServerSnapshot {
  info: HostInfo;
  supports: Record<string, boolean>;
  variants: Record<string, string>;
}

/** Value map for `host.select()` — a per-platform value pick with a default. */
export type PlatformSelect<T> = Partial<Record<BridgePlatform, T>> & {
  default: T;
};

/** The literal union of capability names inferred from the config. */
export type CapabilityName<TCaps> = keyof TCaps & string;

/** The literal union of variant names inferred from the config. */
export type VariantName<TVariants> = keyof TVariants & string;

/**
 * The value union for a variant: every rule's `use` value plus its `default`.
 */
export type VariantValue<V> = V extends {
  rules: ReadonlyArray<{ use: infer U extends string }>;
  default: infer D extends string;
}
  ? U | D
  : never;

/**
 * The Host Rules engine instance. Created by `defineHostRules`; call sites use
 * `supports` / `variant` / `select` / `info`, React binds to `subscribe`, and
 * async hosts push a late version via `setVersion`.
 */
export interface HostRules<
  TCaps extends Record<string, CapabilityRule> = Record<string, CapabilityRule>,
  TVariants extends Record<string, VariantDef> = Record<string, VariantDef>,
> {
  /** Whether a capability is enabled on the resolved host. */
  supports(name: CapabilityName<TCaps>): boolean;

  /** The resolved value of a variant (typed union of its rule values + default). */
  variant<K extends VariantName<TVariants>>(
    name: K,
  ): VariantValue<TVariants[K]>;

  /** Pick a per-platform value, falling back to `default` (required). */
  select<T>(map: PlatformSelect<T>): T;

  /** The resolved host state. */
  info(): HostInfo;

  /**
   * Subscribe to resolution changes (fires on `setVersion` / `refresh` /
   * `__setOverride`). Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Imperatively set the host version for async acquisition (e.g. a value that
   * arrives over the bridge). Beats the configured source and persists across
   * `refresh()`; `setVersion(null)` clears it so the next `refresh()` falls
   * back to the source. Re-resolves and notifies subscribers.
   */
  setVersion(version: string | null): void;

  /** Re-run resolution (re-invokes the version source unless a version was set). */
  refresh(): void;

  /**
   * DEV-ONLY escape hatch for devtools/tests — force a platform and/or version.
   * Not for production; the only supported override mechanism.
   */
  __setOverride(override: HostOverride | null): void;

  /**
   * DEV-ONLY introspection for the devtools panel: the configured capability
   * and variant names. Not part of the app-facing contract.
   */
  __introspect(): { capabilities: string[]; variants: string[] };

  /**
   * SSR-internal: the conservative snapshot the server renders (platform
   * `"web"`, version unknown), evaluated against every configured capability
   * and variant. The React bindings pass this to `useSyncExternalStore`'s
   * `getServerSnapshot` so hydration matches the server output. Cached with a
   * stable identity — never changes for the lifetime of the engine.
   */
  __serverSnapshot(): HostServerSnapshot;
}
