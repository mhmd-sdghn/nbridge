/**
 * Platform + version resolution and rule evaluation for the Host Rules engine.
 *
 * Resolution is pure and synchronous: given the version source, any explicit
 * version, and any dev override, it produces a {@link ResolvedHost}. Evaluation
 * runs pre-compiled capability/variant rules against that resolved state.
 */

import type { BridgePlatform } from "../types";
import { detectPlatform } from "../utils/platform";
import type { HostVersionSource } from "./sources";
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
}

/** A compiled capability value for one platform. */
export type CompiledCapabilityValue =
  | { kind: "bool"; value: boolean }
  | { kind: "constraints"; constraints: Constraint[] };

/** A capability compiled to per-platform values (validated at config time). */
export type CompiledCapability = Partial<
  Record<BridgePlatform, CompiledCapabilityValue>
>;

/** A compiled variant rule. `constraints` is undefined when the rule has no version clause. */
export interface CompiledVariantRule {
  platform?: BridgePlatform;
  constraints?: Constraint[];
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
  /** Dev override from `__setOverride`; `null` means none. */
  override: HostOverride | null;
}

/**
 * Resolve the current host platform and version (algorithm §4.3).
 *
 * On the server (`window` absent) the platform is `"web"` and the version is
 * `null` — importing the config file server-side is safe and conservative.
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

  return {
    platform,
    version: parsed === null ? null : versionRaw,
    versionRaw,
    parsed,
    isNative: platform === "android" || platform === "ios",
  };
}

/** Evaluate a compiled capability against the resolved host. */
export function evaluateCapability(
  capability: CompiledCapability,
  host: ResolvedHost,
): boolean {
  const value = capability[host.platform];
  if (value === undefined) return false;
  if (value.kind === "bool") return value.value;
  return satisfies(host.parsed, value.constraints);
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
    return rule.use;
  }
  return variant.default;
}
