import type { BridgeMessage } from "../../types";
import { type BridgeLogger, parseBridgeFrame } from "../../utils/helpers";
import { isIframe } from "../../utils/platform";
import type { IPlatformAdapter } from "./IPlatformAdapter";

/**
 * Iframe/PostMessage platform adapter
 * Single Responsibility: Handle iframe/window.postMessage communication
 */
export class IframeAdapter implements IPlatformAdapter {
  private messageListener: ((event: MessageEvent) => void) | null = null;
  /** True when the app opted into wildcard origin via iframeParentOrigin: "*". */
  private readonly allowWildcard: boolean;

  constructor(
    // Kept for constructor-signature parity with the other adapters, but the
    // security warnings below go through console.* (unsuppressable) not the
    // logger, so it is intentionally unused.
    _logger?: BridgeLogger,
    private parentOrigin?: string,
  ) {
    this.allowWildcard = parentOrigin === "*";
    if (this.allowWildcard) {
      // Loud, unsuppressable: wildcard is a security downgrade the app must
      // knowingly accept, and the bridge logger is silent by default.
      console.warn(
        '[nbridge] IframeAdapter configured with iframeParentOrigin: "*". ' +
          "All bridge messages are sent to and accepted from ANY origin. " +
          "Set a concrete origin in production.",
      );
    }
  }

  public getPlatformType() {
    return "iframe" as const;
  }

  public isAvailable(): boolean {
    return isIframe();
  }

  public initialize(onMessage: (message: BridgeMessage) => void): void {
    if (typeof window === "undefined") return;
    if (!this.parentOrigin) {
      // No origin configured and no explicit wildcard opt-in: refuse to accept
      // cross-origin traffic. A hostile embedder could otherwise both inject
      // requests and receive responses.
      console.warn(
        "[nbridge] IframeAdapter: iframeParentOrigin is not set. Incoming " +
          "messages are rejected until you configure the expected parent " +
          'origin (or opt into iframeParentOrigin: "*" to accept any origin).',
      );
    }

    this.messageListener = (event: MessageEvent) => {
      // Only accept messages from the direct parent frame
      if (event.source !== window.parent) return;

      // Enforce origin unless the app explicitly opted into wildcard.
      if (!this.allowWildcard) {
        if (!this.parentOrigin) return;
        if (event.origin !== this.parentOrigin) return;
      }

      const message = parseBridgeFrame(event.data);
      if (!message) return;

      onMessage(message);
    };

    window.addEventListener("message", this.messageListener);
  }

  public send(message: BridgeMessage): void {
    if (!window.parent || window.parent === window) {
      // Fail loudly like every other adapter, instead of silently dropping and
      // letting send() report success while sendWithResponse() times out.
      throw new Error(
        `nBridge: IframeAdapter cannot send "${message.type}" — not running inside an iframe (window.parent === window).`,
      );
    }

    if (!this.parentOrigin) {
      throw new Error(
        `nBridge: IframeAdapter refusing to send "${message.type}" with a wildcard target origin. ` +
          'Set iframeParentOrigin in BridgeConfig to a concrete origin, or opt into iframeParentOrigin: "*" explicitly.',
      );
    }

    // parentOrigin is either a concrete origin or the explicit "*" opt-in.
    window.parent.postMessage(message, this.parentOrigin);
  }

  public destroy(): void {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
  }
}
