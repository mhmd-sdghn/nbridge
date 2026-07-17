import type { BridgeMessage, Middleware, MiddlewareContext } from "../types";
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
    // Snapshot the chain so concurrent use()/clear() cannot corrupt this run.
    const chain = this.middlewares.slice();
    if (chain.length === 0) {
      return finalHandler(message);
    }

    // Dispatch by explicit position rather than a shared mutable index. Each
    // next() call runs the remainder of the chain from the caller's fixed
    // position, so a middleware can never skip its siblings (the shared-index
    // bug), and calling next() again (e.g. retryMiddleware re-driving the
    // transport on failure) correctly re-runs downstream from the same point.
    const dispatch = async (i: number, msg: BridgeMessage): Promise<void> => {
      if (i >= chain.length) {
        return finalHandler(msg);
      }

      const middleware = chain[i];
      if (!middleware) {
        return finalHandler(msg);
      }

      try {
        await middleware(msg, context, (nextMsg) => dispatch(i + 1, nextMsg));
      } catch (error) {
        this.logger.error(
          `Error in middleware ${i} (${context.direction}):`,
          error,
        );
        throw error;
      }
    };

    return dispatch(0, message);
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
