import { vi } from "vitest";
import type { BridgeMessage } from "../src/types";
import { safeStringify } from "../src/utils/helpers";

/**
 * Installs a fake Android WebView bridge on window. Captured messages are
 * parsed from the JSON string the AndroidAdapter sends.
 */
export function installAndroidBridge(options?: {
  failTimes?: number;
  autoRespond?: boolean;
}) {
  let failures = options?.failTimes ?? 0;
  const sent: BridgeMessage[] = [];

  const postMessage = vi.fn((raw: string) => {
    if (failures > 0) {
      failures--;
      throw new Error("native side unavailable");
    }
    const message = JSON.parse(raw) as BridgeMessage;
    sent.push(message);

    if (options?.autoRespond) {
      // Simulate the native side echoing protocol acks and responses.
      if (message.type === "__nbridge_handshake__") {
        receiveFromNative({ type: "__nbridge_handshake_ack__" });
      }
    }
  });

  (window as unknown as Record<string, unknown>).AndroidBridge = {
    postMessage,
  };

  return {
    sent,
    postMessage,
    uninstall: () => {
      delete (window as unknown as Record<string, unknown>).AndroidBridge;
    },
  };
}

/** Deliver a message to the web side the way native Android/iOS does. */
export function receiveFromNative(message: BridgeMessage): void {
  const fn = (window as unknown as Record<string, unknown>).sendBridgeMessage as
    | ((raw: string) => void)
    | undefined;
  if (!fn) throw new Error("sendBridgeMessage not attached");
  fn(safeStringify(message));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the predicate holds (or time out). */
export async function until(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("until(): condition not met in time");
    }
    await wait(10);
  }
}
