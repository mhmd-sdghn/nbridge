import { MessagePriority } from "../constants/messagePriority";
import type {
  BridgeMessage,
  BridgeSendOptions,
  QueueConfig,
  QueuedMessage,
  QueueStats,
} from "../types";
import type { BridgeLogger } from "../utils/helpers";

// Storage written by older versions keyed queues by numeric enum values.
const LEGACY_PRIORITY_KEYS: Record<string, MessagePriority> = {
  "0": MessagePriority.HIGH,
  "1": MessagePriority.NORMAL,
  "2": MessagePriority.LOW,
};

// Highest-priority-first order. Single source of truth for every queue scan.
const PRIORITY_ORDER: readonly MessagePriority[] = [
  MessagePriority.HIGH,
  MessagePriority.NORMAL,
  MessagePriority.LOW,
];

export class MessageQueue {
  private queue: Map<MessagePriority, QueuedMessage[]> = new Map(
    PRIORITY_ORDER.map((p) => [p, [] as QueuedMessage[]]),
  );
  private flushing = false;
  private flushCallback?: () => Promise<void>;
  private stats: QueueStats = {
    size: 0,
    pending: 0,
    failed: 0,
    completed: 0,
  };
  private flushTimer?: ReturnType<typeof setInterval>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private pageHideListener: (() => void) | null = null;

  constructor(
    private logger: BridgeLogger,
    private config: Required<QueueConfig>,
  ) {
    this.loadFromStorage();
    this.setupAutoFlush();

    // Flush any pending debounced write when the page is being hidden/unloaded,
    // so a debounced enqueue is not lost on navigation away.
    if (this.config.persist && typeof window !== "undefined") {
      this.pageHideListener = () => this.flushPersist();
      window.addEventListener("pagehide", this.pageHideListener);
      window.addEventListener("visibilitychange", this.pageHideListener);
    }
  }

