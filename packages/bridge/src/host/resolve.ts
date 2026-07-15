/**
 * Platform + version + trait resolution and rule evaluation for the Host Rules
 * engine.
 *
 * Resolution is pure and synchronous: given the version/trait sources, any
 * explicit values, and any dev override, it produces a {@link ResolvedHost}.
 * Evaluation runs pre-compiled capability/variant rules against that state.
 */

import type { BridgePlatform } from "../types";
import { detectPlatform } from "../utils/platform";
import type { HostTraitSource, HostVersionSource } from "./sources";
import type { HostOverride } from "./types";
import {
  type Constraint,
  type ParsedVersion,
  parseVersion,
  satisfies,
} from "./version";

/** The resolved host state used internally (carries the parsed version). */
export interface ResolvedHost {
  platform: BridgePlatform;
  /** Raw version string when it parsed successfully, else `null`. */
  version: string | null;
  /** The exact value the source/override produced, for diagnostics. */
  versionRaw: string | null;
  /** Parsed version, or `null` when unknown/unparsable. */
  parsed: ParsedVersion | null;
  isNative: boolean;
  /** Resolved trait values by name; `null` when unknown. */
  traits: Record<string, string | null>;
}

/** A compiled capability value for one platform. */
export type CompiledCapabilityValue =
  | { kind: "bool"; value: boolean }
  | { kind: "constraints"; constraints: Constraint[] };

/**
 * A compiled trait condition: the resolved trait `name` must equal one of
 * `values` (a single declared value is normalized to a one-element list).
 */
export interface CompiledTraitCondition {
  name: string;
  values: string[];
}

/**
 * A capability compiled to per-platform values plus an optional trait gate
 * (validated at config time). The trait gate, when present, is ANDed on top of
 * the per-platform result.
 */
export interface CompiledCapability {
  platforms: Partial<Record<BridgePlatform, CompiledCapabilityValue>>;
  traits?: CompiledTraitCondition[];
}

/** A compiled variant rule. Undefined clauses are simply not checked. */
export interface CompiledVariantRule {
  platform?: BridgePlatform;
  constraints?: Constraint[];
  traits?: CompiledTraitCondition[];
  use: string;
}

/** A variant compiled to ordered rules plus its default. */
export interface CompiledVariant {
  rules: CompiledVariantRule[];
  default: string;
}

/** Inputs to {@link resolveHost}. */
export interface ResolveOptions {
  androidInterface?: string;
  iosHandler?: string;
  versionSource: HostVersionSource;
  /** Explicit version from `setVersion`; `null` means none set. */
  explicitVersion: string | null;
  /** Trait sources by name (every declared trait has one). */
  traitSources: Record<string, HostTraitSource>;
  /** Explicit trait values from `setTrait`; a present key beats the source. */
  explicitTraits: Record<string, string>;
  /** Dev override from `__setOverride`; `null` means none. */
  override: HostOverride | null;
}

/** Resolve one trait's value with the same precedence rules as the version. */
function resolveTrait(
  name: string,
  options: ResolveOptions,
  isServer: boolean,
): string | null {
  const { override, explicitTraits, traitSources } = options;
  if (override?.traits && name in override.traits) {
    return override.traits[name] ?? null;
  }
  if (isServer) return null;
  if (name in explicitTraits) return explicitTraits[name] ?? null;
  const source = traitSources[name];
  return source ? source() : null;
}

/**
 * Resolve the current host platform, version, and traits.
 *
 * On the server (`window` absent) the platform is `"web"` and the version and
 * traits are `null`. Importing the config file server-side is safe and
 * conservative. A dev override still wins over the server defaults.
 */
export function resolveHost(options: ResolveOptions): ResolvedHost {
  const isServer = typeof window === "undefined";
  const { override } = options;

  let platform: BridgePlatform;
  if (override?.platform) {
    platform = override.platform;
  } else if (isServer) {
    platform = "web";
  } else {
    platform = detectPlatform(options.androidInterface, options.iosHandler);
  }

  let versionRaw: string | null;
  if (override && "version" in override) {
    versionRaw = override.version ?? null;
  } else if (isServer) {
    versionRaw = null;
  } else if (options.explicitVersion !== null) {
    versionRaw = options.explicitVersion;
  } else {
    versionRaw = options.versionSource();
  }

  const parsed = versionRaw === null ? null : parseVersion(versionRaw);

  const traits: Record<string, string | null> = {};
  for (const name of Object.keys(options.traitSources)) {
    traits[name] = resolveTrait(name, options, isServer);
  }
  // A trait present only in an override (not declared) still takes effect.
  if (override?.traits) {
    for (const name of Object.keys(override.traits)) {
      if (!(name in traits)) traits[name] = override.traits[name] ?? null;
    }
  }

  return {
    platform,
    version: parsed === null ? null : versionRaw,
    versionRaw,
    parsed,
    isNative: platform === "android" || platform === "ios",
    traits,
  };
}

/** True when the host satisfies every trait condition (logical AND). */
function traitsMatch(
  host: ResolvedHost,
  conditions: CompiledTraitCondition[],
): boolean {
  for (const { name, values } of conditions) {
    const actual = host.traits[name];
    // Unknown trait never matches: conservative, like an unknown version.
    if (actual === null || actual === undefined) return false;
    if (!values.includes(actual)) return false;
  }
  return true;
}

/** Evaluate a compiled capability against the resolved host. */
export function evaluateCapability(
  capability: CompiledCapability,
  host: ResolvedHost,
): boolean {
  const value = capability.platforms[host.platform];
  if (value === undefined) return false;
  const base =
    value.kind === "bool"
      ? value.value
      : satisfies(host.parsed, value.constraints);
  if (!base) return false;
  // The trait gate is ANDed on top; it never enables an unlisted platform.
  if (capability.traits && !traitsMatch(host, capability.traits)) return false;
  return true;
}

/** Evaluate a compiled variant against the resolved host (first match wins). */
export function evaluateVariant(
  variant: CompiledVariant,
  host: ResolvedHost,
): string {
  for (const rule of variant.rules) {
    if (rule.platform !== undefined && rule.platform !== host.platform) {
      continue;
    }
    if (
      rule.constraints !== undefined &&
      !satisfies(host.parsed, rule.constraints)
    ) {
      continue;
    }
    if (rule.traits !== undefined && !traitsMatch(host, rule.traits)) {
      continue;
    }
    return rule.use;
  }
  return variant.default;
}
