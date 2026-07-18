import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canNavigateBackWithinSession,
  getSessionHistorySnapshot,
  prepareSessionForRouterBack,
  resetSessionHistoryStateForTests,
  syncCurrentUrlIntoSession,
} from "../src/next/navigation/nextHistorySession";

/**
 * Exercises the session-history mirror directly (finding 8.7). Focus: the
 * push-vs-popstate truncation semantics (4.9b) and the same-origin back check.
 */

function go(path: string) {
  window.history.pushState({}, "", path);
}

beforeEach(() => {
  resetSessionHistoryStateForTests();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  resetSessionHistoryStateForTests();
});

describe("nextHistorySession", () => {
  it("appends on push and truncates on back (popstate)", () => {
    go("/a");
    syncCurrentUrlIntoSession("push");
    go("/b");
    syncCurrentUrlIntoSession("push");
    go("/c");
    syncCurrentUrlIntoSession("push");

    const snap = getSessionHistorySnapshot().map((u) => new URL(u).pathname);
    expect(snap).toEqual(["/a", "/b", "/c"]);

    // Simulate a back navigation to /b (popstate): the mirror truncates.
    window.history.replaceState({}, "", "/b");
    syncCurrentUrlIntoSession("popstate");
    const afterBack = getSessionHistorySnapshot().map(
      (u) => new URL(u).pathname,
    );
    expect(afterBack).toEqual(["/a", "/b"]);
  });

  it("does NOT truncate on a forward re-visit via push (4.9b)", () => {
    // list -> detail -> list, all via router.push (pushState). Revisiting /list
    // must append, not truncate back to the earlier /list.
    go("/list");
    syncCurrentUrlIntoSession("push");
    go("/detail");
    syncCurrentUrlIntoSession("push");
    go("/list");
    syncCurrentUrlIntoSession("push");

    const snap = getSessionHistorySnapshot().map((u) => new URL(u).pathname);
    expect(snap).toEqual(["/list", "/detail", "/list"]);
    // More than one entry behind the current one, so back is possible.
    expect(canNavigateBackWithinSession()).toBe(true);
  });

  it("prepareSessionForRouterBack pops the current entry", () => {
    go("/a");
    syncCurrentUrlIntoSession("push");
    go("/b");
    syncCurrentUrlIntoSession("push");
    expect(getSessionHistorySnapshot()).toHaveLength(2); // /a, /b

    prepareSessionForRouterBack();
    expect(getSessionHistorySnapshot()).toHaveLength(1);
  });

  it("canNavigateBackWithinSession is false at the session root", () => {
    syncCurrentUrlIntoSession("init");
    expect(canNavigateBackWithinSession()).toBe(false);
  });
});
