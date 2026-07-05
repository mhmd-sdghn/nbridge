import type {
  BridgeMessage,
  Middleware,
  MiddlewareContext,
  NextFunction,
} from "../types";
import type { BridgeLogger } from "../utils/helpers";

export class MiddlewareManager {
  private middlewares: Middleware[] = [];

  constructor(private logger: BridgeLogger) {}

  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
    this.logger.log(`Middleware registered (${this.middlewares.length} total)`);
  }

  public async execute(
    message: BridgeMessage,
    context: MiddlewareContext,
    finalHandler: (message: BridgeMessage) => Promise<void>,
  ): Promise<void> {
    // If no middleware, call final handler directly
    if (this.middlewares.length === 0) {
      return finalHandler(message);
    }

    let index = 0;

    // Create the next function that advances through the chain
    const next: NextFunction = async (msg: BridgeMessage): Promise<void> => {
      // If we've reached the end of middleware chain, call final handler
      if (index >= this.middlewares.length) {
        return finalHandler(msg);
      }

      // Get current middleware and increment index
      const middleware = this.middlewares[index++];
      if (!middleware) {
        return finalHandler(msg);
      }

      try {
        // Execute middleware with message, context, and next
        await middleware(msg, context, next);
      } catch (error) {
        // Log error and rethrow
        this.logger.error(
          `Error in middleware ${index - 1} (${context.direction}):`,
          error,
        );
        throw error;
      }
    };

    // Start the chain
    return next(message);
  }

  public async executeOutgoing(
    message: BridgeMessage,
    finalHandler: (message: BridgeMessage) => Promise<void>,
    bridge?: unknown,
  ): Promise<void> {
    const context: MiddlewareContext = {
      direction: "outgoing",
      timestamp: Date.now(),
      bridge,
    };

    return this.execute(message, context, finalHandler);
  }

  public async executeIncoming(
    message: BridgeMessage,
    finalHandler: (message: BridgeMessage) => Promise<void>,
    bridge?: unknown,
  ): Promise<void> {
    const context: MiddlewareContext = {
      direction: "incoming",
      timestamp: Date.now(),
      bridge,
    };

    return this.execute(message, context, finalHandler);
  }

  public count(): number {
    return this.middlewares.length;
  }

  public clear(): void {
    const count = this.middlewares.length;
    this.middlewares = [];
    this.logger.log(`Cleared ${count} middleware`);
  }

  public destroy(): void {
    this.clear();
  }
}
