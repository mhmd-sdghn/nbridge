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
      // A duplicate id would orphan the earlier caller's promise; reject the
      // old entry instead of silently overwriting it.
      const existing = this.pendingResponses.get(messageId);
      if (existing) {
        clearTimeout(existing.timeoutId);
        existing.reject(
          new Error(`Duplicate message id "${messageId}" registered`),
        );
        this.pendingResponses.delete(messageId);
      }

      const entry: PendingResponse = {
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          // Only fire for our own registration (guards against a same-id
          // entry replacing this one).
          if (this.pendingResponses.get(messageId) === entry) {
            this.pendingResponses.delete(messageId);

            if (this.onTimeout) {
              this.onTimeout(messageId);
            }

            reject(new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout),
      };

      this.pendingResponses.set(messageId, entry);

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

  public reject(messageId: string, error: Error | string): boolean {
    const pending = this.pendingResponses.get(messageId);

    if (!pending) {
      this.logger.warn(`No pending response found for message: ${messageId}`);
      return false;
    }

    clearTimeout(pending.timeoutId);

    pending.reject(error instanceof Error ? error : new Error(error));
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
    for (const [messageId, pending] of this.pendingResponses.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Bridge destroyed"));
      this.logger.log(`Cleared pending response: ${messageId}`);
    }

    this.pendingResponses.clear();
  }
}
