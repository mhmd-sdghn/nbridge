# Metrics

nBridge can collect live traffic metrics in-process — no external agent, no network calls.

## Enable

```ts
import { createBridge } from "nbridge";

const bridge = createBridge({
  metrics: {
    enabled: true,
    updateInterval: 1000,  // recompute + notify listeners every second
    detailedTiming: false, // per-message timing detail
  },
});
```

All three fields are required when you pass a `metrics` config. Defaults when omitted entirely: disabled.

## Reading

```ts
const metrics = bridge.getMetrics();
// null when metrics are disabled, otherwise:
// {
//   messagesSent: 240,
//   messagesReceived: 236,
//   messagesFailed: 1,
//   timeouts: 3,
//   averageResponseTime: 42.7,     // ms, over correlated request/response pairs
//   successRate: 0.983,
//   messagesPerSecond: 3.2,
//   peakMessagesPerSecond: 18,
//   bytesSent: 51_200,             // wire size, after compression
//   bytesReceived: 48_930,
// }
```

## Subscribing

```ts
const unsubscribe = bridge.onMetricsUpdate((metrics) => {
  statusBar.update(`${metrics.messagesPerSecond.toFixed(1)} msg/s`);
});

// later
unsubscribe();
```

Listeners fire every `updateInterval` milliseconds.

In React, [`useBridgeMetrics`](/guide/react#usebridgemetrics) wraps this subscription in a hook.

## What counts

- **Sent / received** are recorded at the adapter boundary, so `bytesSent` / `bytesReceived` reflect the actual wire size (post-compression, including batch envelopes).
- **Timeouts** increment whenever a pending response's deadline passes.
- **Failed** increments when the outgoing pipeline throws (adapter failure, middleware error).

::: tip DevTools
When [DevTools](/guide/devtools) are enabled alongside metrics, the panel's Metrics tab renders these numbers live — usually all you need during development.
:::
