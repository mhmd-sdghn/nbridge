"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type {
  CapabilityName,
  CapabilityRule,
  HostInfo,
  HostRules,
  PlatformSelect,
  TraitName,
  TraitsConfig,
  TraitValue,
  VariantDef,
  VariantName,
  VariantValue,
} from "../host/types";
import type { BridgePlatform } from "../types";

/** Props for the `CapabilityGate` component. */
export interface CapabilityGateProps<Cap extends string> {
  capability: Cap;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Props for the `PlatformOnly` component. */
export interface PlatformOnlyProps {
  platforms: BridgePlatform[];
  children: ReactNode;
  fallback?: ReactNode;
}

/** Props for the `VariantSwitch` component. */
export interface VariantSwitchProps<K extends string, Value extends string> {
  name: K;
  cases: Partial<Record<Value, ReactNode>>;
  fallback?: ReactNode;
}

/**
 * Create React bindings for a Host Rules engine. Parallel to
 * `createBridgeHooks` — the engine is independent of any bridge instance, so
 * this is a separate factory. Call once per app, at module scope.
 *
 * All hooks read through `useSyncExternalStore(host.subscribe, ...)`, so they
 * re-render when `setVersion` / `refresh` / `__setOverride` re-resolve. The
 * engine caches its resolved snapshot, so `useHostInfo`'s getSnapshot returns a
 * stable reference (no "getSnapshot should be cached" loop).
 *
 * `getServerSnapshot` reads `host.__serverSnapshot()` — the engine's cached,
 * conservative (`web` / version-unknown) view — for all three hooks. This is
 * exactly what the server rendered, so client hydration never disagrees with
 * the server markup regardless of the query/version source.
 *
 * @example
 * // src/lib/host-hooks.ts
 * import { createHostHooks } from "nbridge/react";
 * import { host } from "./host-rules";
 * export const { useCapability, CapabilityGate } = createHostHooks(host);
 */
export function createHostHooks<
  TTraits extends TraitsConfig = TraitsConfig,
  TCaps extends Record<string, CapabilityRule> = Record<string, CapabilityRule>,
  TVariants extends Record<string, VariantDef> = Record<string, VariantDef>,
>(host: HostRules<TTraits, TCaps, TVariants>) {
  type Cap = CapabilityName<TCaps>;

  /** The resolved host state, reactive to re-resolution. */
  function useHostInfo(): HostInfo {
    return useSyncExternalStore(
      host.subscribe,
      () => host.info(),
      () => host.__serverSnapshot().info,
    );
  }

  /** Whether a capability is enabled, reactive to re-resolution. */
  function useCapability(name: Cap): boolean {
    return useSyncExternalStore(
      host.subscribe,
      () => host.supports(name),
      () => host.__serverSnapshot().supports[name] ?? false,
    );
  }

  /** The resolved value of a variant, reactive to re-resolution. */
  function useVariant<K extends VariantName<TVariants>>(
    name: K,
  ): VariantValue<TVariants[K]> {
    return useSyncExternalStore(
      host.subscribe,
      () => host.variant(name),
      () =>
        host.__serverSnapshot().variants[name] as VariantValue<TVariants[K]>,
    );
  }

  /** The resolved value of a trait (or `null` when unknown), reactive. Typed to
   * the trait's declared `values` domain (if any). */
  function useTrait<K extends TraitName<TTraits>>(
    name: K,
  ): TraitValue<TTraits[K]> | null {
    return useSyncExternalStore(
      host.subscribe,
      () => (host.info().traits[name] ?? null) as TraitValue<TTraits[K]> | null,
      () =>
        (host.__serverSnapshot().info.traits[name] ?? null) as TraitValue<
          TTraits[K]
        > | null,
    );
  }

  /**
   * Pick a per-platform value, reactive to re-resolution. The reactive
   * counterpart of `host.select()` (which is a one-shot read); use this in a
   * component body so the value updates on `__setOverride`/`refresh`.
   */
  function useSelect<T>(map: PlatformSelect<T>): T {
    const { platform } = useHostInfo();
    const value = map[platform];
    return value !== undefined ? value : map.default;
  }

  /** Render `children` when a capability is enabled, else `fallback`. */
  function CapabilityGate({
    capability,
    children,
    fallback = null,
  }: CapabilityGateProps<Cap>) {
    return <>{useCapability(capability) ? children : fallback}</>;
  }

  /** Render `children` only on the listed platforms, else `fallback`. */
  function PlatformOnly({
    platforms,
    children,
    fallback = null,
  }: PlatformOnlyProps) {
    const { platform } = useHostInfo();
    return <>{platforms.includes(platform) ? children : fallback}</>;
  }

  /** Render the case matching the resolved variant value, else `fallback`. */
  function VariantSwitch<K extends VariantName<TVariants>>({
    name,
    cases,
    fallback = null,
  }: VariantSwitchProps<K, VariantValue<TVariants[K]>>) {
    const value = useVariant(name);
    return <>{cases[value] ?? fallback}</>;
  }

  return {
    useHostInfo,
    useCapability,
    useVariant,
    useTrait,
    useSelect,
    CapabilityGate,
    PlatformOnly,
    VariantSwitch,
  };
}
