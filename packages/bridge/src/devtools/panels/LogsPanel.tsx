"use client";

import { useEffect, useRef, useState } from "react";
import type { DevToolsLog, LogLevel } from "../../types";
import {
  AlertCircleIcon as AlertCircle,
  AlertTriangleIcon as AlertTriangle,
  InfoIcon as Info,
  MessageSquareIcon as MessageSquare,
  SearchIcon as Search,
  TrashIcon as Trash2,
} from "../components/icons";

const LOG_LEVEL_CONFIG: Record<
  LogLevel,
  { icon: React.ElementType; color: string; bgColor: string; label: string }
> = {
  log: {
    icon: MessageSquare,
    color: "text-gray-400",
    bgColor: "bg-gray-800/50",
    label: "Log",
  },
  info: {
    icon: Info,
    color: "text-blue-400",
    bgColor: "bg-blue-950/30",
    label: "Info",
  },
  warn: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bgColor: "bg-yellow-950/30",
    label: "Warning",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-400",
    bgColor: "bg-red-950/30",
    label: "Error",
  },
};

type LogSourceTab = "bridge" | "console";

export function LogsPanel() {
  const [logs, setLogs] = useState<DevToolsLog[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<LogSourceTab>("bridge");
  const [filterLevel, setFilterLevel] = useState<LogLevel | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLogsEnabled, setIsLogsEnabled] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateLogs = () => {
      if (typeof window !== "undefined" && window.__BRIDGE_DEVTOOLS__) {
        const allLogs = window.__BRIDGE_DEVTOOLS__.getLogs();
        setLogs(allLogs);
        setIsLogsEnabled(true);
      } else {
        setIsLogsEnabled(false);
      }
    };

    updateLogs();

    const interval = setInterval(updateLogs, 500);
    return () => clearInterval(interval);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll must re-run when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleClear = () => {
    if (typeof window !== "undefined" && window.__BRIDGE_DEVTOOLS__) {
      window.__BRIDGE_DEVTOOLS__.clearLogs();
      setLogs([]);
    }
  };

  const handleScroll = () => {
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (autoScroll && !isAtBottom) {
      setAutoScroll(false);
    } else if (!autoScroll && isAtBottom) {
      setAutoScroll(true);
    }
  };

  const formatMessage = (message: unknown[]): string => {
    return message
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object") return JSON.stringify(item, null, 2);
        return String(item);
      })
      .join(" ");
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSource = log.source === activeLogTab;
    const matchesLevel = filterLevel === "all" || log.level === filterLevel;
    const messageText = formatMessage(log.message).toLowerCase();
    const matchesSearch =
      !searchTerm || messageText.includes(searchTerm.toLowerCase());

    return matchesSource && matchesLevel && matchesSearch;
  });

  if (!isLogsEnabled || (logs.length === 0 && !window.__BRIDGE_DEVTOOLS__)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle className="h-12 w-12 text-yellow-400 mx-auto" />
          <p className="text-sm text-gray-300 font-medium">
            Logs are not active
          </p>
          <p className="text-xs text-gray-400">
            To see logs in DevTools, update your bridge configuration:
          </p>
          <pre className="text-xs text-left text-gray-300 bg-gray-900 rounded p-3 overflow-x-auto">
            {`<BridgeProvider
  config={{
    debug: true,
    devTools: {
      enabled: true,
      logDestination: "devtools" // or "both"
    }
  }}
>
  <App />
</BridgeProvider>`}
          </pre>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-400">No logs yet</p>
          <p className="text-xs text-gray-500">
            Logs will appear here as bridge operations occur
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Log Source Tabs */}
      <div className="flex border-b border-gray-700 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveLogTab("bridge")}
          className={`
            px-4 py-2 text-sm font-medium transition-colors
            ${
              activeLogTab === "bridge"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }
          `}
        >
          Bridge Logs
        </button>
        <button
          type="button"
          onClick={() => setActiveLogTab("console")}
          className={`
            px-4 py-2 text-sm font-medium transition-colors
            ${
              activeLogTab === "console"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }
          `}
        >
          Console Logs
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search logs..."
            className="w-full rounded-md border border-gray-600 bg-gray-800 pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value as typeof filterLevel)}
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Levels</option>
          <option value="log">Log</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>

        <button
          type="button"
          onClick={() => setAutoScroll(!autoScroll)}
          className={`rounded-md px-3 py-2 text-sm flex items-center gap-2 ${
            autoScroll
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
          title={autoScroll ? "Auto-scroll enabled" : "Auto-scroll disabled"}
        >
          Auto
        </button>

        <button
          type="button"
          onClick={handleClear}
          className="rounded-md bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
          title="Clear logs"
        >
          <Trash2 className="h-4 w-4" />
          Clear
        </button>
      </div>

      {/* Logs List */}
      <div
        ref={logsContainerRef}
        onScroll={handleScroll}
        className="flex-1 space-y-1 overflow-y-auto pr-2"
        style={{ maxHeight: "calc(60vh - 150px)" }}
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400">No matching logs</p>
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const config = LOG_LEVEL_CONFIG[log.level];
            const Icon = config.icon;
            const messageText = formatMessage(log.message);

            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: log entries have no id; list is append-only within a poll cycle
                key={`${log.timestamp}-${index}`}
                className={`rounded-md border border-gray-700 ${config.bgColor} p-3 font-mono text-xs`}
              >
                <div className="flex items-start gap-3">
                  {/* Level Icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon className={`h-4 w-4 ${config.color}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${config.color} bg-gray-900/50`}
                      >
                        {config.label.toUpperCase()}
                      </span>
                      <span className="text-gray-500">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                    <div className="text-gray-200 whitespace-pre-wrap break-words">
                      {messageText}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-500 text-center flex-shrink-0">
        Showing {filteredLogs.length} of {logs.length} logs
        {autoScroll && " • Auto-scroll enabled"}
      </div>
    </div>
  );
}
