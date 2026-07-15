"use client";

import { useEffect, useReducer, useState } from "react";
import type { HostOverride, HostRules } from "../../host/types";
import type { BridgePlatform } from "../../types";

interface HostPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: the panel is agnostic to the app's capability/variant names
  host: HostRules<any, any>;
}

const PLATFORMS: BridgePlatform[] = ["android", "ios", "iframe", "web"];

/**
 * DevTools panel for the Host Rules engine: shows the resolved platform,
 * version (raw + parsed), and every capability/variant with its resolved
 * value. The override controls are the dev-only exception to "detection wins" —
 * they let QA preview any host combination in a desktop browser via
 * `host.__setOverride()`.
 */
export function HostPanel({ host }: HostPanelProps) {
  // Re-render whenever resolution changes (setVersion / refresh / override).
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => host.subscribe(() => forceUpdate()), [host]);

  const [overridePlatform, setOverridePlatform] = useState<BridgePlatform | "">(
    "",
  );
  const [overrideVersion, setOverrideVersion] = useState("");
  const [overrideTraits, setOverrideTraits] = useState<Record<string, string>>(
    {},
  );

  const info = host.info();
  const { capabilities, variants, traits } = host.__introspect();

  const applyOverride = () => {
    const override: HostOverride = {};
    if (overridePlatform) override.platform = overridePlatform;
    if (overrideVersion.trim()) override.version = overrideVersion.trim();
    const traitOverride: Record<string, string> = {};
    for (const [name, value] of Object.entries(overrideTraits)) {
      if (value.trim()) traitOverride[name] = value.trim();
    }
    if (Object.keys(traitOverride).length > 0) override.traits = traitOverride;
    host.__setOverride(Object.keys(override).length > 0 ? override : null);
  };

  const resetOverride = () => {
    setOverridePlatform("");
    setOverrideVersion("");
    setOverrideTraits({});
    host.__setOverride(null);
  };

  const setTraitOverride = (name: string, value: string) =>
    setOverrideTraits((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="space-y-6">
      {/* Resolved host state */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">Resolved Host</h3>
        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Platform" value={info.platform} />
            <Field label="Native" value={info.isNative ? "yes" : "no"} />
            <Field label="Version (parsed)" value={info.version ?? "unknown"} />
            <Field label="Version (raw)" value={info.versionRaw ?? "—"} />
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <Section title="Capabilities">
        {capabilities.length === 0 ? (
          <Empty label="No capabilities defined." />
        ) : (
          <ul className="divide-y divide-gray-700">
            {capabilities.map((name) => (
              <Row key={name} name={name} value={host.supports(name)} />
            ))}
          </ul>
        )}
      </Section>

      {/* Variants */}
      <Section title="Variants">
        {variants.length === 0 ? (
          <Empty label="No variants defined." />
        ) : (
          <ul className="divide-y divide-gray-700">
            {variants.map((name) => (
              <Row key={name} name={name} value={host.variant(name)} />
            ))}
          </ul>
        )}
      </Section>

      {/* Traits (only when the config declares any) */}
      {traits.length > 0 && (
        <Section title="Traits">
          <ul className="divide-y divide-gray-700">
            {traits.map(({ name }) => (
              <Row
                key={name}
                name={name}
                value={info.traits[name] ?? "unknown"}
              />
            ))}
          </ul>
        </Section>
      )}

      {/* Dev override controls */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">
          Override <span className="text-xs text-gray-500">(dev only)</span>
        </h3>
        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">Platform</span>
              <select
                value={overridePlatform}
                onChange={(e) =>
                  setOverridePlatform(e.target.value as BridgePlatform | "")
                }
                className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
              >
                <option value="">(detected)</option>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">Version</span>
              <input
                type="text"
                value={overrideVersion}
                onChange={(e) => setOverrideVersion(e.target.value)}
                placeholder="e.g. 9.2.0"
                className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
              />
            </label>
          </div>
          {traits.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {traits.map((trait) => {
                const id = `host-trait-${trait.name}`;
                return (
                  <label className="block" key={trait.name} htmlFor={id}>
                    <span className="text-xs text-gray-400 mb-1 block">
                      {trait.name}
                    </span>
                    {trait.values ? (
                      <select
                        id={id}
                        value={overrideTraits[trait.name] ?? ""}
                        onChange={(e) =>
                          setTraitOverride(trait.name, e.target.value)
                        }
                        className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
                      >
                        <option value="">(unset)</option>
                        {trait.values.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        type="text"
                        value={overrideTraits[trait.name] ?? ""}
                        onChange={(e) =>
                          setTraitOverride(trait.name, e.target.value)
                        }
                        className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyOverride}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={resetOverride}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-600"
            >
              Reset
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Overrides bypass bridge detection so you can preview any host in a
            desktop browser. Never used in production.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-200">{value}</div>
    </div>
  );
}

function Row({ name, value }: { name: string; value: boolean | string }) {
  const isBool = typeof value === "boolean";
  const display = isBool ? (value ? "enabled" : "disabled") : value;
  const colorClass = isBool
    ? value
      ? "text-green-400"
      : "text-gray-500"
    : "text-blue-400";

  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-300 font-mono">{name}</span>
      <span className={`text-sm font-semibold ${colorClass}`}>{display}</span>
    </li>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-gray-500">{label}</p>;
}
