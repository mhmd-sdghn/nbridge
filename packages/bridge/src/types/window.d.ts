/**
 * Window type declarations for bridge DevTools
 */

import type {
  BatchStats,
  BridgeConfig,
  BridgeMessage,
  BridgeMetrics,
  BridgeResponse,
  BridgeSendOptions,
  DevToolsLog,
  DevToolsMessage,
  QueueStats,
} from "./index";
import type { SchemaRegistry } from "./schema";

declare global {
  interface Window {
    /**
     * The native-to-web receive entry point. Native hosts call
     * `window.sendBridgeMessage(json)` (or pass an object) to deliver a message
     * to the web side. Attached by the Android/iOS adapters on initialize.
     */
    sendBridgeMessage?: (message: string | BridgeMessage) => void;
    __BRIDGE_DEVTOOLS__?: {
      getMessages: () => DevToolsMessage[];
      getLogs: () => DevToolsLog[];
      getMetrics: () => BridgeMetrics | null;
      getQueueStats: () => QueueStats | null;
      getBatchStats: () => BatchStats | null;
      getConfig: () => BridgeConfig;
      getSchemas: () => SchemaRegistry | undefined;
      send: (
        type: string,
        payload?: unknown,
        options?: BridgeSendOptions,
      ) => Promise<BridgeResponse>;
      clear: () => void;
      clearLogs: () => void;
      setEnabled: (enabled: boolean) => void;
    };
  }
}
