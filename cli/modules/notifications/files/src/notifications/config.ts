import { AndroidImportance } from 'react-native-notify-kit';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EVERY project-specific value in this module lives here.
 *
 *  Porting to another app means editing this file and `useNotificationSync.ts`,
 *  and nothing else. See README.md § Porting.
 *
 *  Nothing outside this file names a channel, a payload type, or a route. If
 *  you find yourself writing `CHANNEL_IDS.something` in another file, that is
 *  the coupling this layout exists to prevent — add a constant here instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The payload discriminators this app understands.
 *
 * Declared here rather than in `types.ts` because it is a per-project list, and
 * `NotificationType` is derived from it so adding a type is one edit. Anything
 * off this list degrades to `general` at the parse edge — see `routing.ts`.
 */
export const NOTIFICATION_TYPES = ['general', 'account'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The shape of an Android channel declaration. */
export interface NotificationChannelConfig {
  id: string;
  name: string;
  description?: string;
  importance?: AndroidImportance;
  vibration?: boolean;
  sound?: string;
}

// ── Channels ─────────────────────────────────────────────────────────────────

/**
 * Android channel ids carry a VERSION SUFFIX, and it is not decoration.
 *
 * Once a channel exists on a device, Android freezes everything about it except
 * the name and description — importance, sound, and vibration cannot be changed
 * for as long as the app stays installed. Shipping the wrong importance in v1
 * would otherwise strand every existing user on it forever.
 *
 * To change any frozen property: bump the suffix, add the old id to
 * `DEPRECATED_CHANNEL_IDS` so it gets deleted, and update the backend's
 * `channel_id` to match. Be aware this resets any per-channel preference the
 * user had set, so do it deliberately rather than routinely.
 */
export const CHANNEL_IDS = {
  general: 'general.v1',
} as const;

/** Channels retired by a version bump. Deleted at startup. */
export const DEPRECATED_CHANNEL_IDS: readonly string[] = [];

/**
 * The channel FCM falls back to when a payload carries no `channel_id`.
 *
 * The backend is not required to send one, so this has to match the
 * `com.google.firebase.messaging.default_notification_channel_id` value written
 * into the manifest by `plugins/withAndroidDefaultNotificationChannel`. If the
 * two drift apart, Android silently invents a low-importance "Miscellaneous"
 * channel and every remote notification stops appearing as heads-up.
 */
export const DEFAULT_CHANNEL_ID: string = CHANNEL_IDS.general;

/**
 * The channel whose mute state the permission UI cares about.
 *
 * Android lets a user grant app-level permission and then silence one channel.
 * Every permission API still reports success while that channel's
 * notifications are dropped — the `channel-blocked` state. Checking it needs a
 * specific channel, so this names the one that matters most to this app.
 *
 * It is also where `openSettings` deep-links, so the user lands on the muted
 * channel rather than the app's notification root.
 *
 * With a single channel that is the default one. When you add a channel for a
 * feature whose whole value is arriving on time (reminders, alerts), point this
 * at it instead.
 */
export const PRIMARY_CHANNEL_ID: string = CHANNEL_IDS.general;

/**
 * Heads-up requires importance HIGH or above on the channel AND
 * `priority: "high"` on the FCM message. Both halves are necessary; neither is
 * sufficient. See README.md § Heads-up.
 */
export const CHANNELS: readonly NotificationChannelConfig[] = [
  {
    id: CHANNEL_IDS.general,
    name: 'General',
    description: 'Announcements and updates.',
    importance: AndroidImportance.HIGH,
    vibration: true,
  },
];

// ── Delivery ─────────────────────────────────────────────────────────────────

/**
 * How Android draws REMOTE notifications.
 *
 * `fcm-draws` (the default): the backend sends a `notification` block, so FCM
 * renders the tray notification itself in background and killed states, and the
 * app draws only in the foreground. Works with any standard FCM sender.
 *
 * The trap this constant exists to prevent: under `fcm-draws` the background
 * message handler must NEVER call `displayNotification` or `handleFcmMessage` —
 * FCM has already drawn that notification and doing so draws a second one. The
 * flag is read by `backgroundHandler.ts` so the rule is enforced rather than
 * remembered.
 *
 * `app-draws` is NotifyKit's FCM Mode: data-only payloads drawn by the app in
 * every state, identical styling throughout. Switching needs a backend payload
 * change and an iOS Notification Service Extension — see README.md.
 */
export const ANDROID_DISPLAY_STRATEGY: 'fcm-draws' | 'app-draws' = 'fcm-draws';

// ── Routing ──────────────────────────────────────────────────────────────────

/**
 * Payload `type` → in-app route.
 *
 * The client owns this map rather than following a server-supplied URL. A push
 * payload is attacker-reachable if the backend is ever compromised or a message
 * is malformed, and an allowlist means the worst case is a notification that
 * does nothing rather than one that deep-links anywhere it likes.
 *
 * `null` means "just open the app" — a valid outcome, not a missing entry.
 */
export const ROUTE_BY_TYPE: Record<NotificationType, string | null> = {
  general: null,
  // Example: an account alert (new sign-in, profile change) opens Settings.
  account: '/settings',
};

/**
 * Types whose payload `id` is appended to the route as `?id=…` (URI-encoded).
 * Add a type here when its screen takes an id, e.g. `order` → `/orders?id=42`.
 */
export const TYPES_WITH_ID: readonly NotificationType[] = [];

/**
 * Backend payload value → internal `NotificationType`.
 *
 * The wire format is the backend's, not ours — e.g. SCREAMING_SNAKE
 * (`ACCOUNT_ALERT`) under a `notification_type` key. Translating at the edge
 * means the rest of the module keeps its own vocabulary, and a backend rename
 * is one line here instead of a find-and-replace through routing, config and
 * tests.
 *
 * Keys are matched case-insensitively after trimming — see `parsePayload`.
 */
export const TYPE_BY_PAYLOAD_VALUE: Record<string, NotificationType> = {
  GENERAL: 'general',
  ACCOUNT: 'account',
  ACCOUNT_ALERT: 'account',
};

/** Routes that require a signed-in user. Dropped when logged out. */
export const AUTHENTICATED_ROUTES: readonly string[] = ['/settings'];
