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
   * Initialize the adapter
   */
  initialize(onMessage: (message: BridgeMessage) => void): void;

  /**
   * Send a message to the platform
   */
  send(message: BridgeMessage): void;

  /**
   * Clean up resources
   */
  destroy(): void;
}
