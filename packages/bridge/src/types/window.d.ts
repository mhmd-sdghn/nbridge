/**
 * Window type declarations for bridge DevTools
 */

import type {
  BatchStats,
  BridgeConfig,
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
