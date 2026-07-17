import type { BridgeMessage } from "../../types";
import {
  attachSendBridgeMessageFnToWindow,
  type BridgeLogger,
  type SendBridgeMessageFn,
} from "../../utils/helpers";
import { hasIOSBridge } from "../../utils/platform";
import type { IPlatformAdapter } from "./IPlatformAdapter";

export class IOSAdapter implements IPlatformAdapter {
  private attachedFunction?: SendBridgeMessageFn;

  constructor(
    private handlerName: string,
    private logger?: BridgeLogger,
  ) {}

  public getPlatformType() {
    return "ios" as const;
  }

  public isAvailable(): boolean {
    return hasIOSBridge(this.handlerName);
  }

  public initialize(onMessage: (message: BridgeMessage) => void): void {
    if (typeof window === "undefined") return;
    this.attachedFunction = attachSendBridgeMessageFnToWindow(
      onMessage,
      this.logger,
    );
  }

  public send(message: BridgeMessage): void {
    if (!this.isAvailable()) {
      throw new Error("iOS bridge not available");
    }

    const webkit = (
      window as unknown as {
        webkit: {
          messageHandlers: Record<
            string,
            { postMessage: (msg: unknown) => void }
          >;
        };
      }
    ).webkit;

    const handler = webkit.messageHandlers[this.handlerName];
    if (!handler) {
      throw new Error(
        `iOS message handler "${this.handlerName}" not found on webkit.messageHandlers`,
      );
    }

    // NOTE: iOS WKWebView receives the raw object (WKScriptMessage.body),
    // while Android receives a JSON string — this asymmetry matches each
    // platform's WebView convention. Do not "align" them.
    handler.postMessage(message);
  }

  public destroy(): void {
    if (typeof window !== "undefined" && this.attachedFunction) {
      const current = (window as unknown as Record<string, unknown>)
        .sendBridgeMessage;
      if (current === this.attachedFunction) {
        delete (window as unknown as Record<string, unknown>).sendBridgeMessage;
      }
    }
  }
}
