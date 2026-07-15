/**
 * Host Rules engine — capability & variant resolution per (platform, version).
 * Framework-agnostic; React bindings live in `nbridge/react`.
 */

export { defineHostRules } from "./HostRulesEngine";
export {
  type HostVersionSource,
  type VersionFromQueryOptions,
  versionFromQuery,
  versionFromUserAgent,
} from "./sources";
export type {
  CapabilityName,
  CapabilityRule,
  HostInfo,
  HostOverride,
  HostPlatformConfig,
  HostRules,
  HostRulesConfig,
  PlatformSelect,
  VariantDef,
  VariantName,
  VariantRule,
  VariantValue,
  VariantWhen,
  VersionConstraint,
} from "./types";
