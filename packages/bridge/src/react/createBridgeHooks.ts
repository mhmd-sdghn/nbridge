"use client";

import { useEffect, useRef, useState } from "react";
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
    // biome-ignore lint/suspicious/noExplicitAny: Type is inferred from schema
    const [payload, setPayload] = useState<any>(initialValue);
    const [message, setMessage] = useState<BridgeMessage | null>(null);

    useBridgeMessage<K>(type, (newPayload, newMessage) => {
      setPayload(newPayload);
      setMessage(newMessage);
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
    const [state, setState] = useState<BridgeReadyState>({
      ready: bridge.isReady(),
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

    async function request(
      payload?: PayloadType,
      timeout?: number,
    ): Promise<ResponseType | null> {
      setLoading(true);
      setError(null);
      try {
        const result = await bridge.sendWithResponse(
          type as string,
          payload as unknown,
          timeout,
        );
        setData(result as ResponseType);
        return result as ResponseType;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        return null;
      } finally {
        setLoading(false);
      }
    }

    function reset() {
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

    const effectiveResponseType = responseType ?? `${requestType}_response`;

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

  /** Non-reactive: platform cannot change after page load. */
  function usePlatform(): PlatformInfo {
    return bridge.getPlatform();
  }

  function useIsNative(): boolean {
    return bridge.getPlatform().isNative;
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

      const interval = setInterval(() => {
        const newStats = bridge.getQueueStats();
        if (newStats) setStats(newStats);
      }, pollInterval);

      return () => clearInterval(interval);
    }, [pollInterval]);

    async function flush() {
      await bridge.flushQueue();
      const newStats = bridge.getQueueStats();
      if (newStats) setStats(newStats);
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
