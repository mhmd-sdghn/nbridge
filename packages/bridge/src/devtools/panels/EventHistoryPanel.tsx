"use client";

import { useEffect, useState } from "react";
import type { DevToolsMessage } from "../../types";
import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  SearchIcon as Search,
  TrashIcon as Trash2,
} from "../components/icons";

export function EventHistoryPanel() {
  const [messages, setMessages] = useState<DevToolsMessage[]>([]);
  const [filterDirection, setFilterDirection] = useState<
    "all" | "sent" | "received"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const updateMessages = () => {
      if (typeof window !== "undefined" && window.__BRIDGE_DEVTOOLS__) {
        // Already bounded by the configured maxMessageHistory
        const allMessages = window.__BRIDGE_DEVTOOLS__.getMessages();
        // getMessages() returns a fresh array each tick; only re-render on an
        // actual change (length + last message id) rather than every 500ms.
        setMessages((prev) => {
          // prev is stored reversed, so prev[0] is the newest message.
          const last = allMessages[allMessages.length - 1];
          const prevNewest = prev[0];
          if (
            prev.length === allMessages.length &&
            last?.__devtools.timestamp === prevNewest?.__devtools.timestamp
          ) {
            return prev;
          }
          return [...allMessages].reverse();
        });
      }
    };

    updateMessages();

    const interval = setInterval(updateMessages, 500);
    return () => clearInterval(interval);
  }, []);

  const handleClear = () => {
    if (typeof window !== "undefined" && window.__BRIDGE_DEVTOOLS__) {
      window.__BRIDGE_DEVTOOLS__.clear();
      setMessages([]);
    }
  };

  const toggleExpanded = (messageId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const filteredMessages = messages.filter((msg) => {
    const matchesDirection =
      filterDirection === "all" || msg.__devtools.direction === filterDirection;

    const matchesSearch =
      !searchTerm || msg.type.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesDirection && matchesSearch;
  });

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-400">No events yet</p>
          <p className="text-xs text-gray-500">
            Events will appear here as they are sent or received
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search event type..."
            className="w-full rounded-md border border-gray-600 bg-gray-800 pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={filterDirection}
          onChange={(e) =>
            setFilterDirection(e.target.value as typeof filterDirection)
          }
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All</option>
          <option value="sent">Sent</option>
          <option value="received">Received</option>
        </select>

        <button
          type="button"
          onClick={handleClear}
          className="rounded-md bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
          title="Clear history"
        >
          <Trash2 className="h-4 w-4" />
          Clear
        </button>
      </div>

      {/* Event List */}
      <div className="space-y-2 max-h-[calc(60vh-200px)] overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400">No matching events</p>
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const messageId =
              msg.id || `${msg.type}-${msg.__devtools.timestamp}`;
            const isExpanded = expandedMessages.has(messageId);
            const isSent = msg.__devtools.direction === "sent";

            return (
              <div
                key={messageId}
                className={`
                  rounded-md border bg-gray-800/50 overflow-hidden
                  ${isSent ? "border-l-4 border-l-blue-500" : "border-l-4 border-l-green-500"}
                  ${!isSent && "border-gray-700"}
                `}
              >
                {/* Header */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(messageId)}
                  className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-800/80 transition-colors text-left"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isSent ? (
                        <ArrowUp className="h-4 w-4 text-blue-400" />
                      ) : (
                        <ArrowDown className="h-4 w-4 text-green-400" />
                      )}
                      <span className="font-medium text-gray-200 text-sm">
                        {msg.type}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(msg.__devtools.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-700">
                    <div className="grid grid-cols-2 gap-3 pt-3">
                      <div>
                        <div className="text-xs font-medium text-gray-400 mb-1">
                          Direction
                        </div>
                        <div className="text-sm text-gray-200">
                          {isSent ? "Sent (outgoing)" : "Received (incoming)"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-gray-400 mb-1">
                          Timestamp
                        </div>
                        <div className="text-sm text-gray-200">
                          {new Date(msg.__devtools.timestamp).toLocaleString()}
                        </div>
                      </div>
                      {msg.id && (
                        <div className="col-span-2">
                          <div className="text-xs font-medium text-gray-400 mb-1">
                            Message ID
                          </div>
                          <div className="text-sm text-gray-200 font-mono">
                            {msg.id}
                          </div>
                        </div>
                      )}
                    </div>

                    {msg.payload !== undefined && (
                      <div>
                        <div className="text-xs font-medium text-gray-400 mb-1">
                          Payload
                        </div>
                        <pre className="text-xs text-gray-200 bg-gray-900 rounded p-3 overflow-x-auto">
                          {JSON.stringify(msg.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-500 text-center">
        Showing {filteredMessages.length} of {messages.length} events
      </div>
    </div>
  );
}
