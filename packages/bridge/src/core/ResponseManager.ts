import type { BridgeResponse } from "../types";
import type { BridgeLogger } from "../utils/helpers";

interface PendingResponse {
  resolve: (value: BridgeResponse) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class ResponseManager {
  private pendingResponses = new Map<string, PendingResponse>();
  private onTimeout?: (messageId: string) => void;

  constructor(
    private logger: BridgeLogger,
    private defaultTimeout: number,
  ) {}

  public setTimeoutCallback(callback: (messageId: string) => void): void {
    this.onTimeout = callback;
  }

  public register(
    messageId: string,
    timeout: number = this.defaultTimeout,
  ): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingResponses.has(messageId)) {
          this.pendingResponses.delete(messageId);

          if (this.onTimeout) {
            this.onTimeout(messageId);
          }

          reject(new Error(`Request timed out after ${timeout}ms`));
        }
      }, timeout);

      this.pendingResponses.set(messageId, {
        resolve,
        reject,
        timeoutId,
      });

      this.logger.log(`Registered pending response for message: ${messageId}`);
    });
  }

  public resolve(messageId: string, data: unknown): boolean {
    const pending = this.pendingResponses.get(messageId);

    if (!pending) {
      this.logger.warn(`No pending response found for message: ${messageId}`);
      return false;
    }

    clearTimeout(pending.timeoutId);

    const response: BridgeResponse = {
      success: true,
      data,
      id: messageId,
    };

    pending.resolve(response);
    this.pendingResponses.delete(messageId);

    this.logger.log(`Resolved pending response for message: ${messageId}`);
    return true;
  }

  public reject(messageId: string, error: string): boolean {
    const pending = this.pendingResponses.get(messageId);

    if (!pending) {
      this.logger.warn(`No pending response found for message: ${messageId}`);
      return false;
    }

    clearTimeout(pending.timeoutId);

    pending.reject(new Error(error));
    this.pendingResponses.delete(messageId);

    this.logger.log(`Rejected pending response for message: ${messageId}`);
    return true;
  }

  public has(messageId: string): boolean {
    return this.pendingResponses.has(messageId);
  }

  public count(): number {
    return this.pendingResponses.size;
  }

  public clear(): void {
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeoutId);
    }

    for (const [messageId, pending] of this.pendingResponses.entries()) {
      pending.reject(new Error("Bridge destroyed"));
      this.logger.log(`Cleared pending response: ${messageId}`);
    }

    this.pendingResponses.clear();
  }
}
