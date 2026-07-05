import type {
  BridgeMessage,
  BridgeSendOptions,
  MessagePriority,
  QueueConfig,
  QueuedMessage,
  QueueStats,
} from "../types";
import { MessagePriority as Priority } from "../types";
import type { BridgeLogger } from "../utils/helpers";

export class MessageQueue {
  private queue: Map<MessagePriority, QueuedMessage[]> = new Map([
    [Priority.HIGH, []],
    [Priority.NORMAL, []],
    [Priority.LOW, []],
  ]);
  private flushing = false;
  private flushCallback?: () => Promise<void>;
  private stats: QueueStats = {
    size: 0,
    pending: 0,
    failed: 0,
    completed: 0,
  };
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(
    private logger: BridgeLogger,
    private config: Required<QueueConfig>,
  ) {
    this.loadFromStorage();
    this.setupAutoFlush();
  }

  public enqueue(
    message: BridgeMessage,
    options?: BridgeSendOptions,
    priority: MessagePriority = Priority.NORMAL,
  ): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check max size (total across all priorities)
    const totalSize = this.getTotalSize();
    if (totalSize >= this.config.maxSize) {
      this.logger.warn(`Queue full (${this.config.maxSize}), dropping message`);
      return false;
    }

    const queuedMessage: QueuedMessage = {
      message,
      options,
      timestamp: Date.now(),
      attempts: 0,
      retries: 0,
      priority,
    };

    const priorityQueue = this.queue.get(priority);
    if (!priorityQueue) {
      this.logger.error(`Invalid priority: ${priority}`);
      return false;
    }
    priorityQueue.push(queuedMessage);
    this.stats.size = this.getTotalSize();
    this.stats.pending++;

    this.logger.log(
      `Queued message: ${message.type} with priority ${this.getPriorityName(priority)} (queue size: ${this.stats.size})`,
    );

    if (this.config.persist) {
      this.saveToStorage();
    }

