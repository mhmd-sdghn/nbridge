import type { BridgeMetrics, MetricsConfig, MetricsListener } from "../types";
import type { BridgeLogger } from "../utils/helpers";

interface MessageTiming {
  id: string;
  startTime: number;
  endTime?: number;
}

export class MetricsCollector {
  private metrics: BridgeMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    messagesFailed: 0,
    timeouts: 0,
    averageResponseTime: 0,
    successRate: 1,
    messagesPerSecond: 0,
    peakMessagesPerSecond: 0,
    bytesSent: 0,
    bytesReceived: 0,
  };

  private responseTimes: number[] = [];
  private pendingTimings = new Map<string, MessageTiming>();
  private listeners = new Set<MetricsListener>();
  private updateTimer?: ReturnType<typeof setInterval>;
  private startTime = Date.now();
  private lastSecondCount = 0;
  private lastSecondTime = Date.now();

  constructor(
    private logger: BridgeLogger,
    private config: Required<MetricsConfig>,
  ) {
    if (config.enabled) {
      this.startPeriodicUpdates();
    }
  }

  public recordSent(messageId: string, size: number): void {
    if (!this.config.enabled) return;

    this.metrics.messagesSent++;
    this.metrics.bytesSent += size;

    if (this.config.detailedTiming) {
      this.pendingTimings.set(messageId, {
        id: messageId,
        startTime: Date.now(),
      });
    }

    this.updateMessagesPerSecond();
  }

  public recordReceived(messageId: string, size: number): void {
    if (!this.config.enabled) return;

    this.metrics.messagesReceived++;
    this.metrics.bytesReceived += size;

    // Calculate response time if we have timing
    if (this.config.detailedTiming && this.pendingTimings.has(messageId)) {
      const timing = this.pendingTimings.get(messageId);
      if (timing) {
        const responseTime = Date.now() - timing.startTime;
        this.recordResponseTime(responseTime);
        this.pendingTimings.delete(messageId);
      }
    }
  }

  public recordFailed(messageId: string): void {
    if (!this.config.enabled) return;

    this.metrics.messagesFailed++;
    this.pendingTimings.delete(messageId);
    this.updateSuccessRate();
  }

  public recordTimeout(messageId: string): void {
    if (!this.config.enabled) return;

    this.metrics.timeouts++;
    this.metrics.messagesFailed++;
    this.pendingTimings.delete(messageId);
    this.updateSuccessRate();
  }

  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);

    // Keep only last 100 response times for rolling average
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    // Calculate average
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageResponseTime = sum / this.responseTimes.length;
  }

  private updateSuccessRate(): void {
    const total = this.metrics.messagesSent;
    const failed = this.metrics.messagesFailed;
    this.metrics.successRate = total > 0 ? (total - failed) / total : 1;
  }

  private updateMessagesPerSecond(): void {
    const now = Date.now();
    const elapsed = now - this.lastSecondTime;

    if (elapsed >= 1000) {
      const currentRate =
        (this.metrics.messagesSent - this.lastSecondCount) / (elapsed / 1000);
      this.metrics.messagesPerSecond = currentRate;

      if (currentRate > this.metrics.peakMessagesPerSecond) {
        this.metrics.peakMessagesPerSecond = currentRate;
      }

      this.lastSecondCount = this.metrics.messagesSent;
      this.lastSecondTime = now;
    }
  }

  public getMetrics(): BridgeMetrics {
    return { ...this.metrics };
  }

  public addListener(listener: MetricsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public removeListener(listener: MetricsListener): void {
    this.listeners.delete(listener);
  }

  private startPeriodicUpdates(): void {
    this.updateTimer = setInterval(() => {
      const metrics = this.getMetrics();
      this.notifyListeners(metrics);
    }, this.config.updateInterval);
  }

  private notifyListeners(metrics: BridgeMetrics): void {
    this.listeners.forEach((listener) => {
      try {
        listener(metrics);
      } catch (error) {
        this.logger.error("Error in metrics listener:", error);
      }
    });
  }

  public reset(): void {
    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesFailed: 0,
      timeouts: 0,
      averageResponseTime: 0,
      successRate: 1,
      messagesPerSecond: 0,
      peakMessagesPerSecond: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };
    this.responseTimes = [];
    this.pendingTimings.clear();
    this.startTime = Date.now();
    this.lastSecondCount = 0;
    this.lastSecondTime = Date.now();
  }

  public destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.listeners.clear();
    this.pendingTimings.clear();
  }
}
