import type { BridgeMessage } from "../../types";
import { type BridgeLogger, isValidMessage } from "../../utils/helpers";
import { isIframe } from "../../utils/platform";
import type { IPlatformAdapter } from "./IPlatformAdapter";

/**
 * Iframe/PostMessage platform adapter
 * Single Responsibility: Handle iframe/window.postMessage communication
 */
export class IframeAdapter implements IPlatformAdapter {
  private messageListener: ((event: MessageEvent) => void) | null = null;

  constructor(
    private logger?: BridgeLogger,
    private parentOrigin?: string,
  ) {}

  public getPlatformType() {
    return "iframe" as const;
  }

  public isAvailable(): boolean {
    return isIframe();
  }

  public initialize(onMessage: (message: BridgeMessage) => void): void {
    this.messageListener = (event: MessageEvent) => {
      // Only accept messages from the direct parent frame
      if (event.source !== window.parent) return;

      // If a specific parent origin is configured, enforce it
      if (this.parentOrigin && event.origin !== this.parentOrigin) return;

      const message = this.parseMessage(event.data);
      if (!message) return;

      onMessage(message);
    };

    window.addEventListener("message", this.messageListener);
  }

  public send(message: BridgeMessage): void {
    if (window.parent && window.parent !== window) {
      if (!this.parentOrigin) {
        this.logger?.warn(
          "IframeAdapter: sending with wildcard target origin. Set iframeParentOrigin in BridgeConfig to restrict.",
        );
      }
      window.parent.postMessage(message, this.parentOrigin ?? "*");
    } else {
      this.logger?.warn("Not in iframe context");
    }
  }

  public destroy(): void {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
  }

  private parseMessage(data: unknown): BridgeMessage | null {
    // If it's already an object
    if (typeof data === "object" && data !== null && isValidMessage(data)) {
      return data;
    }

    // If it's a string, try to parse it
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (isValidMessage(parsed)) {
          return parsed;
        }
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }
}
