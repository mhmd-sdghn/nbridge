/**
 * Message priority levels for the offline queue.
 * Messages are flushed highest priority first.
 */
export const MessagePriority = {
  HIGH: "high",
  NORMAL: "normal",
  LOW: "low",
} as const;

export type MessagePriority =
  (typeof MessagePriority)[keyof typeof MessagePriority];
