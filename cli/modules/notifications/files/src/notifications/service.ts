import { Linking, Platform } from 'react-native';
import notifee, {
  AlarmType,
  AndroidImportance,
  AuthorizationStatus,
  RepeatFrequency,
  TriggerType,
} from 'react-native-notify-kit';
import { getApp } from '@react-native-firebase/app';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh as onFcmTokenRefresh,
  registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';

import { createChannels, isPrimaryChannelBlocked } from './channels';
import { DEFAULT_CHANNEL_ID, PRIMARY_CHANNEL_ID } from './config';
import { describeRemoteMessage, logNotification } from './log';
import { subscribeToPendingPress } from './pendingPress';
import { derivePermissionState } from './permissionState';
import { parsePayload } from './routing';
import type { LocalTrigger, NotificationPayload, NotificationPermissionState } from './types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The ONLY file in the codebase that imports `react-native-notify-kit` or
 *  `@react-native-firebase/messaging`.
 *
 *  No React, no state. Everything above this line talks to the app; everything
 *  below talks to the OS. Swapping the stack — to expo-notifications, or back
 *  to Notifee, or forward to whatever replaces NotifyKit — is a rewrite of this
 *  file and nothing else, which is the point given the display layer here is a
 *  single-maintainer fork. See README.md § Replacing the stack.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The modular Messaging instance.
 *
 * React Native Firebase v22 deprecated the namespaced `messaging()` call and
 * every method reached through it; v25 warns on each use and the next major
 * removes them outright. The modular form takes the instance as its first
 * argument instead, matching the Firebase Web SDK.
 *
 * Resolved lazily rather than at module load: `getApp()` throws if Firebase has
 * not finished initialising, and this file is imported during the first render
 * pass. A getter defers that to first use, by which point the native app object
 * exists.
 */
const fcm = () => getMessaging(getApp());

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Channels first, then anything else that must exist before a notification can
 * arrive. Never prompts — see README.md § Permission policy for why the
 * request lives behind one screen instead.
 */
export async function configureNotifications(): Promise<void> {
  await createChannels();
}

// ── Permission ───────────────────────────────────────────────────────────────

export async function getPermissionState(canAskAgain = true): Promise<NotificationPermissionState> {
  const settings = await notifee.getNotificationSettings();

  return derivePermissionState({
    authorizationStatus: settings.authorizationStatus,
    isChannelBlocked: await isPrimaryChannelBlocked(),
    canAskAgain,
  });
}

/**
 * Shows the OS prompt, once.
 *
 * Returns the state AFTER the answer. A `DENIED` result here means the prompt
 * has now been spent: iOS will never show it again, so the caller records that
 * and downgrades the banner to a Settings link.
 */
export async function requestPermission(): Promise<{
  state: NotificationPermissionState;
  granted: boolean;
}> {
  const settings = await notifee.requestPermission();
  const granted =
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;

  return {
    state: derivePermissionState({
      authorizationStatus: settings.authorizationStatus,
      isChannelBlocked: await isPrimaryChannelBlocked(),
      // A denial at the prompt is terminal on iOS and after the second refusal
      // on Android. Reporting `canAskAgain: false` here is what turns the
      // banner's CTA into "Open Settings" rather than a button that no-ops.
      canAskAgain: granted,
    }),
    granted,
  };
}

/** The only escape from `blocked` / `channel-blocked`. */
export async function openNotificationSettings(channelId?: string): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openSettings();
  } else {
    await notifee.openNotificationSettings(channelId);
  }
}

// ── Token ────────────────────────────────────────────────────────────────────

/**
 * The FCM registration token — the same kind of token on both platforms,
 * because iOS routes through Firebase's APNs relay. That is what lets the
 * backend keep one send path.
 *
 * iOS must register with APNs before Firebase can mint a token; on a simulator
 * that never completes, so this returns null there rather than hanging.
 */
export async function getFcmToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') {
      await registerDeviceForRemoteMessages(fcm());
    }
    const token = await getToken(fcm());
    // The token is what you paste into the Firebase console or a curl to send a
    // test push. Without printing it there is no way to target this device.
    logNotification('FCM token', token);
    return token;
  } catch {
    return null;
  }
}

/** Fires when FCM rotates the token. The backend must be told each time. */
export function onTokenRefresh(handler: (token: string) => void): () => void {
  return onFcmTokenRefresh(fcm(), handler);
}

// ── Foreground display ───────────────────────────────────────────────────────

/**
 * Draws a notification the app received while in the foreground.
 *
 * FCM hands foreground messages to JS and draws nothing itself, on either
 * platform. Without this call a foreground push is completely invisible — the
 * single most common bug in this stack, and one that passes every backend test
 * because the send succeeded.
 */
