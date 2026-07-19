import { afterEach, describe, expect, it, vi } from "vitest";
import { IframeAdapter } from "../src/core/adapters/IframeAdapter";
import type { BridgeMessage } from "../src/types";

/**
 * These tests drive IframeAdapter directly (jsdom runs at the top window, so
 * window.parent === window). We stub window.parent to simulate an embedded
 * frame and assert the origin-security behavior.
 */

const realParent = window.parent;

function setParent(value: unknown) {
  Object.defineProperty(window, "parent", {
    value,
    configurable: true,
    writable: true,
  });
}

function makeEnvelope(type: string, payload?: unknown): BridgeMessage {
  return { type, payload, id: "id-1", timestamp: 1, __nbridge: 1 };
}

afterEach(() => {
  setParent(realParent);
  vi.restoreAllMocks();
});

describe("IframeAdapter send security", () => {
  it("throws when not inside an iframe (window.parent === window)", () => {
    setParent(window);
    const adapter = new IframeAdapter(undefined, "https://host.example");
    expect(() => adapter.send(makeEnvelope("x"))).toThrow(
      /not running inside an iframe/i,
    );
  });

  it("throws instead of posting with a wildcard when no origin is configured", () => {
    const post = vi.fn();
    setParent({ postMessage: post });
    const adapter = new IframeAdapter(); // no parentOrigin
    expect(() => adapter.send(makeEnvelope("x"))).toThrow(
      /wildcard target origin/i,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("posts to the configured origin (never *) when one is set", () => {
    const post = vi.fn();
    setParent({ postMessage: post });
    const adapter = new IframeAdapter(undefined, "https://host.example");
    const msg = makeEnvelope("x", { a: 1 });
    adapter.send(msg);
    expect(post).toHaveBeenCalledWith(msg, "https://host.example");
  });

  it("posts with * only when the app explicitly opts into wildcard", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const post = vi.fn();
    setParent({ postMessage: post });
    const adapter = new IframeAdapter(undefined, "*");
    adapter.send(makeEnvelope("x"));
    expect(post).toHaveBeenCalledWith(expect.anything(), "*");
    expect(warn).toHaveBeenCalled(); // loud opt-in warning
  });
});

describe("IframeAdapter receive security", () => {
  it("rejects messages from a non-configured origin", () => {
    const parent = { postMessage: vi.fn() };
    setParent(parent);
    const adapter = new IframeAdapter(undefined, "https://trusted.example");
    const received: BridgeMessage[] = [];
    adapter.initialize((m) => received.push(m));

    // Hostile origin, right source
    window.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope("evil"),
        source: parent as unknown as Window,
        origin: "https://evil.example",
      }),
    );
    expect(received).toHaveLength(0);
    adapter.destroy();
  });

  it("accepts messages from the configured origin and correct source", () => {
    const parent = { postMessage: vi.fn() };
    setParent(parent);
    const adapter = new IframeAdapter(undefined, "https://trusted.example");
    const received: BridgeMessage[] = [];
    adapter.initialize((m) => received.push(m));

    window.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope("ok", { n: 1 }),
        source: parent as unknown as Window,
        origin: "https://trusted.example",
      }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("ok");
    adapter.destroy();
  });

  it("rejects messages from a source other than window.parent", () => {
    const parent = { postMessage: vi.fn() };
    setParent(parent);
    const adapter = new IframeAdapter(undefined, "https://trusted.example");
    const received: BridgeMessage[] = [];
    adapter.initialize((m) => received.push(m));

    window.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope("ok"),
        source: { postMessage: vi.fn() } as unknown as Window,
        origin: "https://trusted.example",
      }),
    );
    expect(received).toHaveLength(0);
    adapter.destroy();
  });

  it("rejects same-window traffic lacking the __nbridge discriminator", () => {
    const parent = { postMessage: vi.fn() };
    setParent(parent);
    const adapter = new IframeAdapter(undefined, "https://trusted.example");
    const received: BridgeMessage[] = [];
    adapter.initialize((m) => received.push(m));

    window.dispatchEvent(
      new MessageEvent("message", {
        // No __nbridge marker: an analytics SDK / devserver message
        data: { type: "webpackHotUpdate", payload: {} },
        source: parent as unknown as Window,
        origin: "https://trusted.example",
      }),
    );
    expect(received).toHaveLength(0);
    adapter.destroy();
  });
});
