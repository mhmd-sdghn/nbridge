import { PROTOCOL } from "../constants/protocol";
import type { BatchConfig, BatchStats, BridgeMessage } from "../types";
import { type BridgeLogger, generateMessageId } from "../utils/helpers";

/**
 * Collects fire-and-forget messages and flushes them to the wire as a single
 * `PROTOCOL.BATCH` envelope, either when the batch is full (`maxSize`) or
 * after `maxWait` ms — whichever comes first.
 */
export class BatchManager {
  private pendingMessages: BridgeMessage[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;
  private batchCount = 0;
  private sentCount = 0;
  private failedCount = 0;
  private onFlush?: (batch: BridgeMessage) => Promise<void>;

  constructor(
    private logger: BridgeLogger,
    private config: Required<BatchConfig>,
  ) {}

  public setFlushCallback(fn: (batch: BridgeMessage) => Promise<void>): void {
    this.onFlush = fn;
  }

  public add(message: BridgeMessage): void {
    if (!this.config.enabled) {
      throw new Error("Batching is not enabled");
    }

    this.pendingMessages.push(message);
    this.logger.log(
      `Added to batch (${this.pendingMessages.length}/${this.config.maxSize})`,
    );

    if (this.pendingMessages.length >= this.config.maxSize) {
      this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.config.maxWait);
  }

  /**
   * Build the batch envelope and hand it to the flush callback (which sends
   * it through the outgoing pipeline). Returns the envelope, or null when
   * there was nothing to flush.
   */
  public flush(): BridgeMessage | null {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.pendingMessages.length === 0) {
      return null;
    }

    const messages = [...this.pendingMessages];
    this.pendingMessages = [];
    this.batchCount++;

    const batch: BridgeMessage = {
      type: PROTOCOL.BATCH,
      payload: { messages },
      id: generateMessageId(),
      timestamp: Date.now(),
    };

    this.logger.info(
      `Flushing batch ${this.batchCount} with ${messages.length} messages`,
    );

    if (!this.onFlush) {
      this.failedCount += messages.length;
      this.logger.error("Batch flush callback not set — batch dropped");
      return batch;
    }

    this.onFlush(batch)
      .then(() => {
        this.sentCount += messages.length;
      })
      .catch((error) => {
        this.failedCount += messages.length;
        this.logger.error("Batch send failed:", error);
      });

    return batch;
  }

  public getStats(): BatchStats {
    return {
      pending: this.pendingMessages.length,
      sent: this.sentCount,
      failed: this.failedCount,
      totalBatches: this.batchCount,
    };
  }

  public clear(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pendingMessages = [];
  }

  public destroy(): void {
    this.clear();
  }
}
