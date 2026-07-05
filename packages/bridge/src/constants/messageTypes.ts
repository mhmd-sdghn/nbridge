/**
 * Bridge Message Type Constants
 *
 * Use these constants instead of string literals for better type safety
 * and to avoid errors from typos.
 *
 * @example
 * ```typescript
 * import { BridgeMessageType } from "nbridge";
 *
 * // Instead of:
 * bridge.send("auth:login", payload);
 *
 * // Use:
 * bridge.send(BridgeMessageType.AUTH_LOGIN, payload);
 * ```
 */
export const BridgeMessageType = {
  // Authentication
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  AUTH_TOKEN_REFRESH: "auth:tokenRefresh",

  // Location
  LOCATION_GET: "location:get",
  LOCATION_UPDATE: "location:update",
  LOCATION_START_TRACKING: "location:startTracking",
  LOCATION_STOP_TRACKING: "location:stopTracking",

  // Notifications
  NOTIFICATION_SHOW: "notification:show",
  NOTIFICATION_PERMISSION: "notification:permission",

  // Camera
  CAMERA_TAKE_PICTURE: "camera:takePicture",
  CAMERA_PERMISSION: "camera:permission",

  // Storage
  STORAGE_GET: "storage:get",
  STORAGE_SET: "storage:set",
  STORAGE_REMOVE: "storage:remove",

  // File operations
  FILE_UPLOAD: "file:upload",
  FILE_DOWNLOAD: "file:download",

  // Device info
  DEVICE_GET_INFO: "device:getInfo",

  // Errors
  ERROR_OCCURRED: "error:occurred",
} as const;

/**
 * Type for bridge message types
 */
export type BridgeMessageTypeValue =
  (typeof BridgeMessageType)[keyof typeof BridgeMessageType];
