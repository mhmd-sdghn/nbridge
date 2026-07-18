"use client";

import { useState } from "react";
import type { BridgeManager } from "../../core/BridgeManager";
import { formatIssues } from "../../core/validate";
import type { MessageSchema } from "../../types/schema";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  SearchIcon,
} from "../components/icons";

interface SendEventPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: BridgeManager can have any schema type
  bridge: BridgeManager<any>;
}

function stringifyExample(schema: MessageSchema | null): string {
  if (schema?.example !== undefined) {
    return JSON.stringify(schema.example, null, 2);
  }
  return "{}";
}

export function SendEventPanel({ bridge }: SendEventPanelProps) {
  const [mode, setMode] = useState<"predefined" | "custom">("predefined");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("{}");
  const [customEventType, setCustomEventType] = useState("");
  const [customPayload, setCustomPayload] = useState("{}");
  const [customAwaitResponse, setCustomAwaitResponse] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{
    type: "success" | "error";
    data: unknown;
  } | null>(null);

  const schemas = bridge.getAllSchemas() as
    | Record<string, MessageSchema>
    | undefined;

  const schemaEntries = schemas ? Object.entries(schemas) : [];

  const sendableSchemas = schemaEntries.filter(([_type, schema]) => {
    const direction = schema.direction;
    return (
      !direction || direction === "outgoing" || direction === "bidirectional"
    );
  });

  const filteredSchemas = sendableSchemas.filter(([type]) =>
    type.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const selectedSchema =
    selectedEvent && schemas ? (schemas[selectedEvent] ?? null) : null;

  function parsePayload(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Keep the parser's position detail (e.g. "...at position 42") so a long
      // payload is fixable, instead of a bare "Invalid JSON payload".
      throw new Error(
        `Invalid JSON payload: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const handleSendEvent = async () => {
    if (!selectedEvent) return;

    setIsLoading(true);
    setResponse(null);

    try {
      const payload = parsePayload(payloadText);

      // Pre-validate with the registered Standard Schema (works with any
      // compliant validator) so issues render inline instead of as a throw.
      const payloadSchema = selectedSchema?.payloadSchema;
      if (payloadSchema) {
        let result = payloadSchema["~standard"].validate(payload);
        if (result instanceof Promise) result = await result;
        if (result.issues) {
          setResponse({
            type: "error",
            data: `Payload validation failed: ${formatIssues(result.issues)}`,
          });
          return;
        }
      }

      const hasResponse = selectedSchema?.responseSchema !== undefined;

      if (hasResponse) {
        const result = await bridge.sendWithResponse(selectedEvent, payload);
        setResponse({ type: "success", data: result });
      } else {
        await bridge.send(selectedEvent, payload);
        setResponse({ type: "success", data: "Event sent successfully" });
      }
    } catch (error) {
      setResponse({
        type: "error",
        data: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendCustomEvent = async () => {
    if (!customEventType.trim()) return;

    setIsLoading(true);
    setResponse(null);

    try {
      const payload = parsePayload(customPayload);

      if (customAwaitResponse) {
        const result = await bridge.sendWithResponse(customEventType, payload);
        setResponse({ type: "success", data: result });
      } else {
        await bridge.send(customEventType, payload);
        setResponse({ type: "success", data: "Event sent successfully" });
      }
    } catch (error) {
      setResponse({
        type: "error",
        data: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const hasSchemas = Boolean(schemas) && schemaEntries.length > 0;
  const hasSendableEvents = sendableSchemas.length > 0;

  const showModeSelector = hasSchemas && hasSendableEvents;
  const defaultToCustomMode = !hasSendableEvents;

  return (
    <div className="space-y-6">
      {showModeSelector && (
        <div
          className="flex gap-2 border-b border-gray-700"
          role="tablist"
          aria-label="Send event mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "predefined"}
            onClick={() => {
              setMode("predefined");
              setResponse(null);
            }}
            className={`
              px-4 py-2 text-sm font-medium transition-colors
              ${
                mode === "predefined"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-gray-400 hover:text-gray-300"
              }
            `}
          >
            Predefined Events (Schema)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "custom"}
            onClick={() => {
              setMode("custom");
              setResponse(null);
            }}
            className={`
              px-4 py-2 text-sm font-medium transition-colors
              ${
                mode === "custom"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-gray-400 hover:text-gray-300"
              }
            `}
          >
            Custom Event
          </button>
        </div>
      )}

      {/* Predefined Events Mode */}
      {mode === "predefined" && !defaultToCustomMode && (
        <>
          {/* Event Selector */}
          <div className="space-y-2">
            <label
              htmlFor="event-search"
              className="block text-sm font-medium text-gray-300"
            >
              Select Event
            </label>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                id="event-search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search events..."
                className="w-full rounded-md border border-gray-600 bg-gray-800 pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="max-h-40 overflow-y-auto rounded-md border border-gray-600 bg-gray-800">
              {filteredSchemas.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">
                  {sendableSchemas.length === 0
                    ? "No sendable events found (only outgoing/bidirectional events can be sent)"
                    : "No events match your search"}
                </div>
              ) : (
                filteredSchemas.map(([type, schema]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedEvent(type);
                      setPayloadText(stringifyExample(schema));
                      setResponse(null);
                    }}
                    className={`
                        w-full px-3 py-2 text-left text-sm transition-colors
                        ${
                          selectedEvent === type
                            ? "bg-blue-600 text-white"
                            : "text-gray-300 hover:bg-gray-700"
                        }
                      `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{type}</div>
                      {schema.direction && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                          {schema.direction}
                        </span>
                      )}
                    </div>
                    {schema.description && (
                      <div className="text-xs opacity-80">
                        {schema.description}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Selected Event Details */}
          {selectedSchema && (
            <div className="space-y-4">
              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-200">
                  {selectedEvent}
                </h3>
                {selectedSchema.description && (
                  <p className="text-xs text-gray-400">
                    {selectedSchema.description}
                  </p>
                )}
                {selectedSchema.direction && (
                  <div className="flex items-center gap-2">
                    <ArrowRightIcon className="h-3 w-3 text-gray-500" />
                    <span className="text-xs text-gray-500">
                      Direction: {selectedSchema.direction}
                    </span>
                  </div>
                )}
                {selectedSchema.payloadSchema && (
                  <span className="text-xs text-gray-500">
                    Validated by{" "}
                    {selectedSchema.payloadSchema["~standard"].vendor} before
                    sending
                  </span>
                )}
              </div>

              {/* Payload editor */}
              <div className="space-y-2">
                <label
                  htmlFor="predefined-payload"
                  className="block text-sm font-medium text-gray-300"
                >
                  Payload (JSON)
                </label>
                <textarea
                  id="predefined-payload"
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleSendEvent}
                  disabled={isLoading}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading
                    ? "Sending..."
                    : selectedSchema.responseSchema
                      ? "Send & Await Response"
                      : "Send Event"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom Event Mode */}
      {(mode === "custom" || defaultToCustomMode) && (
        <div className="space-y-4">
          {defaultToCustomMode && !hasSchemas && (
            <div className="rounded-md border border-blue-500/50 bg-blue-500/10 p-3">
              <p className="text-sm text-blue-300">
                No schemas defined. Use custom events to send any event with any
                payload.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="custom-event-type"
              className="block text-sm font-medium text-gray-300"
            >
              Event Type
            </label>
            <input
              id="custom-event-type"
              type="text"
              value={customEventType}
              onChange={(e) => setCustomEventType(e.target.value)}
              placeholder="e.g., my-custom-event"
              className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="custom-payload"
              className="block text-sm font-medium text-gray-300"
            >
              Payload (JSON)
            </label>
            <textarea
              id="custom-payload"
              value={customPayload}
              onChange={(e) => setCustomPayload(e.target.value)}
              placeholder='{"key": "value"}'
              rows={10}
              className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={customAwaitResponse}
              onChange={(e) => setCustomAwaitResponse(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            Await response (sendWithResponse)
          </label>

          <button
            type="button"
            onClick={handleSendCustomEvent}
            disabled={isLoading || !customEventType.trim()}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading
              ? "Sending..."
              : customAwaitResponse
                ? "Send & Await Response"
                : "Send Custom Event"}
          </button>
        </div>
      )}

      {/* Response (shared between both modes) */}
      {response && (
        <div
          className={`
            rounded-md border p-4 space-y-2
            ${
              response.type === "success"
                ? "border-green-500/50 bg-green-500/10"
                : "border-red-500/50 bg-red-500/10"
            }
          `}
        >
          <div className="flex items-center gap-2">
            {response.type === "success" ? (
              <CheckCircleIcon className="h-4 w-4 text-green-400" />
            ) : (
              <AlertCircleIcon className="h-4 w-4 text-red-400" />
            )}
            <h4
              className={`text-sm font-semibold ${
                response.type === "success" ? "text-green-400" : "text-red-400"
              }`}
            >
              {response.type === "success" ? "Success" : "Error"}
            </h4>
          </div>
          <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(response.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
