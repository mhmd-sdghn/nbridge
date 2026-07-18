"use client";

import { useEffect, useState } from "react";
import type { BatchStats, BridgeMetrics, QueueStats } from "../../types";

export function MetricsPanel() {
  const [metrics, setMetrics] = useState<BridgeMetrics | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [batchStats, setBatchStats] = useState<BatchStats | null>(null);
  const [featuresEnabled, setFeaturesEnabled] = useState({
    metrics: false,
    queue: false,
    batch: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Poll unconditionally so the panel recovers if the bridge (and its
    // devtools API) is not ready at mount, or a config/feature toggle happens
    // later — instead of one-shot returning early and staying blank forever.
    const tick = () => {
      const api = window.__BRIDGE_DEVTOOLS__;
      if (!api) return;

      const config = api.getConfig();
      const enabledFeatures = {
        metrics: config.metrics?.enabled ?? false,
        queue: config.queue?.enabled ?? false,
        batch: config.batching?.enabled ?? false,
      };
      setFeaturesEnabled(enabledFeatures);

      if (enabledFeatures.metrics) setMetrics(api.getMetrics());
      if (enabledFeatures.queue) setQueueStats(api.getQueueStats());
      if (enabledFeatures.batch) setBatchStats(api.getBatchStats());
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Performance Metrics */}
      {!featuresEnabled.metrics ? (
        <div className="rounded-md bg-gray-800 border border-yellow-600 px-4 py-3">
          <p className="text-sm font-semibold text-yellow-400 mb-1">
            Metrics Disabled
          </p>
          <p className="text-xs text-gray-300">
            Set{" "}
            <code className="px-1 py-0.5 rounded bg-gray-900 text-blue-400">
              metrics.enabled: true
            </code>{" "}
            in your bridge configuration to see performance metrics.
          </p>
        </div>
      ) : metrics ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            Performance Metrics
          </h3>
          <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <MetricItem label="Messages Sent" value={metrics.messagesSent} />
              <MetricItem
                label="Messages Received"
                value={metrics.messagesReceived}
              />
              <MetricItem
                label="Messages Failed"
                value={metrics.messagesFailed}
                variant={metrics.messagesFailed > 0 ? "warning" : "default"}
              />
              <MetricItem
                label="Timeouts"
                value={metrics.timeouts}
                variant={metrics.timeouts > 0 ? "warning" : "default"}
              />
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-300">
                    Average Response Time
                  </span>
                  <span className="text-sm text-gray-400">
                    {metrics.averageResponseTime.toFixed(0)}ms
                  </span>
                </div>
                <ProgressBar
                  value={Math.min(metrics.averageResponseTime / 10, 100)}
                  color="blue"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-300">
                    Success Rate
                  </span>
                  <span className="text-sm text-gray-400">
                    {(metrics.successRate * 100).toFixed(1)}%
                  </span>
                </div>
                <ProgressBar
                  value={metrics.successRate * 100}
                  color={metrics.successRate > 0.9 ? "green" : "yellow"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-700">
              <MetricItem
                label="Messages/Second"
                value={metrics.messagesPerSecond.toFixed(1)}
              />
              <MetricItem
                label="Peak Messages/Second"
                value={metrics.peakMessagesPerSecond.toFixed(1)}
              />
              <MetricItem
                label="Bytes Sent"
                value={formatBytes(metrics.bytesSent)}
              />
              <MetricItem
                label="Bytes Received"
                value={formatBytes(metrics.bytesReceived)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Queue Statistics */}
      {!featuresEnabled.queue ? (
        <div className="rounded-md bg-gray-800 border border-yellow-600 px-4 py-3">
          <p className="text-sm font-semibold text-yellow-400 mb-1">
            Queue Stats Disabled
          </p>
          <p className="text-xs text-gray-300">
            Set{" "}
            <code className="px-1 py-0.5 rounded bg-gray-900 text-blue-400">
              queue.enabled: true
            </code>{" "}
            in your bridge configuration to see queue statistics.
          </p>
        </div>
      ) : queueStats ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            Queue Statistics
          </h3>
          <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4">
            <div className="grid grid-cols-2 gap-4">
              <MetricItem
                label="Queue Size"
                value={queueStats.size}
                variant={queueStats.size > 0 ? "info" : "default"}
              />
              <MetricItem
                label="Pending"
                value={queueStats.pending}
                variant={queueStats.pending > 0 ? "info" : "default"}
              />
              <MetricItem
                label="Failed"
                value={queueStats.failed}
                variant={queueStats.failed > 0 ? "error" : "default"}
              />
              <MetricItem label="Completed" value={queueStats.completed} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Batch Statistics */}
      {!featuresEnabled.batch ? (
        <div className="rounded-md bg-gray-800 border border-yellow-600 px-4 py-3">
          <p className="text-sm font-semibold text-yellow-400 mb-1">
            Batch Stats Disabled
          </p>
          <p className="text-xs text-gray-300">
            Set{" "}
            <code className="px-1 py-0.5 rounded bg-gray-900 text-blue-400">
              batching.enabled: true
            </code>{" "}
            in your bridge configuration to see batch statistics.
          </p>
        </div>
      ) : batchStats ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            Batch Statistics
          </h3>
          <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4">
            <div className="grid grid-cols-2 gap-4">
              <MetricItem
                label="Pending"
                value={batchStats.pending}
                variant={batchStats.pending > 0 ? "info" : "default"}
              />
              <MetricItem label="Sent" value={batchStats.sent} />
              <MetricItem
                label="Failed"
                value={batchStats.failed}
                variant={batchStats.failed > 0 ? "error" : "default"}
              />
              <MetricItem
                label="Total Batches"
                value={batchStats.totalBatches}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface MetricItemProps {
  label: string;
  value: string | number;
  variant?: "default" | "info" | "warning" | "error";
}

function MetricItem({ label, value, variant = "default" }: MetricItemProps) {
  const valueColorClass = {
    default: "text-gray-200",
    info: "text-blue-400",
    warning: "text-yellow-400",
    error: "text-red-400",
  }[variant];

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${valueColorClass}`}>{value}</div>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  color: "blue" | "green" | "yellow";
}

function ProgressBar({ value, color }: ProgressBarProps) {
  const colorClass = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    yellow: "bg-yellow-500",
  }[color];

  return (
    <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
      <div
        className={`h-full ${colorClass} transition-all duration-300`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}
