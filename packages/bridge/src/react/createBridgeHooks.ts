"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RESPONSE_SUFFIX } from "../constants/protocol";
import { createBridge } from "../core/BridgeManager";
import type {
  BridgeConfig,
  BridgeMessage,
  BridgeMessageHandler,
  BridgeMetrics,
  BridgeResponse,
  BridgeSendOptions,
  PlatformInfo,
  QueueStats,
} from "../types";
import type {
  MessageTypes,
  PayloadFor,
  ResponseFor,
  SchemaRegistry,
} from "../types/schema";

export interface CreateBridgeHooksOptions<
  TSchemas extends SchemaRegistry | undefined = undefined,
> {
  config?: BridgeConfig<TSchemas>;
}

export interface BridgeReadyState {
  ready: boolean;
  error: Error | null;
}

/** Guards against accidental repeat factory calls (see createBridgeHooks JSDoc). */
let factoryCalled = false;

/** Shallow value-equality for QueueStats so polling avoids no-op re-renders. */
function queueStatsEqual(a: QueueStats | null, b: QueueStats | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.size === b.size &&
    a.pending === b.pending &&
    a.failed === b.failed &&
    a.completed === b.completed
  );
}

/**
 * Factory that creates a typed bridge instance and returns hooks bound to it.
 * No React Provider or context needed — hooks close over the bridge instance
 * created at module load time.
 *
 * NOTE: call this once per app, at module scope. Calling it multiple times
 * creates independent bridge instances (each with its own adapter listeners).
 *
 * @example
 * // src/lib/bridge.ts
 * export const { useBridgeSend, useBridgeMessage, instance } =
 *   createBridgeHooks({ config: { schemas: mySchemas } });
 *
 * // Register stateless listeners imperatively (no React lifecycle needed)
 * instance.on("error", (payload) => instance.error(payload));
 */
export function createBridgeHooks<
  TSchemas extends SchemaRegistry | undefined = undefined,
