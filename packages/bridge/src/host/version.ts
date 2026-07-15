/**
 * In-house version parser + constraint comparator for the Host Rules engine.
 *
 * No third-party semver dependency — the grammar is deliberately small
 * (dot-separated numeric versions, simple relational operators). See the
 * reference docs for the full grammar.
 */

/**
 * A parsed version as three numeric segments. Missing segments default to 0,
 * so `"2"` becomes `2.0.0` and `"3.1"` becomes `3.1.0`.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Relational operators accepted in a constraint string. */
export type ConstraintOperator = ">=" | ">" | "<=" | "<" | "=";

/** A single parsed constraint, e.g. `">=8.2"` → `{ operator: ">=", version }`. */
export interface Constraint {
  operator: ConstraintOperator;
  version: ParsedVersion;
}

// Longest operators first so ">=" is matched before ">", "<=" before "<".
const OPERATORS: ConstraintOperator[] = [">=", "<=", ">", "<", "="];

/**
 * Parse a version string into numeric segments.
 *
 * Accepts 1–3 dot-separated numeric segments with an optional leading `v`.
 * Anything else (letters, pre-release tags, too many segments, empty) yields
 * `null` — an unparsable version is treated as unknown by the engine.
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const trimmed = raw.trim();
  const body = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  if (body === "") return null;

  const segments = body.split(".");
  if (segments.length < 1 || segments.length > 3) return null;

  const nums: number[] = [];
  for (const segment of segments) {
    if (!/^\d+$/.test(segment)) return null;
    nums.push(Number(segment));
  }

  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
  };
}

/**
 * Parse a constraint string, e.g. `">=8.2"`, `"< 3"`, or a bare `"2"` (which
 * defaults to the `=` operator). A single space after the operator is
 * tolerated. Returns `null` if the version part is unparsable.
 */
export function parseConstraint(raw: string): Constraint | null {
  const trimmed = raw.trim();

  let operator: ConstraintOperator = "=";
  let rest = trimmed;
  for (const op of OPERATORS) {
    if (trimmed.startsWith(op)) {
      operator = op;
      rest = trimmed.slice(op.length);
      break;
    }
  }

  const version = parseVersion(rest.trim());
  if (version === null) return null;
  return { operator, version };
}

/**
 * Parse a capability/variant version value into a list of constraints. A
 * string is a single constraint; a `string[]` is an AND of constraints
 * (enables ranges like `[">=2", "<3"]`). Returns `null` if any entry is
 * malformed — or if an empty array is passed, which expresses no real gate
 * (use `true` for "always allowed" instead) — so callers can fail fast.
 */
export function parseConstraints(
  value: string | string[],
): Constraint[] | null {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) return null;
  const constraints: Constraint[] = [];
  for (const item of items) {
    const parsed = parseConstraint(item);
    if (parsed === null) return null;
    constraints.push(parsed);
  }
  return constraints;
}

/** Numeric per-segment comparison: negative if a < b, positive if a > b. */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfiesOne(version: ParsedVersion, constraint: Constraint): boolean {
  const cmp = compareVersions(version, constraint.version);
  switch (constraint.operator) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
  }
}

/**
 * True when `version` satisfies every constraint (logical AND).
 *
 * An unknown version (`null`) never satisfies a constraint — this is the
 * conservative behavior of the engine: version-gated rules are denied until a
 * real version is known.
 */
export function satisfies(
  version: ParsedVersion | null,
  constraints: Constraint[],
): boolean {
  if (version === null) return false;
  return constraints.every((constraint) => satisfiesOne(version, constraint));
}
