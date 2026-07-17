import type { BridgeMessage } from "../../types";
import {
  attachSendBridgeMessageFnToWindow,
  type BridgeLogger,
  type SendBridgeMessageFn,
} from "../../utils/helpers";
import { hasAndroidBridge } from "../../utils/platform";
import type { IPlatformAdapter } from "./IPlatformAdapter";

export class AndroidAdapter implements IPlatformAdapter {
  private attachedFunction?: SendBridgeMessageFn;

  constructor(
    private interfaceName: string,
    private logger?: BridgeLogger,
  ) {}

  public getPlatformType() {
    return "android" as const;
  }

  public isAvailable(): boolean {
    return hasAndroidBridge(this.interfaceName);
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
      throw new Error("Android bridge not available");
    }

    const bridge = (
      window as unknown as Record<
        string,
        { postMessage: (msg: string) => void }
      >
    )[this.interfaceName];

    if (!bridge || typeof bridge.postMessage !== "function") {
      throw new Error(
        `Android bridge interface "${this.interfaceName}" not found on window (or has no postMessage function)`,
      );
    }

    // JSON.stringify directly (not safeStringify): a non-serializable payload
    // must fail the send loudly, matching iOS behavior, instead of silently
    // delivering "{}" to the native side.
    const messageStr = JSON.stringify(message);
    bridge.postMessage(messageStr);
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
