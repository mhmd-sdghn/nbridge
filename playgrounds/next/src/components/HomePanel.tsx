"use client";

import { useState } from "react";
import {
  useBridgeMessage,
  useBridgeReady,
  useBridgeSend,
  usePlatform,
} from "@/lib/bridge";
import { BackButton } from "./BackButton";

export function HomePanel() {
  const ready = useBridgeReady();
  const platform = usePlatform();
  const { send } = useBridgeSend();
  const [log, setLog] = useState<string[]>([]);

  // In loopback everything we send echoes back here.
  useBridgeMessage("toast", (payload) => {
    setLog((prev) =>
      [`toast → ${JSON.stringify(payload)}`, ...prev].slice(0, 5),
    );
  });
  useBridgeMessage("shutdown", () => {
    setLog((prev) =>
      ["shutdown → host would close the WebView", ...prev].slice(0, 5),
    );
  });

  return (
    <section className="card">
      <p>
        <strong>Ready:</strong> {String(ready)} · <strong>Platform:</strong>{" "}
        {platform.platform} · <strong>Native:</strong>{" "}
        {String(platform.isNative)}
      </p>

      <button
        type="button"
        onClick={() => send("toast", { message: "Hello from Next.js" })}
      >
        Send a toast message
      </button>

      <BackButton />

      {log.length > 0 && (
        <ul>
          {log.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only demo log
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