>(options: CreateBridgeHooksOptions<TSchemas> = {}) {
  if (factoryCalled) {
    console.warn(
      "[nbridge] createBridgeHooks() called more than once. Each call creates an independent bridge instance, and native adapters share one window.sendBridgeMessage receive channel — the newest instance takes it over and earlier instances stop receiving. Call the factory once at module scope and share its hooks.",
    );
  }
  factoryCalled = true;

  const bridge = createBridge<TSchemas>(options.config);

  // ── useBridgeSend ──────────────────────────────────────────────────────────

  function useBridgeSend() {
    async function send<
      K extends TSchemas extends SchemaRegistry
        ? MessageTypes<TSchemas>
        : string,
    >(
      type: K,
      payload?: TSchemas extends SchemaRegistry
        ? K extends MessageTypes<TSchemas>
          ? PayloadFor<TSchemas, K>
          : never
        : unknown,
      opts?: BridgeSendOptions,
    ): Promise<BridgeResponse> {
      // biome-ignore lint/suspicious/noExplicitAny: Overloads handle type safety
      return bridge.send(type as any, payload, opts);
    }

    async function sendWithResponse<
      K extends TSchemas extends SchemaRegistry
        ? MessageTypes<TSchemas>
        : string,
    >(
      type: K,
      payload?: TSchemas extends SchemaRegistry
        ? K extends MessageTypes<TSchemas>
          ? PayloadFor<TSchemas, K>
          : never
        : unknown,
      timeout?: number,
    ): Promise<
      TSchemas extends SchemaRegistry
        ? K extends MessageTypes<TSchemas>
          ? ResponseFor<TSchemas, K>
          : unknown
        : unknown
    > {
      // biome-ignore lint/suspicious/noExplicitAny: Overloads handle type safety
      return bridge.sendWithResponse(type as any, payload, timeout);
    }

    return { send, sendWithResponse };
  }

  // ── useBridgeMessage ───────────────────────────────────────────────────────

  function useBridgeMessage<
    K extends TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string = TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string,
  >(
    type: K,
    handler: BridgeMessageHandler<
      TSchemas extends SchemaRegistry
        ? K extends MessageTypes<TSchemas>
          ? PayloadFor<TSchemas, K>
          : never
        : unknown
    >,
    enabled = true,
  ) {
    const handlerRef = useRef(handler);

    // Always keep ref current — avoids stale closures without re-subscribing
    useEffect(() => {
      handlerRef.current = handler;
    });

    useEffect(() => {
      if (!enabled) return;

      type ExpectedPayload = TSchemas extends SchemaRegistry
        ? K extends MessageTypes<TSchemas>
          ? PayloadFor<TSchemas, K>
          : never
        : unknown;

      const subscription = bridge.on(
        type as string,
        (payload: unknown, message: BridgeMessage) => {
          handlerRef.current(
            payload as ExpectedPayload,
            message as BridgeMessage<ExpectedPayload>,
          );
        },
      );

      return () => subscription.unsubscribe();
    }, [type, enabled]);
  }

  // ── useBridgeMessageState ──────────────────────────────────────────────────

  function useBridgeMessageState<
    K extends TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string = TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string,
  >(
    type: K,
    initialValue?: TSchemas extends SchemaRegistry
      ? K extends MessageTypes<TSchemas>
        ? PayloadFor<TSchemas, K>
        : never
      : unknown,
  ) {
    type StatePayload = TSchemas extends SchemaRegistry
      ? K extends MessageTypes<TSchemas>
        ? PayloadFor<TSchemas, K>
        : unknown
      : unknown;

    // Carry the schema-derived payload type through to the returned value so
    // consumers get real typing at the point of use, not `any`.
    const [payload, setPayload] = useState<StatePayload | undefined>(
      initialValue as StatePayload | undefined,
    );
    const [message, setMessage] = useState<BridgeMessage<StatePayload> | null>(
      null,
    );

    useBridgeMessage<K>(type, (newPayload, newMessage) => {
      setPayload(newPayload as StatePayload);
      setMessage(newMessage as BridgeMessage<StatePayload>);
    });

    return [payload, message] as const;
  }

  // ── useBridgeReady ─────────────────────────────────────────────────────────

  /**
   * Ready flag plus the initialization error, if any. `waitForReady` REJECTS
   * when the handshake times out — this hook surfaces that instead of leaving
   * an unhandled rejection and a forever-false flag.
   */
  function useBridgeReadyState(timeout?: number): BridgeReadyState {
    // Initialize to NOT ready so the first client render matches server output
    // (during SSR bridge.isReady() is false because initialize() early-returns
    // without a window). Reading bridge.isReady() here would make the first
    // client render disagree with the server and trigger a hydration mismatch.
    const [state, setState] = useState<BridgeReadyState>({
      ready: false,
      error: null,
    });

    useEffect(() => {
      if (state.ready) return;
      let cancelled = false;
      bridge
        .waitForReady(timeout)
        .then(() => {
          if (!cancelled) setState({ ready: true, error: null });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setState({
              ready: false,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }, [state.ready, timeout]);

    return state;
  }

  function useBridgeReady(): boolean {
    return useBridgeReadyState().ready;
  }

  // ── useBridgeRequest ───────────────────────────────────────────────────────

  function useBridgeRequest<
    K extends TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string = TSchemas extends SchemaRegistry
      ? MessageTypes<TSchemas>
      : string,
  >(type: K) {
    type ResponseType = TSchemas extends SchemaRegistry
      ? K extends MessageTypes<TSchemas>
        ? ResponseFor<TSchemas, K>
        : unknown
      : unknown;

    type PayloadType = TSchemas extends SchemaRegistry
      ? K extends MessageTypes<TSchemas>
        ? PayloadFor<TSchemas, K>
        : unknown
      : unknown;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [data, setData] = useState<ResponseType | null>(null);
    // Monotonic call counter: only the latest request's settlement is allowed
    // to update state, so a slow earlier call (e.g. one that times out after a
    // retry succeeded) cannot overwrite newer data or clear loading early.
    const seq = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
      return () => {
        mounted.current = false;
      };
    }, []);

    async function request(
      payload?: PayloadType,
      timeout?: number,
    ): Promise<ResponseType | null> {
      const mySeq = ++seq.current;
      const isCurrent = () => mounted.current && seq.current === mySeq;
      setLoading(true);
      setError(null);
      try {
        const result = await bridge.sendWithResponse(
          type as string,
          payload as unknown,
          timeout,
        );
        if (isCurrent()) {
          setData(result as ResponseType);
          setLoading(false);
        }
        return result as ResponseType;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (isCurrent()) {
          setError(e);
          setLoading(false);
        }
        return null;
      }
    }

    function reset() {
      // Invalidate any in-flight request so its settlement is ignored.
      seq.current++;
      setLoading(false);
      setError(null);
      setData(null);
    }

    return { request, loading, error, data, reset };
  }

  // ── useBridgeRPC ───────────────────────────────────────────────────────────

  /**
   * Fire-and-listen RPC over plain events (for hosts that answer with a
   * separate `<type>_response` event instead of the correlated response
   * protocol — prefer useBridgeRequest when the host echoes message ids).
   *
   * The response subscription is active for the whole lifetime of the hook,
   * so a response arriving before React commits an effect is never missed,
   * and concurrent calls are correlated by message id when the host echoes it.
   */
  function useBridgeRPC<TRequest = unknown, TResponse = unknown>(
    requestType: string,
    responseType?: string,
  ) {
    const [response, setResponse] = useState<TResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const pendingIds = useRef(new Set<string>());

    const effectiveResponseType =
      responseType ?? `${requestType}${RESPONSE_SUFFIX}`;

    useEffect(() => {
      const subscription = bridge.on(
        effectiveResponseType,
        (payload: unknown, message: BridgeMessage) => {
          if (pendingIds.current.size === 0) return;

          if (message.id && pendingIds.current.has(message.id)) {
            pendingIds.current.delete(message.id);
          } else if (!message.id) {
            // Host doesn't echo ids — treat as answering the oldest call.
            const first = pendingIds.current.values().next().value;
            if (first !== undefined) pendingIds.current.delete(first);
          } else {
            return; // correlated response for a different consumer
          }

          setResponse(payload as TResponse);
          setLoading(pendingIds.current.size > 0);
        },
      );

      return () => subscription.unsubscribe();
    }, [effectiveResponseType]);

    async function call(payload: TRequest): Promise<void> {
      setLoading(true);
      setError(null);
      setResponse(null);
      try {
        const result = await bridge.send(requestType, payload);
        if (result.id) {
          pendingIds.current.add(result.id);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
      }
    }

    function reset() {
      pendingIds.current.clear();
      setLoading(false);
      setError(null);
      setResponse(null);
    }

    return { call, response, loading, error, reset };
  }

  // ── usePlatform / useIsNative ──────────────────────────────────────────────

  // Platform can't change after page load, so subscribe is a no-op. Snapshots
  // are cached to keep a stable object identity for useSyncExternalStore, and
  // the server snapshot is a conservative "web"/non-native value so the first
  // client render (which in a WebView would detect native) matches server HTML
  // and never triggers a hydration mismatch.
  const noopSubscribe = () => () => {};
  let clientPlatformSnapshot: PlatformInfo | null = null;
  const serverPlatformSnapshot: PlatformInfo = {
    platform: "web",
    isNative: false,
    userAgent: "unknown",
  };
  const getClientPlatform = (): PlatformInfo => {
    if (!clientPlatformSnapshot) {
      clientPlatformSnapshot = bridge.getPlatform();
    }
    return clientPlatformSnapshot;
  };
  const getServerPlatform = (): PlatformInfo => serverPlatformSnapshot;

  /**
   * Platform info. Non-reactive (platform cannot change after page load), but
   * SSR-safe: the server and first client render both see the "web" snapshot,
   * then it settles to the real platform after hydration.
   */
  function usePlatform(): PlatformInfo {
    return useSyncExternalStore(
      noopSubscribe,
      getClientPlatform,
      getServerPlatform,
    );
  }

  function useIsNative(): boolean {
    return usePlatform().isNative;
  }

  // ── useBridgeMetrics ───────────────────────────────────────────────────────

  function useBridgeMetrics() {
    const [metrics, setMetrics] = useState<BridgeMetrics | null>(
      bridge.getMetrics(),
    );

    useEffect(() => {
      if (!bridge.getMetrics()) return;

      const unsubscribe = bridge.onMetricsUpdate(
        (newMetrics: BridgeMetrics) => {
          setMetrics(newMetrics);
        },
      );

      return unsubscribe;
    }, []);

    return metrics;
  }

  // ── useBridgeQueue ─────────────────────────────────────────────────────────

  function useBridgeQueue(pollInterval = 1000) {
    const [stats, setStats] = useState<QueueStats | null>(
      bridge.getQueueStats(),
    );

    useEffect(() => {
      if (!bridge.getQueueStats()) return;

      // getQueueStats() returns a fresh object each tick, so setState-ing it
      // unconditionally re-renders every consumer once per interval even when
      // nothing changed. Only update on an actual value change.
      const interval = setInterval(() => {
        const newStats = bridge.getQueueStats();
        if (newStats) {
          setStats((prev) =>
            queueStatsEqual(prev, newStats) ? prev : newStats,
          );
        }
      }, pollInterval);

      return () => clearInterval(interval);
    }, [pollInterval]);

    async function flush() {
      await bridge.flushQueue();
      const newStats = bridge.getQueueStats();
      if (newStats) {
        setStats((prev) => (queueStatsEqual(prev, newStats) ? prev : newStats));
      }
    }

    return {
      stats,
      flush,
      hasMessages: stats ? stats.size > 0 : false,
    };
  }

  return {
    useBridgeSend,
    useBridgeMessage,
    useBridgeMessageState,
    useBridgeReady,
    useBridgeReadyState,
    useBridgeRequest,
    useBridgeRPC,
    usePlatform,
    useIsNative,
    useBridgeMetrics,
    useBridgeQueue,
    instance: bridge,
  };
}
