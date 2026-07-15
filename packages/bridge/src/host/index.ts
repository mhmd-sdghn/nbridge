/**
 * Host Rules engine — capability & variant resolution per (platform, version).
 * Framework-agnostic; React bindings live in `nbridge/react`.
 */

export { defineHostRules } from "./HostRulesEngine";
export {
  type HostTraitSource,
  type HostVersionSource,
  type TraitFromQueryOptions,
  traitFromQuery,
  type VersionFromQueryOptions,
  versionFromQuery,
  versionFromUserAgent,
} from "./sources";
export type {
  CapabilityName,
  CapabilityRule,
  CapabilityWhen,
  HostInfo,
  HostOverride,
  HostPlatformConfig,
  HostRules,
  HostRulesConfig,
  PlatformSelect,
  TraitDef,
  TraitMatch,
  TraitName,
  TraitsConfig,
  TraitValue,
  VariantDef,
  VariantName,
  VariantRule,
  VariantValue,
  VariantWhen,
  VersionConstraint,
} from "./types";
