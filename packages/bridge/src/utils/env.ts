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

/**
 * True unless we can positively confirm a non-production environment.
 * Use for fail-closed decisions (e.g. gating dev-only console patching):
 * when NODE_ENV is undetectable (plain <script>, bundler that does not define
 * process.env.NODE_ENV), treat the environment as production so we do not leak
 * dev behavior into a shipped page. Explicit `import.meta.env.PROD` also wins.
 */
export function isProductionEnvOrUnknown(): boolean {
  const env = nodeEnv();
  if (env === "production") return true;
  if (env === "development" || env === "test") return false;
  // Unknown: check bundler-injected import.meta.env before failing closed.
  try {
    const meta = (
      import.meta as unknown as { env?: { PROD?: boolean; DEV?: boolean } }
    ).env;
    if (meta?.DEV === true) return false;
    if (meta?.PROD === true) return true;
  } catch {
    // import.meta.env not available
  }
  return true;
}

export function isTestEnv(): boolean {
  return nodeEnv() === "test";
}
