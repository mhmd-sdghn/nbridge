/**
 * Internal protocol message types.
 *
 * These types travel over the wire and form the contract with the native /
 * parent-frame side. Native hosts implementing the handshake must reply to
 * `HANDSHAKE` with `HANDSHAKE_ACK`. Hosts receiving `BATCH` must unpack
 * `payload.messages` and process each entry as an individual message.
 */
export const PROTOCOL = {
  HANDSHAKE: "__nbridge_handshake__",
  HANDSHAKE_ACK: "__nbridge_handshake_ack__",
  BATCH: "__nbridge_batch__",
} as const;

export function isProtocolType(type: string): boolean {
  return (
    type === PROTOCOL.HANDSHAKE ||
    type === PROTOCOL.HANDSHAKE_ACK ||
    type === PROTOCOL.BATCH
  );
}
