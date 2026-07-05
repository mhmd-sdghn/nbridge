import { DevToolsUI } from "nbridge/devtools";
import "nbridge/devtools/styles.css";
import { type FormEvent, useState } from "react";
import {
  instance,
  type User,
  useBridgeMessage,
  useBridgeMetrics,
  useBridgeReadyState,
  useBridgeRequest,
  useBridgeSend,
  usePlatform,
} from "./bridge";

interface LogEntry {
  id: number;
  time: string;
  direction: "sent" | "recv" | "err";
  text: string;
}

let logId = 0;

function now(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

export default function App() {
  const { ready, error: readyError } = useBridgeReadyState();
  const platform = usePlatform();
  const { send } = useBridgeSend();
  const metrics = useBridgeMetrics();
  const userRequest = useBridgeRequest("user:get");

  const [msgType, setMsgType] = useState("chat:message");
  const [msgPayload, setMsgPayload] = useState(
    '{ "text": "hello from React" }',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [listenType, setListenType] = useState("chat:message");
  const [log, setLog] = useState<LogEntry[]>([]);

  function addLog(direction: LogEntry["direction"], text: string): void {
    setLog((prev) => [
      ...prev.slice(-199),
      { id: ++logId, time: now(), direction, text },
    ]);
  }

  // Live listener: re-subscribes whenever the listened type changes. With
  // webLoopback every message we send comes straight back here.
  useBridgeMessage(listenType, (payload, message) => {
    addLog(
      "recv",
      `${message.type} ${JSON.stringify(payload)} (id: ${message.id})`,
    );
  });

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const type = msgType.trim();
    if (!type) {
      setFormError("Message type is required.");
      return;
    }

    let payload: unknown;
    const raw = msgPayload.trim();
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        setFormError("Payload is not valid JSON.");
        return;
      }
    }

    try {
      const response = await send(type, payload);
      addLog("sent", `${type} ${raw || "(no payload)"} (id: ${response.id})`);
    } catch (err) {
      addLog("err", err instanceof Error ? err.message : String(err));
    }
  }

  const user = userRequest.data as User | null;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>
            nbridge <span className="dim">/ react playground</span>
          </h1>
          <p className="dim">
            createBridgeHooks + DevTools over the loopback adapter. Press{" "}
            <code>Ctrl+Shift+B</code> (or use the floating trigger) to toggle
            the DevTools panel.
          </p>
        </div>
        <div className="badges">
          <span className="badge">platform: {platform.platform}</span>
          <span
            className={`badge ${
              ready ? "badge-ok" : readyError ? "badge-err" : "badge-wait"
            }`}
          >
            {ready
              ? "ready"
              : readyError
                ? `error: ${readyError.message}`
                : "connecting…"}
          </span>
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>useBridgeSend</h2>
          <form onSubmit={handleSend}>
            <label htmlFor="msg-type">Message type</label>
            <input
              id="msg-type"
              value={msgType}
              onChange={(e) => setMsgType(e.target.value)}
              spellCheck={false}
            />
            <label htmlFor="msg-payload">Payload (JSON)</label>
            <textarea
              id="msg-payload"
              rows={4}
              value={msgPayload}
              onChange={(e) => setMsgPayload(e.target.value)}
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary">
              Send
            </button>
            {formError && <span className="error">{formError}</span>}
          </form>
        </section>

        <section className="panel">
          <h2>useBridgeRequest("user:get")</h2>
          <p className="dim">
            A responder for <code>user:get</code> is registered on the bridge
            instance in <code>src/bridge.ts</code>; the request loops out and
            back and resolves with the responder's return value.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={userRequest.loading}
            onClick={() => userRequest.request({ id: "1" })}
          >
            {userRequest.loading ? "Loading…" : "Fetch user"}
          </button>
          <div className={`result ${user || userRequest.error ? "" : "dim"}`}>
            {userRequest.error
              ? `Error: ${userRequest.error.message}`
              : user
                ? JSON.stringify(user, null, 2)
                : "no user fetched yet"}
          </div>
        </section>

        <section className="panel">
          <h2>useBridgeMetrics</h2>
          {metrics ? (
            <div className="metrics">
              <Metric label="messages sent" value={metrics.messagesSent} />
              <Metric
                label="messages received"
                value={metrics.messagesReceived}
              />
              <Metric label="failed" value={metrics.messagesFailed} />
              <Metric label="bytes sent" value={metrics.bytesSent} />
              <Metric label="bytes received" value={metrics.bytesReceived} />
              <Metric
                label="avg response"
                value={`${Math.round(metrics.averageResponseTime)} ms`}
              />
            </div>
          ) : (
            <p className="dim">metrics disabled</p>
          )}
        </section>

        <section className="panel">
          <h2>useBridgeMessage</h2>
          <label htmlFor="listen-type">Listening for type</label>
          <input
            id="listen-type"
            value={listenType}
            onChange={(e) => setListenType(e.target.value)}
            spellCheck={false}
          />
          <p className="dim" style={{ marginTop: 8, fontSize: 13 }}>
            Send a matching type on the left and watch the echo land below.
          </p>
        </section>

        <section className="panel panel-wide">
          <div className="row space-between">
            <h2>Message log</h2>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setLog([])}
            >
              Clear
            </button>
          </div>
          <div className="log" aria-live="polite">
            {log.length === 0 && (
              <div className="log-empty">nothing yet — send a message</div>
            )}
            {log.map((entry) => (
              <div className="log-entry" key={entry.id}>
                <span className="time">{entry.time}</span>
                <span className={`dir dir-${entry.direction}`}>
                  {entry.direction === "sent"
                    ? "SENT →"
                    : entry.direction === "recv"
                      ? "← RECV"
                      : "ERROR"}
                </span>
                <span className="body">{entry.text}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* In-page DevTools panel (Ctrl+Shift+B). Renders only in dev builds. */}
      <DevToolsUI bridge={instance} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
