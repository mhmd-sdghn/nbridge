import type { BridgeMessage, BridgePlatform } from "../../types";

/**
 * Interface for platform adapters
 * Interface Segregation Principle: Define specific contract for platform communication
 * Open/Closed Principle: New platforms can be added by implementing this interface
 */
export interface IPlatformAdapter {
  /**
   * Get the platform type
   */
  getPlatformType(): BridgePlatform;

  /**
   * Check if this adapter is available in the current environment
   */
  isAvailable(): boolean;

  /**
   * Initialize the adapter and start receiving messages. Implementations must
   * no-op when `window` is undefined (SSR), so calling this on the server is
   * safe even though BridgeManager also guards.
   */
  initialize(onMessage: (message: BridgeMessage) => void): void;

  /**
   * Send a message to the platform. Implementations THROW on failure (adapter
   * unavailable, non-serializable payload, not in the expected context) rather
   * than silently dropping, so the caller's retry/queue logic can engage.
   */
  send(message: BridgeMessage): void;

  /**
   * Clean up resources
   */
  destroy(): void;
}
