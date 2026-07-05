import type { StandardSchemaV1 } from "./standard-schema";

/**
 * Message schema definition.
 *
 * `payloadSchema` and `responseSchema` accept ANY validator implementing the
 * Standard Schema interface (zod 3.24+/4, valibot, ArkType, ...). Both are
 * optional — schemas without them still provide payload/response typing via
 * the generic parameters.
 */
export interface MessageSchema<TPayload = unknown, TResponse = unknown> {
  /** Unique message type identifier */
  type: string;
  /** Standard Schema for payload validation (optional) */
  payloadSchema?: StandardSchemaV1<unknown, TPayload>;
  /** Standard Schema for response validation (optional) */
  responseSchema?: StandardSchemaV1<unknown, TResponse>;
  /** Human-readable description */
  description?: string;
  /** Direction: 'outgoing' | 'incoming' | 'bidirectional' */
  direction?: "outgoing" | "incoming" | "bidirectional";
  /** Example payload for documentation and the devtools event sender */
  example?: TPayload;
}

/**
 * Helper to define a message schema with payload/response types inferred
 * from the provided Standard Schemas.
 *
 * @example
 * import { z } from "zod";
 * const schemas = {
 *   getUser: defineMessage({
 *     type: "getUser",
 *     payloadSchema: z.object({ id: z.string() }),
 *     responseSchema: z.object({ name: z.string() }),
 *   }),
 * };
 */
export function defineMessage<
  TPayloadSchema extends StandardSchemaV1 | undefined = undefined,
  TResponseSchema extends StandardSchemaV1 | undefined = undefined,
>(schema: {
  type: string;
  payloadSchema?: TPayloadSchema;
  responseSchema?: TResponseSchema;
  description?: string;
  direction?: "outgoing" | "incoming" | "bidirectional";
  example?: TPayloadSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TPayloadSchema>
    : unknown;
}): MessageSchema<
  TPayloadSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TPayloadSchema>
    : unknown,
  TResponseSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TResponseSchema>
    : unknown
> {
  return schema as ReturnType<
    typeof defineMessage<TPayloadSchema, TResponseSchema>
  >;
}

/**
 * Schema registry - maps message types to their schemas
 */
export interface SchemaRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: Registry needs to accept any payload/response types
  [messageType: string]: MessageSchema<any, any>;
}

/**
 * Extract payload type from schema
 */
export type ExtractPayload<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Type utility needs to match any response type
  T extends MessageSchema<infer P, any> ? P : never;

/**
 * Extract response type from schema
 */
export type ExtractResponse<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Type utility needs to match any payload type
  T extends MessageSchema<any, infer R> ? R : never;

/**
 * Extract all message types from registry
 */
export type MessageTypes<T extends SchemaRegistry> = keyof T & string;

/**
 * Get payload type for a specific message type
 */
export type PayloadFor<
  T extends SchemaRegistry,
  K extends MessageTypes<T>,
> = ExtractPayload<T[K]>;

/**
 * Get response type for a specific message type
 */
export type ResponseFor<
  T extends SchemaRegistry,
  K extends MessageTypes<T>,
> = ExtractResponse<T[K]>;
