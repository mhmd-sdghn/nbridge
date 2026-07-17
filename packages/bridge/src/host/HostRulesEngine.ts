/**
 * `defineHostRules()`: the Host Rules engine factory.
 *
 * Standalone from `BridgeManager`: it reuses `detectPlatform()` for platform
 * detection but owns nothing else. Resolution runs lazily on first access
 * (safe to import server-side) and is cached until `setVersion` / `setTrait` /
 * `refresh` / `__setOverride` re-runs it. The cached snapshot object is replaced
 * only when resolution actually re-runs, so React's `useSyncExternalStore` sees
 * a stable reference (see `createHostHooks`).
 */

import type { BridgePlatform } from "../types";
import {
  type CompiledCapability,
  type CompiledTraitCondition,
  type CompiledVariant,
  evaluateCapability,
  evaluateVariant,
  type ResolvedHost,
  resolveHost,
} from "./resolve";
import {
  type HostTraitSource,
  type HostVersionSource,
  versionFromQuery,
} from "./sources";
import type {
  CapabilityRule,
  CapabilityWhen,
  HostInfo,
  HostOverride,
  HostRules,
  HostRulesConfig,
  HostServerSnapshot,
  PlatformSelect,
  TraitsConfig,
  VariantDef,
  VariantName,
  VariantValue,
} from "./types";
import { type Constraint, parseConstraints } from "./version";

/** Normalize a `when.traits` clause into compiled one-of conditions. */
function compileTraitMatch(
  match: Record<string, string | readonly string[] | undefined>,
): CompiledTraitCondition[] {
  const conditions: CompiledTraitCondition[] = [];
  for (const [name, value] of Object.entries(match)) {
    if (value === undefined) continue;
    conditions.push({
      name,
      values: Array.isArray(value) ? [...value] : [value as string],
    });
  }
  return conditions;
}

function compileCapabilities(
  capabilities: Record<string, CapabilityRule>,
): Record<string, CompiledCapability> {
  const compiled: Record<string, CompiledCapability> = {};

  for (const [name, rule] of Object.entries(capabilities)) {
    const platforms: CompiledCapability["platforms"] = {};
    let traits: CompiledTraitCondition[] | undefined;

    for (const [key, value] of Object.entries(rule)) {
      if (key === "when") {
        const when = value as CapabilityWhen | undefined;
        if (when?.traits) {
          traits = compileTraitMatch(
            when.traits as Record<string, string | readonly string[]>,
          );
        }
        continue;
      }

      const platform = key as BridgePlatform;
      const platformValue = value as boolean | string | string[] | undefined;
      // An explicit `undefined` is treated the same as an absent key: the
      // capability is off on that platform (fail-safe: a missing flag never
      // silently enables a capability).
      if (platformValue === undefined) continue;
      if (typeof platformValue === "boolean") {
        platforms[platform] = { kind: "bool", value: platformValue };
        continue;
      }
      const constraints = parseConstraints(platformValue);
      if (constraints === null) {
        throw new Error(
          `[nbridge] Invalid version constraint in capability "${name}" for platform "${platform}": ${JSON.stringify(platformValue)}`,
        );
      }
      platforms[platform] = { kind: "constraints", constraints };
    }

    compiled[name] = { platforms, traits };
  }

  return compiled;
}

function compileVariants(
  variants: Record<string, VariantDef>,
): Record<string, CompiledVariant> {
  const compiled: Record<string, CompiledVariant> = {};

  for (const [name, def] of Object.entries(variants)) {
    const rules = def.rules.map((rule, index) => {
      const { platform, version, traits } = rule.when;
      if (
        platform === undefined &&
        version === undefined &&
        traits === undefined
      ) {
        throw new Error(
          `[nbridge] Variant "${name}" rule #${index} has an empty \`when\` clause. Provide at least one of \`platform\`, \`version\`, or \`traits\`.`,
        );
      }

      let constraints: Constraint[] | undefined;
      if (version !== undefined) {
        const parsed = parseConstraints(version);
        if (parsed === null) {
          throw new Error(
            `[nbridge] Invalid version constraint in variant "${name}" rule #${index}: ${JSON.stringify(version)}`,
          );
        }
        constraints = parsed;
      }

      const compiledTraits =
        traits !== undefined
          ? compileTraitMatch(
              traits as Record<string, string | readonly string[]>,
            )
          : undefined;

      return { platform, constraints, traits: compiledTraits, use: rule.use };
    });
    compiled[name] = { rules, default: def.default };
  }

  return compiled;
}

/** Split each trait declaration into its source and any declared values. */
function compileTraits(traits: TraitsConfig | undefined): {
  sources: Record<string, HostTraitSource>;
  values: Record<string, string[] | undefined>;
} {
  const sources: Record<string, HostTraitSource> = {};
  const values: Record<string, string[] | undefined> = {};
  for (const [name, def] of Object.entries(traits ?? {})) {
    if (typeof def === "function") {
      sources[name] = def;
      values[name] = undefined;
    } else {
      sources[name] = def.source;
      values[name] = def.values ? [...def.values] : undefined;
    }
  }
  return { sources, values };
}

