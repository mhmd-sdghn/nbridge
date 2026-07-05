"use client";

import { useState } from "react";
import type { BridgeManager } from "../../core/BridgeManager";
import { EventHistoryPanel } from "../panels/EventHistoryPanel";
import { LogsPanel } from "../panels/LogsPanel";
import { MetricsPanel } from "../panels/MetricsPanel";
import { SendEventPanel } from "../panels/SendEventPanel";
import { XIcon } from "./icons";

interface DevToolsPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: BridgeManager can have any schema type
  bridge: BridgeManager<any>;
  onClose: () => void;
}

type TabType = "logs" | "send" | "history" | "metrics";

const TABS: Array<{ id: TabType; label: string }> = [
  { id: "logs", label: "Logs" },
  { id: "send", label: "Send Event" },
  { id: "history", label: "History" },
  { id: "metrics", label: "Metrics" },
];

export function DevToolsPanel({ bridge, onClose }: DevToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("logs");
  const platformInfo = bridge.getPlatform();

  return (
    <div
      dir="ltr"
      style={{ direction: "ltr" }}
      role="dialog"
      aria-modal="false"
      aria-label="Bridge DevTools"
      className="fixed bottom-0 left-0 right-0 z-[9998] flex h-[60vh] min-h-[200px] max-h-[90vh] flex-col rounded-t-xl border-t border-gray-700 bg-gray-900 text-white shadow-2xl"
    >
      {/* Header with resize handle */}
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-1 w-12 rounded-full bg-gray-600" />
          <h2 className="text-sm font-semibold text-gray-200">
            Bridge DevTools
          </h2>
          <span className="rounded-md bg-blue-900/50 px-2 py-1 text-xs font-medium text-blue-300 border border-blue-700">
            {platformInfo.platform}
            {platformInfo.isNative && " (native)"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
          aria-label="Close DevTools"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-6 py-3 text-sm font-medium transition-colors
              ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-gray-200"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "send" && <SendEventPanel bridge={bridge} />}
        {activeTab === "history" && <EventHistoryPanel />}
        {activeTab === "metrics" && <MetricsPanel />}
      </div>
    </div>
  );
}
