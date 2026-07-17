/**
 * nbridge — type-safe real-time communication between web apps and their
 * hosts: Android WebView, iOS WKWebView, and iframes.
 *
 * This root entry is framework-agnostic (no React). React hooks live in
 * `nbridge/react`, Next.js back-navigation in `nbridge/next`, and the
 * in-page devtools panel in `nbridge/devtools`.
 */

// Constants exports
export { BridgeBackAction } from "./constants/backAction";
export {
  MessagePriority,
  type MessagePriorityName,
  normalizePriority,
} from "./constants/messagePriority";
export { PROTOCOL } from "./constants/protocol";
// Core exports
export { BridgeManager, createBridge, getBridge } from "./core/BridgeManager";
export { BridgeValidationError, formatIssues } from "./core/validate";
// Host Rules exports
export { defineHostRules } from "./host/HostRulesEngine";
export {
  type HostTraitSource,
  type HostVersionSource,
  type TraitFromQueryOptions,
  traitFromQuery,
  type VersionFromQueryOptions,
  versionFromQuery,
  versionFromUserAgent,
} from "./host/sources";
export type {
  CapabilityName,
  CapabilityRule,
  CapabilityWhen,
  HostInfo,
  HostOverride,
  HostPlatformConfig,
  HostRules,
  HostRulesConfig,
  HostServerSnapshot,
  PlatformSelect,
  TraitDef,
  TraitMatch,
  TraitName,
  TraitsConfig,
  TraitValue,
  VariantDef,
  VariantName,
  VariantRule,
  VariantValue,
  VariantWhen,
  VersionConstraint,
} from "./host/types";
// Middleware exports
export {
  debugMiddleware,
  encryptionMiddleware,
  filterMiddleware,
  loggingMiddleware,
  metadataMiddleware,
  retryMiddleware,
  throttleMiddleware,
  timingMiddleware,
  transformMiddleware,
  validationMiddleware,
} from "./middleware";
// Type exports
export type {
  BatchConfig,
  BatchStats,
  BridgeConfig,
  BridgeMessage,
  BridgeMessageHandler,
  BridgeMessageHandlerWithResponse,
  BridgeMetrics,
  BridgePlatform,
  BridgeResponse,
  BridgeSendOptions,
  BridgeSubscription,
  CompressionConfig,
  CompressionStats,
  DevToolsConfig,
  DevToolsLog,
  DevToolsMessage,
  HandshakeConfig,
  IBridgeManager,
  MetricsConfig,
  Middleware,
  MiddlewareContext,
  NextFunction,
  PlatformInfo,
  QueueConfig,
  QueuedMessage,
  QueueStats,
} from "./types";
// Schema type exports (Standard Schema based — bring your own validator)
export {
  defineMessage,
  type ExtractPayload,
  type ExtractResponse,
  type MessageSchema,
  type MessageTypes,
  type PayloadFor,
  type ResponseFor,
  type SchemaRegistry,
} from "./types/schema";
export type { StandardSchemaV1 } from "./types/standard-schema";
export {
  createMessage,
  generateMessageId,
  isValidMessage,
  safeParse,
  safeStringify,
} from "./utils/helpers";
// Utility exports
export {
  detectPlatform,
  getPlatformInfo,
  hasAndroidBridge,
  hasIOSBridge,
  isAndroid,
  isIframe,
  isIOS,
} from "./utils/platform";