function resolveVersionSource(
  version: string | HostVersionSource | undefined,
): HostVersionSource {
  if (typeof version === "string") {
    return () => version;
  }
  if (typeof version === "function") {
    return version;
  }
  return versionFromQuery("hv");
}

function toInfo(host: ResolvedHost): HostInfo {
  return {
    platform: host.platform,
    version: host.version,
    versionRaw: host.versionRaw,
    isNative: host.isNative,
    traits: host.traits,
  };
}

/**
 * The conservative state the server resolves to (see `resolveHost`'s server
 * branch): platform `"web"`, version and traits unknown. Capabilities and
 * variants are evaluated against this to build the SSR snapshot, so hydration
 * matches.
 */
const SERVER_HOST: ResolvedHost = {
  platform: "web",
  version: null,
  versionRaw: null,
  parsed: null,
  isNative: false,
  traits: {},
};

/**
 * Define an app's Host Rules. Call once at module scope in a per-app config
 * file. Malformed version constraints and empty `when` clauses throw here,
 * failing fast at boot rather than silently at evaluation.
 */
export function defineHostRules<
  const TTraits extends TraitsConfig,
  const TCaps extends Record<string, CapabilityRule<TTraits>>,
  const TVariants extends Record<string, VariantDef<string, TTraits>>,
>(
  config: HostRulesConfig<TTraits, TCaps, TVariants>,
): HostRules<TCaps, TVariants, TTraits> {
  const compiledCapabilities = compileCapabilities(
    (config.capabilities ?? {}) as Record<string, CapabilityRule>,
  );
  const compiledVariants = compileVariants(
    (config.variants ?? {}) as Record<string, VariantDef>,
  );
  const androidInterface = config.platform?.androidInterface;
  const iosHandler = config.platform?.iosHandler;
  const versionSource = resolveVersionSource(config.version);
  const { sources: traitSources, values: traitValues } = compileTraits(
    config.traits,
  );

  let resolved: ResolvedHost | null = null;
  let info: HostInfo | null = null;
  let serverSnapshot: HostServerSnapshot | null = null;
  let explicitVersion: string | null = null;
  const explicitTraits: Record<string, string> = {};
  let override: HostOverride | null = null;
  const listeners = new Set<() => void>();

  function compute(): void {
    resolved = resolveHost({
      androidInterface,
      iosHandler,
      versionSource,
      explicitVersion,
      traitSources,
      explicitTraits,
      override,
    });
    info = toInfo(resolved);
  }

  function current(): ResolvedHost {
    if (resolved === null) compute();
    // compute() always assigns; the assertion narrows for the type checker.
    return resolved as ResolvedHost;
  }

  function reresolve(): void {
    compute();
    for (const listener of listeners) listener();
  }

  const engine: HostRules<TCaps, TVariants, TTraits> = {
    supports(name) {
      // hasOwnProperty guards against prototype-inherited names ("constructor",
      // "toString", ...) that would otherwise resolve to Object.prototype
      // members and throw a TypeError in evaluateCapability instead of the
      // documented fail-safe `false`.
      if (!Object.hasOwn(compiledCapabilities, name as string)) {
        return false;
      }
      const capability = compiledCapabilities[name];
      if (capability === undefined) return false;
      return evaluateCapability(capability, current());
    },

    variant<K extends VariantName<TVariants>>(
      name: K,
    ): VariantValue<TVariants[K]> {
      if (!Object.hasOwn(compiledVariants, name as string)) {
        throw new Error(`[nbridge] Unknown variant "${name}".`);
      }
      const variant = compiledVariants[name];
      if (variant === undefined) {
        throw new Error(`[nbridge] Unknown variant "${name}".`);
      }
      return evaluateVariant(variant, current()) as VariantValue<TVariants[K]>;
    },

    select<T>(map: PlatformSelect<T>): T {
      const value = map[current().platform];
      return value !== undefined ? value : map.default;
    },

    info() {
      current();
      return info as HostInfo;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setVersion(version) {
      explicitVersion = version;
      reresolve();
    },

    setTrait(name, value) {
      if (value === null) {
        delete explicitTraits[name];
      } else {
        explicitTraits[name] = value;
      }
      reresolve();
    },

    refresh() {
      reresolve();
    },

    __setOverride(next) {
      override = next;
      reresolve();
    },

    __introspect() {
      return {
        capabilities: Object.keys(compiledCapabilities),
        variants: Object.keys(compiledVariants),
        traits: Object.keys(traitSources).map((name) => ({
          name,
          values: traitValues[name],
        })),
      };
    },

    __serverSnapshot() {
      if (serverSnapshot === null) {
        const supports: Record<string, boolean> = {};
        for (const [name, capability] of Object.entries(compiledCapabilities)) {
          supports[name] = evaluateCapability(capability, SERVER_HOST);
        }
        const variants: Record<string, string> = {};
        for (const [name, variant] of Object.entries(compiledVariants)) {
          variants[name] = evaluateVariant(variant, SERVER_HOST);
        }
        // Report every declared trait as unknown, matching the client shape.
        const traits: Record<string, string | null> = {};
        for (const name of Object.keys(traitSources)) traits[name] = null;
        serverSnapshot = {
          info: { ...toInfo(SERVER_HOST), traits },
          supports,
          variants,
        };
      }
      return serverSnapshot;
    },
  };

  return engine;
}
