import type { StandardSchemaV1 } from "../types/standard-schema";

export class BridgeValidationError extends Error {
  constructor(
    public readonly messageType: string,
    public readonly stage: "payload" | "response",
    public readonly issues: ReadonlyArray<StandardSchemaV1.Issue>,
  ) {
    super(
      `${stage === "payload" ? "Payload" : "Response"} validation failed for "${messageType}": ${formatIssues(issues)}`,
    );
    this.name = "BridgeValidationError";
  }
}

export function formatIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) =>
          typeof segment === "object" ? String(segment.key) : String(segment),
        )
        .join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Validate a value against any Standard Schema. Supports both sync and
 * async validators (the spec allows `validate` to return a Promise).
 *
 * @returns the validated (possibly transformed) output value
 * @throws BridgeValidationError when validation fails
 */
export async function validateWithSchema<TOutput>(
  schema: StandardSchemaV1<unknown, TOutput>,
  value: unknown,
  messageType: string,
  stage: "payload" | "response",
): Promise<TOutput> {
  let result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    result = await result;
  }

  if (result.issues) {
    throw new BridgeValidationError(messageType, stage, result.issues);
  }

  return result.value;
}
