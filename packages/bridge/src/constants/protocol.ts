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

/**
 * Request/response correlation suffixes. A handler registered via
 * `onWithResponse("getUser", ...)` replies with `getUser_response` on success
 * or `getUser_error` (payload `{ error: string }`) on failure, echoing the
 * request's `id`. Native hosts implementing request/response must follow the
 * same convention.
 */
export const RESPONSE_SUFFIX = "_response";
export const ERROR_SUFFIX = "_error";

export function isProtocolType(type: string): boolean {
  return (
    type === PROTOCOL.HANDSHAKE ||
    type === PROTOCOL.HANDSHAKE_ACK ||
    type === PROTOCOL.BATCH
  );
}

/** True when the type names a success reply (`<type>_response`). */
export function isSuccessResponseType(type: string): boolean {
  return type.endsWith(RESPONSE_SUFFIX);
}

/** True when the type names an error reply (`<type>_error`). */
export function isErrorResponseType(type: string): boolean {
  return type.endsWith(ERROR_SUFFIX);
}

/** True when the type names any reply (success or error). */
export function isResponseType(type: string): boolean {
  return isSuccessResponseType(type) || isErrorResponseType(type);
}
