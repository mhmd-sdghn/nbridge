import type { BridgeMessage } from "../../types";
import {
  attachSendBridgeMessageFnToWindow,
  type BridgeLogger,
  safeStringify,
} from "../../utils/helpers";
import { hasAndroidBridge } from "../../utils/platform";
import type { IPlatformAdapter } from "./IPlatformAdapter";

export class AndroidAdapter implements IPlatformAdapter {
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
    attachSendBridgeMessageFnToWindow(onMessage, this.logger);
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

    if (!bridge) {
      throw new Error(
        `Android bridge interface "${this.interfaceName}" not found on window`,
      );
    }

    const messageStr = safeStringify(message);
    bridge.postMessage(messageStr);
  }

  public destroy(): void {
    if (typeof window !== "undefined") {
      delete (window as unknown as Record<string, unknown>).sendBridgeMessage;
    }
  }
}