    return true;
  }

  private getTotalSize(): number {
    let total = 0;
    for (const priorityQueue of this.queue.values()) {
      total += priorityQueue.length;
    }
    return total;
  }

  private getPriorityName(priority: MessagePriority): string {
    switch (priority) {
      case Priority.HIGH:
        return "HIGH";
      case Priority.NORMAL:
        return "NORMAL";
      case Priority.LOW:
        return "LOW";
      default:
        return "UNKNOWN";
    }
  }

  public dequeue(): QueuedMessage | null {
    // Dequeue from highest priority first
    for (const priority of [Priority.HIGH, Priority.NORMAL, Priority.LOW]) {
      const priorityQueue = this.queue.get(priority);
      if (priorityQueue && priorityQueue.length > 0) {
        const message = priorityQueue.shift();
        if (message) {
          this.stats.size = this.getTotalSize();
          return message;
        }
      }
    }
    return null;
  }

  public peek(): QueuedMessage | null {
    // Peek from highest priority first
    for (const priority of [Priority.HIGH, Priority.NORMAL, Priority.LOW]) {
      const priorityQueue = this.queue.get(priority);
      if (priorityQueue && priorityQueue.length > 0) {
        return priorityQueue[0] ?? null;
      }
    }
    return null;
  }

  public async flush(
    sendFn: (
      message: BridgeMessage,
      options?: BridgeSendOptions,
    ) => Promise<void>,
  ): Promise<void> {
    if (this.flushing) {
      this.logger.warn("Already flushing queue");
      return;
    }

    const totalSize = this.getTotalSize();
    if (totalSize === 0) {
      this.logger.log("Queue is empty, nothing to flush");
      return;
    }

    this.flushing = true;
    this.logger.info(`Flushing ${totalSize} queued messages`);

    // Collect all messages from all priorities
    const messagesToFlush: QueuedMessage[] = [];
    for (const priority of [Priority.HIGH, Priority.NORMAL, Priority.LOW]) {
      const priorityQueue = this.queue.get(priority);
      if (priorityQueue) {
        messagesToFlush.push(...priorityQueue);
        priorityQueue.length = 0; // Clear the priority queue
      }
    }

    for (const queuedMessage of messagesToFlush) {
      try {
        await sendFn(queuedMessage.message, queuedMessage.options);
        this.stats.completed++;
        this.stats.pending--;
        this.logger.log(`Flushed message: ${queuedMessage.message.type}`);
      } catch (error) {
        this.logger.error(
          `Failed to flush message: ${queuedMessage.message.type}`,
          error,
        );

        // Re-queue if attempts left
        queuedMessage.attempts = (queuedMessage.attempts || 0) + 1;
        if (queuedMessage.attempts < 3) {
          const priorityQueue = this.queue.get(queuedMessage.priority);
          if (priorityQueue) {
            priorityQueue.push(queuedMessage);
          }
        } else {
          this.stats.failed++;
          this.stats.pending--;
        }
      }
    }

    this.stats.size = this.getTotalSize();
    this.flushing = false;

    if (this.config.persist) {
      this.saveToStorage();
    }

    this.logger.info(`Flush complete. ${this.stats.size} messages remaining`);
  }

  public clear(): void {
    const size = this.getTotalSize();

    // Clear all priority queues
    for (const priorityQueue of this.queue.values()) {
      priorityQueue.length = 0;
    }

    this.stats = {
      size: 0,
      pending: 0,
      failed: 0,
      completed: 0,
    };

    if (this.config.persist) {
      this.clearStorage();
    }

    this.logger.info(`Cleared ${size} messages from queue`);
  }

  public getStats(): QueueStats {
    return { ...this.stats };
  }

  public size(): number {
    return this.getTotalSize();
  }

  public isEmpty(): boolean {
    return this.getTotalSize() === 0;
  }

  public setFlushCallback(fn: () => Promise<void>): void {
    this.flushCallback = fn;
  }

  private loadFromStorage(): void {
    if (!this.config.persist || typeof window === "undefined") {
      return;
    }

    try {
      const stored = localStorage.getItem(this.config.storageKey);
      if (stored) {
        const data = JSON.parse(stored);

        // Load messages into priority queues
        if (data.queueData) {
          // New format with priority queues
          for (const [priority, messages] of Object.entries(
            data.queueData,
          ) as Array<[string, QueuedMessage[]]>) {
            const priorityNum = Number.parseInt(priority, 10);
            const priorityQueue = this.queue.get(
              priorityNum as MessagePriority,
            );
            if (priorityQueue) {
              priorityQueue.push(...messages);
            }
          }
        } else if (data.queue) {
          // Old format (single array) - migrate to NORMAL priority
          const normalQueue = this.queue.get(Priority.NORMAL);
          if (normalQueue) {
            normalQueue.push(...data.queue);
          }
        }

        this.stats = data.stats || this.stats;
        this.logger.info(`Loaded ${this.getTotalSize()} messages from storage`);
      }
    } catch (error) {
      this.logger.error("Failed to load queue from storage:", error);
    }
  }

  private saveToStorage(): void {
    if (!this.config.persist || typeof window === "undefined") {
      return;
    }

    try {
      // Convert Map to plain object for serialization
      const queueData: Record<number, QueuedMessage[]> = {};
      for (const [priority, messages] of this.queue.entries()) {
        queueData[priority] = messages;
      }

      const data = {
        queueData,
        stats: this.stats,
      };
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (error) {
      this.logger.error("Failed to save queue to storage:", error);
    }
  }

  private clearStorage(): void {
    if (!this.config.persist || typeof window === "undefined") {
      return;
    }

    try {
      localStorage.removeItem(this.config.storageKey);
    } catch (error) {
      this.logger.error("Failed to clear storage:", error);
    }
  }

  private setupAutoFlush(): void {
    if (!this.config.autoFlush || !this.config.flushInterval) {
      return;
    }

    // Clear existing timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Setup new timer
    this.flushTimer = setInterval(() => {
      if (!this.isEmpty() && !this.flushing && this.flushCallback) {
        this.logger.log("Auto-flush triggered");
        this.flushCallback().catch((error) => {
          this.logger.error("Auto-flush failed:", error);
        });
      }
    }, this.config.flushInterval);
  }

  public destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    if (this.config.persist) {
      this.saveToStorage();
    }

    // Clear all priority queues
    for (const priorityQueue of this.queue.values()) {
      priorityQueue.length = 0;
    }
  }
}
