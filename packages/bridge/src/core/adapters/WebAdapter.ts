import type { BridgeMessage } from "../../types";
import { type BridgeLogger, isValidMessage } from "../../utils/helpers";
import type { IPlatformAdapter } from "./IPlatformAdapter";

/**
 * Web/Browser platform adapter (for testing or fallback)
 * Single Responsibility: Handle web-only communication via postMessage
 */
export class WebAdapter implements IPlatformAdapter {
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private enableLoopback: boolean;

  constructor(enableLoopback = false, _logger?: BridgeLogger) {
    this.enableLoopback = enableLoopback;
  }

  public getPlatformType() {
    return "web" as const;
  }

  public isAvailable(): boolean {
    return typeof window !== "undefined";
  }

  public initialize(onMessage: (message: BridgeMessage) => void): void {
    this.messageListener = (event: MessageEvent) => {
      // Accept same-origin messages. In loopback mode also accept origin=""
      // because jsdom's postMessage implementation fires events with an empty
      // origin string instead of window.location.origin.
      const originOk =
        event.origin === window.location.origin ||
        (this.enableLoopback && event.origin === "");
      if (!originOk) {
        return;
      }

      const message = this.parseMessage(event.data);
      if (!message) return;

      onMessage(message);
    };

    window.addEventListener("message", this.messageListener);
  }

  public send(message: BridgeMessage): void {
    if (this.enableLoopback) {
      // For testing: post message to self to simulate native bridge
      window.postMessage(message, window.location.origin);
      return;
    }

    // Fail loudly instead of silently dropping the message and letting
    // send() report success while sendWithResponse() times out mysteriously.
    throw new Error(
      `nBridge: no native bridge or parent frame found for message "${message.type}". ` +
        "Running in a plain browser tab? Enable `webLoopback: true` for local development, " +
        "or open the page inside a WebView/iframe host.",
    );
  }

  public destroy(): void {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
  }

  private parseMessage(data: unknown): BridgeMessage | null {
    if (typeof data === "object" && data !== null && isValidMessage(data)) {
      return data;
    }
    return null;
  }
}
