/**
 * notifications/index.ts  ←  The public API of this module
 *
 * The ONLY import path app code should use:
 *   import { useNotifications, NotificationPermissionBanner } from '@/notifications';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Wiring (done for you by `create-expo-boilerplate add notifications`):
 *
 *  1. index.ts (entry) — before the app renders anything:
 *       import '@/notifications/setup';   // background handlers + channels
 *
 *  2. src/providers/AppProviders.tsx — inside APIProvider, around the navigator:
 *       <NotificationRoot>{children}</NotificationRoot>
 *
 * Then mount <NotificationPermissionBanner /> on whichever screen is allowed to
 * ask for permission (Settings, by default). `useNotificationPermission` is
 * what grants a screen that ability, and the banner only prompts on an explicit
 * tap — nothing prompts on mount.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Scope: this module is the notification TRANSPORT — permission, channels, the
 * FCM token, remote message handling, routing, and local trigger scheduling. It
 * has no features in it. Anything that decides WHAT to notify about or WHEN
 * lives in its own feature folder and calls in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Note on the barrel: barrel exports have a bundle-size cost in Metro. This one
 * is intentional because it is the module's external API boundary. Files INSIDE
 * src/notifications/ import from each other directly, never through here, to
 * avoid circular references.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Provider & context ────────────────────────────────────────────────────────
export { NotificationProvider, useNotificationContext } from './NotificationProvider';
export { NotificationRoot } from './NotificationRoot';

// ── Hooks ─────────────────────────────────────────────────────────────────────
export type { UseNotificationPermissionReturn } from './useNotificationPermission';
export { useNotificationPermission } from './useNotificationPermission';
export { useNotifications } from './useNotifications';

// ── Host adapter (adapt per project) ──────────────────────────────────────────
export { navigateFromNotification } from './navigation';
export { useNotificationSync, useRegisterPushToken } from './useNotificationSync';

// ── Components ────────────────────────────────────────────────────────────────
export { default as NotificationPermissionBanner } from './components/NotificationPermissionBanner';

// ── Service layer ─────────────────────────────────────────────────────────────
export type { ScheduleLocalOptions } from './service';
export {
  cancelLocalNotifications,
  clearBadge,
  configureNotifications,
  getBadgeCount,
  getFcmToken,
  getPermissionState,
  openNotificationSettings,
  scheduleLocalNotifications,
  setBadgeCount,
} from './service';

// ── Dev tracing ───────────────────────────────────────────────────────────────
export { describeRemoteMessage, logNotification } from './log';

// ── Pure helpers (exported for tests and advanced consumers) ──────────────────
export { canPrompt, derivePermissionState, isDelivering } from './permissionState';
export { canOpenRoute, parsePayload, resolveRoute } from './routing';

// ── Config ────────────────────────────────────────────────────────────────────
export type { NotificationChannelConfig, NotificationType } from './config';
export {
  ANDROID_DISPLAY_STRATEGY,
  CHANNEL_IDS,
  CLEAR_BADGE_ON_OPEN,
  DEFAULT_CHANNEL_ID,
  NOTIFICATION_TYPES,
  PRIMARY_CHANNEL_ID,
  ROUTE_BY_TYPE,
} from './config';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  LocalTrigger,
  NotificationContextValue,
  NotificationPayload,
  NotificationPermissionState,
} from './types';
