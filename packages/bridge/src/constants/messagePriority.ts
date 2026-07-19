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

/** Uppercase keys accepted by `BridgeSendOptions.priority`. */
export type MessagePriorityName = keyof typeof MessagePriority;

/**
 * Accept either an uppercase key ("HIGH", the `BridgeSendOptions.priority`
 * form) or a lowercase value ("high", the `MessagePriority` constant form) and
 * return the canonical `MessagePriority` value. Unknown/missing input defaults
 * to NORMAL. This tolerance exists because the option type and the exported
 * constant historically used different casings; see review finding 1.18.
 */
export function normalizePriority(
  input: MessagePriority | MessagePriorityName | undefined,
): MessagePriority {
  if (!input) return MessagePriority.NORMAL;
  const upper = input.toUpperCase() as MessagePriorityName;
  if (upper === "HIGH" || upper === "NORMAL" || upper === "LOW") {
    return MessagePriority[upper];
  }
  return MessagePriority.NORMAL;
}