  /** Schedule a trailing persist write, coalescing bursts of enqueues. */
  private persistDebounced(): void {
    if (this.persistTimer !== undefined) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.saveToStorage();
    }, 150);
  }

  /** Write immediately, cancelling any pending debounced write. */
  private flushPersist(): void {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.config.persist) this.saveToStorage();
  }

  public enqueue(
    message: BridgeMessage,
    options?: BridgeSendOptions,
    priority: MessagePriority = MessagePriority.NORMAL,
  ): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Resolve the destination band BEFORE making room: an unmapped priority
    // must not cost a real queued message its slot on the way to being rejected.
    const priorityQueue = this.queue.get(priority);
    if (!priorityQueue) {
      this.logger.error(`Invalid priority: ${priority}`);
      return false;
    }

    if (
      this.getTotalSize() >= this.config.maxSize &&
      !this.evictOne(priority)
    ) {
      // Nothing evictable outranked by the newcomer — it is the least valuable
      // thing here, so it is what gets dropped.
      this.logger.warn(
        `Queue full (${this.config.maxSize}), dropping "${message.type}"`,
      );
      this.stats.failed++;
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

    priorityQueue.push(queuedMessage);
    this.stats.size = this.getTotalSize();
    this.stats.pending++;

    this.logger.log(
      `Queued message: ${message.type} with priority ${priority} (queue size: ${this.stats.size})`,
    );

    // Debounce persistence: without this, a burst of failed sends rewrites the
    // entire localStorage blob on every enqueue (O(N^2) aggregate).
    if (this.config.persist) {
      this.persistDebounced();
    }

    return true;
  }

  /**
   * Make room for a message of `incoming` priority by discarding the oldest
   * entry in the lowest-priority non-empty band. Returns false when everything
   * queued outranks the newcomer, in which case the caller drops it instead.
   *
   * Evicting rather than rejecting is what makes `priority` mean anything: a
   * HIGH message must not lose its slot to LOW ones that merely arrived first.
   */
  private evictOne(incoming: MessagePriority): boolean {
    for (let i = PRIORITY_ORDER.length - 1; i >= 0; i--) {
      const band = PRIORITY_ORDER[i] as MessagePriority;
      // Stop before evicting anything the newcomer does not outrank.
      if (band === incoming) break;
      const victims = this.queue.get(band);
      const evicted = victims?.shift();
      if (evicted) {
        this.logger.warn(
          `Queue full (${this.config.maxSize}), evicting ${band}-priority "${evicted.message.type}" to make room for a ${incoming}-priority message`,
        );
        this.stats.failed++;
        this.stats.pending--;
        return true;
      }
    }
    // Same-priority tie: oldest of our own band loses (FIFO within a band).
    const own = this.queue.get(incoming);
    const evicted = own?.shift();
    if (evicted) {
      this.logger.warn(
        `Queue full (${this.config.maxSize}), evicting oldest ${incoming}-priority "${evicted.message.type}"`,
      );
      this.stats.failed++;
      this.stats.pending--;
      return true;
    }
    return false;
  }

  /** Discard `count` entries, lowest priority and oldest first. */
  private trimOldest(count: number): void {
    let remaining = count;
    for (let i = PRIORITY_ORDER.length - 1; i >= 0 && remaining > 0; i--) {
      const entries = this.queue.get(PRIORITY_ORDER[i] as MessagePriority);
      if (!entries?.length) continue;
      const removed = entries.splice(0, Math.min(remaining, entries.length));
      remaining -= removed.length;
    }
    const dropped = count - remaining;
    this.stats.failed += dropped;
    this.stats.pending -= dropped;
    this.stats.size = this.getTotalSize();
    this.logger.warn(
      `Persisted queue exceeded maxSize (${this.config.maxSize}); dropped ${dropped} oldest message(s)`,
    );
  }

  /** True when `entry` has sat in the queue longer than `config.maxAge`. */
  private isExpired(entry: QueuedMessage, now: number): boolean {
    return (
      this.config.maxAge !== Infinity &&
      typeof entry.timestamp === "number" &&
      now - entry.timestamp > this.config.maxAge
    );
  }

  /** Discard entries older than `config.maxAge`; returns how many were dropped. */
  private dropExpired(): number {
    if (this.config.maxAge === Infinity) return 0;
    const now = Date.now();
    let dropped = 0;
    for (const band of PRIORITY_ORDER) {
      const entries = this.queue.get(band);
      if (!entries?.length) continue;
      const kept = entries.filter((entry) => !this.isExpired(entry, now));
      dropped += entries.length - kept.length;
      entries.length = 0;
      entries.push(...kept);
    }
    if (dropped > 0) {
      this.stats.failed += dropped;
      this.stats.pending -= dropped;
      this.stats.size = this.getTotalSize();
      this.logger.warn(
        `Dropped ${dropped} queued message(s) older than ${this.config.maxAge}ms`,
      );
    }
    return dropped;
  }

  private getTotalSize(): number {
    let total = 0;
    for (const priorityQueue of this.queue.values()) {
      total += priorityQueue.length;
    }
    return total;
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

    // Never replay a command that has gone stale waiting for its turn.
    this.dropExpired();

    const totalSize = this.getTotalSize();
    if (totalSize === 0) {
      this.logger.log("Queue is empty, nothing to flush");
      return;
    }

    this.flushing = true;
    this.logger.info(`Flushing ${totalSize} queued messages`);

    // Collect all messages from all priorities
    const messagesToFlush: QueuedMessage[] = [];
    for (const priority of PRIORITY_ORDER) {
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
        if (queuedMessage.attempts < this.config.maxRetries) {
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
    // Now that the callback is set, start the auto-flush timer.
    // setupAutoFlush was already called in the constructor, but at that point
    // flushCallback was undefined, so the timer was a no-op.
    this.setupAutoFlush();
  }

  private loadFromStorage(): void {
    if (!this.config.persist || typeof window === "undefined") {
      return;
    }

    try {
      const stored = localStorage.getItem(this.config.storageKey);
      if (stored) {
        const data = JSON.parse(stored);

        // Drop entries whose shape is invalid (corrupt/legacy storage) so a
        // single bad record cannot crash resolution or wedge the flush loop.
        const isValidEntry = (m: unknown): m is QueuedMessage =>
          !!m &&
          typeof m === "object" &&
          typeof (m as QueuedMessage).message?.type === "string";

        // Load messages into priority queues
        if (data.queueData) {
          // New format with priority queues
          for (const [key, messages] of Object.entries(data.queueData) as Array<
            [string, QueuedMessage[]]
          >) {
            const priority = (LEGACY_PRIORITY_KEYS[key] ??
              key) as MessagePriority;
            const priorityQueue = this.queue.get(priority);
            if (priorityQueue && Array.isArray(messages)) {
              priorityQueue.push(
                ...messages
                  .filter(isValidEntry)
                  .map((m) => ({ ...m, priority })),
              );
            }
          }
        } else if (data.queue && Array.isArray(data.queue)) {
          // Old format (single array) - migrate to NORMAL priority
          const normalQueue = this.queue.get(MessagePriority.NORMAL);
          if (normalQueue) {
            normalQueue.push(...data.queue.filter(isValidEntry));
          }
        }

        // Recompute stats from what actually loaded rather than trusting the
        // persisted counters (which can drift or be corrupt).
        const size = this.getTotalSize();
        this.stats = {
          size,
          pending: size,
          failed: 0,
          completed: 0,
        };

        // Storage is not bound by `maxSize` — it was written by a build that
        // may have had a larger cap, or by one that never enforced it on load.
        // Trim before anything can act on an over-full queue.
        this.dropExpired();
        const overflow = this.getTotalSize() - this.config.maxSize;
        if (overflow > 0) this.trimOldest(overflow);

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
      const queueData: Record<string, QueuedMessage[]> = {};
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

    if (this.pageHideListener && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pageHideListener);
      window.removeEventListener("visibilitychange", this.pageHideListener);
      this.pageHideListener = null;
    }

    // Flush any pending debounced write (also cancels the timer).
    this.flushPersist();

    // Clear all priority queues
    for (const priorityQueue of this.queue.values()) {
      priorityQueue.length = 0;
    }
  }
}
