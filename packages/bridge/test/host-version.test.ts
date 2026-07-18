import { describe, expect, it } from "vitest";
import { defineHostRules } from "../src";
import {
  parseConstraint,
  parseConstraints,
  parseVersion,
  satisfies,
} from "../src/host/version";

describe("parseVersion", () => {
  it("parses 1–3 numeric segments, defaulting missing ones to 0", () => {
    expect(parseVersion("2")).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion("3.1")).toEqual({ major: 3, minor: 1, patch: 0 });
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("tolerates a leading v", () => {
    expect(parseVersion("v2.1")).toEqual({ major: 2, minor: 1, patch: 0 });
  });

  it("returns null only when there is no usable leading numeric segment", () => {
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("x.1.2")).toBeNull();
  });

  it("tolerantly parses real-world version strings (finding 3.14)", () => {
    // Extra segments beyond 3 are ignored (Android versionName style).
    expect(parseVersion("1.2.3.4")).toEqual({ major: 1, minor: 2, patch: 3 });
    // Pre-release / build suffixes are stripped.
    expect(parseVersion("1.2.3-beta")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(parseVersion("9.1.0-rc1")).toEqual({ major: 9, minor: 1, patch: 0 });
    expect(parseVersion("9.1.0+456")).toEqual({ major: 9, minor: 1, patch: 0 });
    // A trailing non-numeric segment stops parsing at the numeric prefix.
    expect(parseVersion("1.x")).toEqual({ major: 1, minor: 0, patch: 0 });
  });
});

describe("parseConstraint", () => {
  it("defaults to = when no operator is given", () => {
    expect(parseConstraint("2")).toEqual({
      operator: "=",
      version: { major: 2, minor: 0, patch: 0 },
    });
  });

  it("parses each operator, longest-first", () => {
    expect(parseConstraint(">=8.2")?.operator).toBe(">=");
    expect(parseConstraint(">8.2")?.operator).toBe(">");
    expect(parseConstraint("<=8.2")?.operator).toBe("<=");
    expect(parseConstraint("<8.2")?.operator).toBe("<");
    expect(parseConstraint("=8.2")?.operator).toBe("=");
  });

  it("tolerates a single space after the operator", () => {
    expect(parseConstraint(">= 2")).toEqual({
      operator: ">=",
      version: { major: 2, minor: 0, patch: 0 },
    });
  });

  it("returns null when the version part is unparsable", () => {
    expect(parseConstraint(">=x")).toBeNull();
    expect(parseConstraint("=>2")).toBeNull();
  });
});

describe("satisfies", () => {
  const check = (version: string, constraint: string | string[]) => {
    const parsed = parseVersion(version);
    const constraints = parseConstraints(constraint);
    if (constraints === null) throw new Error("bad constraint in test");
    return satisfies(parsed, constraints);
  };

  it("compares numerically per segment with loose versions on both sides", () => {
    expect(check("2.0.0", ">=2")).toBe(true);
    expect(check("2", ">=2.0.0")).toBe(true);
    expect(check("1.9.9", ">=2")).toBe(false);
    expect(check("3.1", ">3")).toBe(true);
    expect(check("3.0.0", ">3")).toBe(false);
    expect(check("2.5", "<=2.5.0")).toBe(true);
    expect(check("2.5.1", "<=2.5")).toBe(false);
    expect(check("1.0.0", "<2")).toBe(true);
    expect(check("2.0.0", "=2")).toBe(true);
    expect(check("2.0.1", "=2")).toBe(false);
  });

  it("treats an array of constraints as a logical AND (range)", () => {
    expect(check("2.0.0", [">=2", "<3"])).toBe(true);
    expect(check("2.9.9", [">=2", "<3"])).toBe(true);
    expect(check("3.0.0", [">=2", "<3"])).toBe(false);
    expect(check("1.9.9", [">=2", "<3"])).toBe(false);
  });

  it("never satisfies a constraint when the version is unknown (null)", () => {
    const constraints = parseConstraints(">=2");
    if (constraints === null) throw new Error("bad constraint in test");
    expect(satisfies(null, constraints)).toBe(false);
  });
});

describe("config-time constraint validation", () => {
  it("throws naming the capability when a constraint is malformed", () => {
    expect(() =>
      defineHostRules({
        capabilities: { nativeShare: { android: ">=abc" } },
      }),
    ).toThrow(/nativeShare/);
  });

  it("throws naming the variant when a rule constraint is malformed", () => {
    expect(() =>
      defineHostRules({
        variants: {
          saveFlow: {
            rules: [
              {
                when: { platform: "android", version: "notaversion" },
                use: "B",
              },
            ],
            default: "A",
          },
        },
      }),
    ).toThrow(/saveFlow/);
  });

  it("throws when a variant rule has an empty `when` clause", () => {
    expect(() =>
      defineHostRules({
        variants: {
          saveFlow: {
            rules: [{ when: {}, use: "B" }],
            default: "A",
          },
        },
      }),
    ).toThrow(/empty `when`/);
  });
});
