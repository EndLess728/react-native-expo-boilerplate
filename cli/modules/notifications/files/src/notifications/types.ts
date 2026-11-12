import type { NotificationType } from './config';

/**
 * What the permission banner has to distinguish between.
 *
 * Deliberately richer than the OS's own three-way answer, because two of these
 * are states the raw status cannot express and both are silent failures:
 *
 * - `blocked` — permission was refused and the OS will never prompt again
 *   (iOS after any denial, Android after two). A CTA that calls
 *   `requestPermission()` here does nothing at all; the only way out is the
 *   system settings screen. Telling this apart from `denied` is the whole
 *   reason the union exists.
 *
 * - `channel-blocked` — Android only, and the nastiest of the five. App-level
 *   permission is granted, every permission API reports success, and the user
 *   has muted `PRIMARY_CHANNEL_ID` specifically. Those notifications simply
 *   never appear. Nothing surfaces this except an explicit channel check.
 */
export type NotificationPermissionState =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'channel-blocked';

/**
 * The `data` block of a remote message, after parsing.
 *
 * Every value arrives as a string — FCM does not carry types — so anything
 * numeric is parsed at the edge rather than trusted.
 */
export interface NotificationPayload {
  type: NotificationType;
  id?: string;
  [key: string]: string | undefined;
}

/**
 * One local notification to hand the OS, already resolved to a wall-clock
 * instant.
 *
 * Domain-free on purpose: this module schedules and cancels triggers, and has
 * no opinion on what they mean or how their times were worked out. Whatever
 * feature owns that logic builds these and calls `scheduleLocalNotifications`.
 */
export interface LocalTrigger {
  /**
   * Must start with the prefix the caller later cancels by, so a re-sync
   * replaces its own triggers and leaves every other feature's alone.
   */
  id: string;
  /** Epoch ms of the first occurrence. */
  timestamp: number;
  title: string;
  body: string;
}

export interface NotificationContextValue {
  /** Derived permission state, re-read on foreground and on screen focus. */
  permission: NotificationPermissionState;
  /** FCM registration token, both platforms. `null` until permission is granted. */
  fcmToken: string | null;
  /** Re-reads permission from the OS. Never prompts. */
  refreshPermission: () => Promise<void>;
  /**
   * Shows the OS prompt. Only ever reachable through
   * `useNotificationPermission`, so the prompt is spent on one screen and
   * nowhere else.
   */
  requestPermission: () => Promise<NotificationPermissionState>;
  /** Opens system settings — the only escape from `blocked`. */
  openSettings: (channelId?: string) => Promise<void>;
}
