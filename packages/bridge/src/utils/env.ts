/**
 * Environment detection that is safe outside bundlers: `process` may not
 * exist in a plain browser <script> context, and bundlers statically replace
 * `process.env.NODE_ENV`.
 */
function nodeEnv(): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  } catch {
    return undefined;
  }
}

export function isProductionEnv(): boolean {
  return nodeEnv() === "production";
}

export function isTestEnv(): boolean {
  return nodeEnv() === "test";
}
