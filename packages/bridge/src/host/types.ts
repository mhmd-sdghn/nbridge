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
import type { HostTraitSource, HostVersionSource } from "./sources";

/**
 * A version constraint: a single string (`">=8.2"`, `"3"`) or an array of
 * strings interpreted as a logical AND (`[">=2", "<4"]`).
 */
export type VersionConstraint = string | string[];

/**
 * A trait declaration. Either a bare {@link HostTraitSource} (the value is any
 * string, matched loosely), or a source plus a `values` list that both
 * constrains and types the accepted values (a typo in a rule becomes a compile
 * error). Traits are extra `(platform, version)`-independent dimensions, e.g. a
 * `?mk=` marketing channel.
 */
export type TraitDef =
  | HostTraitSource
  | { source: HostTraitSource; values?: readonly string[] };

/** The map of trait name → declaration passed to `defineHostRules`. */
export type TraitsConfig = Record<string, TraitDef>;

/**
 * The value union a trait accepts in a rule: its declared `values` when present,
 * otherwise any `string`.
 */
export type TraitValue<T> = T extends {
  values: readonly (infer V extends string)[];
}
  ? V
  : string;

/** The literal union of trait names inferred from the config. */
export type TraitName<TTraits> = keyof TTraits & string;

/**
 * A trait match clause: for each declared trait, a single value or an array of
 * values (matched as "one of"). Values are typed to each trait's domain.
 */
export type TraitMatch<TTraits> = {
  [K in keyof TTraits]?:
    | TraitValue<TTraits[K]>
    | ReadonlyArray<TraitValue<TTraits[K]>>;
};

/** The optional trait gate on a capability or shared by a variant rule. */
export interface CapabilityWhen<TTraits = TraitsConfig> {
  traits?: TraitMatch<TTraits>;
}

/**
 * A named capability's per-platform rule. Each platform maps to:
 * - `boolean` — allowed/denied regardless of version, or
 * - a {@link VersionConstraint} — allowed when the host version satisfies it.
 *
 * An absent platform key (or an explicit `undefined`) means the capability is
 * `false` on that platform — a missing value is fail-safe, never enabling.
 *
 * Use the `all` key as a fallback for every platform not explicitly listed, so
 * a trait-only or cross-platform capability need not enumerate all four
 * platforms (an explicit platform key still overrides `all`).
 *
 * An optional `when` gate adds trait conditions ANDed on top of the per-platform
 * result. It never enables a platform you did not list.
 */
export type CapabilityRule<TTraits = TraitsConfig> = Partial<
  Record<BridgePlatform, boolean | VersionConstraint>
> & {
  /** Fallback for any platform not explicitly listed above. */
  all?: boolean | VersionConstraint;
  when?: CapabilityWhen<TTraits>;
};

/**
 * The match clause of a variant rule. `platform`, `version`, and `traits` are
 * each optional and combine with logical AND, but at least one must be present
 * (an empty `when` is rejected at `defineHostRules()` time).
 */
export interface VariantWhen<TTraits = TraitsConfig> {
  platform?: BridgePlatform;
  version?: VersionConstraint;
  traits?: TraitMatch<TTraits>;
}

/** A single ordered variant rule: when `when` matches, `use` this value. */
export interface VariantRule<
  TUse extends string = string,
  TTraits = TraitsConfig,
> {
  when: VariantWhen<TTraits>;
  use: TUse;
}

/**
 * A named variant: an ordered list of rules (first match wins) plus a required
 * `default` used when no rule matches.
 */
export interface VariantDef<
  TUse extends string = string,
  TTraits = TraitsConfig,
> {
  rules: ReadonlyArray<VariantRule<TUse, TTraits>>;
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
  TTraits extends TraitsConfig = TraitsConfig,
  TCaps extends Record<string, CapabilityRule<TTraits>> = Record<
    string,
    CapabilityRule<TTraits>
  >,
  TVariants extends Record<string, VariantDef<string, TTraits>> = Record<
    string,
    VariantDef<string, TTraits>
  >,
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

  /**
   * Extra `(platform, version)`-independent dimensions, each with a source
   * (e.g. `traitFromQuery("mk")`). Declare `values` on a trait to type-check
   * the values used in rules.
   */
  traits?: TTraits;

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
  /** Resolved trait values by name; `null` when unknown. */
  traits: Record<string, string | null>;
}

/** Dev-only override applied via `host.__setOverride()`. */
export interface HostOverride {
  platform?: BridgePlatform;
  version?: string | null;
  /** Force trait values (a present key wins over source and `setTrait`). */
  traits?: Record<string, string | null>;
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
  // Parameter order matches HostRulesConfig / defineHostRules (declaration
  // order: traits, capabilities, variants) so the same three type params never
  // need to be reordered between config and instance annotations.
  TTraits extends TraitsConfig = TraitsConfig,
  TCaps extends Record<string, CapabilityRule> = Record<string, CapabilityRule>,
  TVariants extends Record<string, VariantDef> = Record<string, VariantDef>,
> {
  /**
   * Whether a capability is enabled on the resolved host. Fail-safe: an unknown
   * name returns `false` (never throws), consistent with the "absent platform
   * key means false" rule, so a capability gate can never crash a render. This
   * is intentionally different from `variant()`, which throws on an unknown
   * name because a variant has no safe default value to return.
   */
  supports(name: CapabilityName<TCaps>): boolean;

  /**
   * The resolved value of a variant (typed union of its rule values + default).
   * Throws `[nbridge] Unknown variant "..."` for a name not in the config
   * (unlike `supports`, there is no safe fallback value).
   */
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

  /**
   * Imperatively set a trait value for async acquisition (e.g. a value that
   * arrives over the bridge). A set value beats the configured source and
   * persists across `refresh()`; `setTrait(name, null)` clears it so the next
   * `refresh()` falls back to the source. Re-resolves and notifies subscribers.
   */
  setTrait(name: TraitName<TTraits>, value: string | null): void;

  /** Re-run resolution (re-invokes the version source unless a version was set). */
  refresh(): void;

  /**
   * Force a platform, version, and/or traits. The supported mechanism for
   * tests and devtools to drive the engine. Pass `null` to clear the override.
   * Field semantics: an omitted or `undefined` field leaves the source/explicit
   * value in effect; `null` forces that field to unknown.
   */
  setOverride(override: HostOverride | null): void;

  /**
   * @deprecated Use `setOverride`. Kept as an alias for compatibility.
   */
  __setOverride(override: HostOverride | null): void;

  /**
   * DEV-ONLY introspection for the devtools panel: the configured capability,
   * variant, and trait names (with any declared trait values). Not part of the
   * app-facing contract.
   */
  __introspect(): {
    capabilities: string[];
    variants: string[];
    traits: Array<{ name: string; values?: string[] }>;
  };

  /**
   * SSR-internal: the conservative snapshot the server renders (platform
   * `"web"`, version unknown), evaluated against every configured capability
   * and variant. The React bindings pass this to `useSyncExternalStore`'s
   * `getServerSnapshot` so hydration matches the server output. Cached with a
   * stable identity — never changes for the lifetime of the engine.
   */
  __serverSnapshot(): HostServerSnapshot;
}
