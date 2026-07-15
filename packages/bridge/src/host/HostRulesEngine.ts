/**
 * `defineHostRules()` — the Host Rules engine factory.
 *
 * Standalone from `BridgeManager`: it reuses `detectPlatform()` for platform
 * detection but owns nothing else. Resolution runs lazily on first access
 * (safe to import server-side) and is cached until `setVersion` / `refresh` /
 * `__setOverride` re-runs it. The cached snapshot object is replaced only when
 * resolution actually re-runs, so React's `useSyncExternalStore` sees a stable
 * reference (see `createHostHooks`).
 */

import type { BridgePlatform } from "../types";
import {
  type CompiledCapability,
  type CompiledVariant,
  evaluateCapability,
  evaluateVariant,
  type ResolvedHost,
  resolveHost,
} from "./resolve";
import { type HostVersionSource, versionFromQuery } from "./sources";
import type {
  CapabilityRule,
  HostInfo,
  HostOverride,
  HostRules,
  HostRulesConfig,
  HostServerSnapshot,
  PlatformSelect,
  VariantDef,
  VariantName,
  VariantValue,
} from "./types";
import { type Constraint, parseConstraints } from "./version";

function compileCapabilities(
  capabilities: Record<string, CapabilityRule>,
): Record<string, CompiledCapability> {
  const compiled: Record<string, CompiledCapability> = {};

  for (const [name, rule] of Object.entries(capabilities)) {
    const perPlatform: CompiledCapability = {};
    for (const [platform, value] of Object.entries(rule) as Array<
      [BridgePlatform, boolean | string | string[] | undefined]
    >) {
      // An explicit `undefined` is treated the same as an absent key: the
      // capability is off on that platform (fail-safe — a missing flag never
      // silently enables a capability). Skipping also avoids feeding
      // `undefined` into the constraint parser.
      if (value === undefined) continue;
      if (typeof value === "boolean") {
        perPlatform[platform] = { kind: "bool", value };
        continue;
      }
      const constraints = parseConstraints(value);
      if (constraints === null) {
        throw new Error(
          `[nbridge] Invalid version constraint in capability "${name}" for platform "${platform}": ${JSON.stringify(value)}`,
        );
      }
      perPlatform[platform] = { kind: "constraints", constraints };
    }
    compiled[name] = perPlatform;
  }

  return compiled;
}

function compileVariants(
  variants: Record<string, VariantDef>,
): Record<string, CompiledVariant> {
  const compiled: Record<string, CompiledVariant> = {};

  for (const [name, def] of Object.entries(variants)) {
    const rules = def.rules.map((rule, index) => {
      const { platform, version } = rule.when;
      if (platform === undefined && version === undefined) {
        throw new Error(
          `[nbridge] Variant "${name}" rule #${index} has an empty \`when\` clause — provide at least one of \`platform\` or \`version\`.`,
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

      return { platform, constraints, use: rule.use };
    });
    compiled[name] = { rules, default: def.default };
  }

  return compiled;
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
  };
}

/**
 * The conservative state the server resolves to (see `resolveHost`'s server
 * branch): platform `"web"`, version unknown. Capabilities and variants are
 * evaluated against this to build the SSR snapshot, so hydration matches.
 */
const SERVER_HOST: ResolvedHost = {
  platform: "web",
  version: null,
  versionRaw: null,
  parsed: null,
  isNative: false,
};

/**
 * Define an app's Host Rules. Call once at module scope in a per-app config
 * file. Malformed version constraints and empty `when` clauses throw here —
 * fail fast at boot, not silently at evaluation.
 */
export function defineHostRules<
  const TCaps extends Record<string, CapabilityRule>,
  const TVariants extends Record<string, VariantDef>,
>(config: HostRulesConfig<TCaps, TVariants>): HostRules<TCaps, TVariants> {
  const compiledCapabilities = compileCapabilities(config.capabilities ?? {});
  const compiledVariants = compileVariants(config.variants ?? {});
  const androidInterface = config.platform?.androidInterface;
  const iosHandler = config.platform?.iosHandler;
  const versionSource = resolveVersionSource(config.version);

  let resolved: ResolvedHost | null = null;
  let info: HostInfo | null = null;
  let serverSnapshot: HostServerSnapshot | null = null;
  let explicitVersion: string | null = null;
  let override: HostOverride | null = null;
  const listeners = new Set<() => void>();

  function compute(): void {
    resolved = resolveHost({
      androidInterface,
      iosHandler,
      versionSource,
      explicitVersion,
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

  const engine: HostRules<TCaps, TVariants> = {
    supports(name) {
      const capability = compiledCapabilities[name];
      if (capability === undefined) return false;
      return evaluateCapability(capability, current());
    },

    variant<K extends VariantName<TVariants>>(
      name: K,
    ): VariantValue<TVariants[K]> {
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
        serverSnapshot = { info: toInfo(SERVER_HOST), supports, variants };
      }
      return serverSnapshot;
    },
  };

  return engine;
}