export async function displayForegroundNotification(
  title: string,
  body: string,
  payload: NotificationPayload,
  channelId: string = DEFAULT_CHANNEL_ID,
): Promise<void> {
  logNotification('FOREGROUND drawing notification', { title, body, channelId, payload });

  await notifee.displayNotification({
    title,
    body,
    data: payload as Record<string, string>,
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
    ios: {
      // Without these the banner is suppressed in the foreground even though
      // the notification is delivered.
      foregroundPresentationOptions: { banner: true, list: true, sound: true },
    },
  });
}

// ── Local scheduling ─────────────────────────────────────────────────────────

/**
 * Cancels every trigger whose id starts with `prefix`, and nothing else.
 *
 * Filtered rather than using `cancelAllNotifications`, so one feature's re-sync
 * cannot wipe triggers another feature scheduled. The caller owns its prefix
 * and is the only thing that can clear it.
 */
export async function cancelLocalNotifications(prefix: string): Promise<void> {
  const ids = await notifee.getTriggerNotificationIds();
  const ours = ids.filter((id) => id.startsWith(prefix));
  await Promise.all(ours.map((id) => notifee.cancelTriggerNotification(id)));
}

export interface ScheduleLocalOptions {
  /** Android channel these fire on. */
  channelId: string;
  /**
   * Cleared before scheduling, so a re-sync replaces rather than duplicates.
   * Pass the prefix every id in `triggers` shares.
   */
  cancelPrefix: string;
  /** Payload `data` written onto each trigger, so taps route like a push does. */
  data?: Record<string, string>;
}

/**
 * Makes the device's scheduled notifications match `triggers` exactly.
 *
 * Cancel-then-rebuild rather than diffing. The sets involved are small, the ids
 * are deterministic, and a diff would have to reason about a time change moving
 * every trigger at once — for no measurable gain.
 *
 * An empty `triggers` array therefore cancels everything and schedules nothing,
 * which is what lets a caller's on/off toggle behave as a delete without a
 * second code path.
 *
 * Domain-free by design: this schedules what it is given. Working out WHICH
 * instants to fire at is the calling feature's job.
 */
export async function scheduleLocalNotifications(
  triggers: readonly LocalTrigger[],
  { channelId, cancelPrefix, data }: ScheduleLocalOptions,
): Promise<void> {
  await cancelLocalNotifications(cancelPrefix);

  if (__DEV__) {
    console.log(
      `[notifications] scheduling ${triggers.length} local trigger(s)`,
      triggers.map((t) => `${t.id} @ ${new Date(t.timestamp).toLocaleString()}`),
    );
  }

  for (const trigger of triggers) {
    await notifee.createTriggerNotification(
      {
        id: trigger.id,
        title: trigger.title,
        body: trigger.body,
        data,
        android: {
          channelId,
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default', launchActivity: 'default' },
        },
        ios: { sound: 'default' },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: trigger.timestamp,
        // One trigger per weekday, repeating every week, so a Mon/Wed/Fri
        // schedule keeps firing without the app being opened.
        repeatFrequency: RepeatFrequency.WEEKLY,
        // SET_AND_ALLOW_WHILE_IDLE is the INEXACT alarm that still fires in
        // Doze. The exact variants (SET_EXACT*) need SCHEDULE_EXACT_ALARM,
        // which Android 12+ gates behind a user grant and Play Store policy
        // scrutinises — and which NotifyKit throws for when it is missing,
        // silently killing the whole sync. A reminder-style nudge does not need
        // to-the-second delivery, so this is the right trade rather than a
        // compromise.
        //
        // Not `allowWhileIdle: true` — that field is deprecated in favour of
        // `type`, and passing both is how you end up with the deprecated path
        // winning.
        alarmManager: { type: AlarmType.SET_AND_ALLOW_WHILE_IDLE },
      },
    );
  }
}

// ── Events ───────────────────────────────────────────────────────────────────

/**
 * How long NotifyKit gets to answer `getInitialNotification()` before the
 * Firebase result is used without it.
 *
 * NotifyKit's iOS implementation only releases its stored notification once a
 * native `didFinishLaunching` observer has marked it "gathered"; until then it
 * parks the promise's resolver and returns nothing. If that observer never runs
 * — a `+load` in a static library that was not force-loaded is the usual reason
 * — the promise NEVER SETTLES. Awaited in sequence, that alone is enough to
 * kill cold-start routing for remote pushes too, because the Firebase read
 * below it is simply never reached.
 */
const INITIAL_NOTIFICATION_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      logNotification('COLD START NotifyKit read timed out — using Firebase alone');
      resolve(fallback);
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * The notification that cold-started the app, if any.
 *
 * Both sources are checked because they answer different questions: NotifyKit
 * knows about locally scheduled triggers, Firebase knows about remote pushes,
 * and neither sees the other's. Checking only one silently breaks half the
 * deep links.
 *
 * Read in PARALLEL, and with a timeout on the NotifyKit half, so that one
 * library failing to answer cannot take the other down with it. Each store is
 * one-shot and independent — reading both costs nothing, and in practice only
 * one of them ever holds the tap.
 */
