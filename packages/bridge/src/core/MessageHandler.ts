import type {
  BridgeMessage,
  BridgeMessageHandler,
  BridgeSubscription,
} from "../types";
import type { BridgeLogger } from "../utils/helpers";

export class MessageHandler {
  private handlers = new Map<string, Set<BridgeMessageHandler<unknown>>>();

  constructor(private logger: BridgeLogger) {}

  public register<T = unknown>(
    type: string,
    handler: BridgeMessageHandler<T>,
  ): BridgeSubscription {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.add(handler as BridgeMessageHandler<unknown>);
    }

    this.logger.info(`Registered handler for message type: ${type}`);

    return {
      unsubscribe: () => this.unregister(type, handler),
    };
  }

  public unregister<T = unknown>(
    type: string,
    handler?: BridgeMessageHandler<T>,
  ): void {
    if (!handler) {
      this.handlers.delete(type);
      this.logger.info(`Removed all handlers for message type: ${type}`);
      return;
    }

    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler as BridgeMessageHandler<unknown>);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
      this.logger.info(`Removed handler for message type: ${type}`);
    }
  }

  public clear(type?: string): void {
    if (type) {
      this.handlers.delete(type);
      this.logger.info(`Removed all handlers for type: ${type}`);
    } else {
      this.handlers.clear();
      this.logger.info("Removed all handlers");
    }
  }

  public async dispatch(message: BridgeMessage): Promise<void> {
    const handlers = this.handlers.get(message.type);

    if (!handlers || handlers.size === 0) {
      this.logger.warn(
        `No handlers registered for message type: ${message.type}`,
      );
      return;
    }

    this.logger.log(
      `Dispatching message to ${handlers.size} handler(s):`,
      message,
    );

    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(message.payload, message);
      } catch (error) {
        this.logger.error(
          `Error in handler for message type "${message.type}":`,
          error,
        );
      }
    });

    await Promise.allSettled(promises);
  }

  public has(type: string): boolean {
    const handlers = this.handlers.get(type);
    return handlers ? handlers.size > 0 : false;
  }

  public count(type?: string): number {
    if (type) {
      return this.handlers.get(type)?.size ?? 0;
    }
    return Array.from(this.handlers.values()).reduce(
      (sum, handlers) => sum + handlers.size,
      0,
    );
  }
}