export async function getInitialPayload(): Promise<NotificationPayload | null> {
  const [local, remote] = await Promise.all([
    withTimeout(notifee.getInitialNotification(), INITIAL_NOTIFICATION_TIMEOUT_MS, null),
    getInitialNotification(fcm()).catch(() => null),
  ]);

  if (local?.notification.data) {
    const payload = parsePayload(local.notification.data);
    logNotification('COLD START from a local notification', payload);
    return payload;
  }

  if (remote?.data) {
    const payload = parsePayload(remote.data);
    logNotification('COLD START from a remote push', {
      payload,
      raw: describeRemoteMessage(remote),
    });
    return payload;
  }

  logNotification('COLD START no initial notification from either source');
  return null;
}

/**
 * Taps on a notification, whatever state the app was in when it happened.
 *
 * TWO sources, and the split is not the obvious one:
 *
 *  • The pending-press queue — EVERY press NotifyKit reports, on either of its
 *    channels. Both are subscribed at module scope in `backgroundHandler.ts`
 *    and funnelled into `pendingPress`, because NotifyKit's choice of channel
 *    depends on the app state at the instant it hands the event over, and on a
 *    cold start that instant is BEFORE this provider exists. A subscription
 *    made here would miss the launch it was written for. See
 *    `backgroundHandler.ts` for the full sequence.
 *
 *  • Firebase — a remote push tapped while the app was backgrounded, reported
 *    through `onNotificationOpenedApp`. NotifyKit hands remote notifications
 *    to Firebase on iOS (see the hand-back in `backgroundHandler.ts`), so this
 *    is the canonical path for a background push tap on both platforms.
 *
 * The two can occasionally both fire for one tap, depending on which library
 * owned the notification natively. `NotificationProvider` deduplicates on the
 * resolved route rather than trying to reconcile two different id schemes.
 */
export function onNotificationPress(handler: (payload: NotificationPayload) => void): () => void {
  const unsubscribePending = subscribeToPendingPress((payload) => {
    logNotification('PRESSED (via NotifyKit, delivered from the press queue)', payload);
    handler(payload);
  });

  const unsubscribeRemote = onNotificationOpenedApp(fcm(), (message) => {
    if (!message?.data) return;
    const payload = parsePayload(message.data);
    logNotification('PRESSED (app in background)', {
      payload,
      raw: describeRemoteMessage(message),
    });
    handler(payload);
  });

  return () => {
    unsubscribePending();
    unsubscribeRemote();
  };
}

/** Remote messages arriving while the app is in the foreground. */
export function onForegroundMessage(
  handler: (title: string, body: string, payload: NotificationPayload) => void,
): () => void {
  return onMessage(fcm(), (message) => {
    logNotification('FOREGROUND message received', describeRemoteMessage(message));
    handler(
      message.notification?.title ?? '',
      message.notification?.body ?? '',
      parsePayload(message.data),
    );
  });
}

// ── Dev diagnostics ──────────────────────────────────────────────────────────

/**
 * A handle on the live notification state, for the Metro console or an attached
 * debugger:
 *
 *   await globalThis.__notifications.dump()
 *
 * Stripped from release builds by the `__DEV__` guard. It exists because almost
 * every failure in this module is SILENT — a missing channel, a refused alarm
 * permission, a permission the user never granted — and all of them present
 * identically as "the notification didn't fire". Metro's runtime has no
 * `require`,
 * so without an explicit global there is no way to interrogate any of it from
 * outside the app.
 */
if (__DEV__) {
  (globalThis as Record<string, unknown>).__notifications = {
    dump: async () => {
      const settings = await notifee.getNotificationSettings();
      const ids = await notifee.getTriggerNotificationIds();
      const channel = await notifee.getChannel(PRIMARY_CHANNEL_ID);
      return {
        authorizationStatus: settings.authorizationStatus,
        android: settings.android,
        scheduledTriggerIds: ids,
        primaryChannel: channel ? { id: channel.id, importance: channel.importance } : null,
        primaryChannelBlocked: await notifee.isChannelBlocked(PRIMARY_CHANNEL_ID),
        now: new Date().toString(),
      };
    },
    /** Fires a notification through the primary channel, right now. */
    fireTestNotification: async () =>
      notifee.displayNotification({
        title: 'Test',
        body: 'Notification pipeline is working.',
        android: { channelId: PRIMARY_CHANNEL_ID, pressAction: { id: 'default' } },
      }),
    getPermissionState,
    scheduleLocalNotifications,
    cancelLocalNotifications,
  };
}
