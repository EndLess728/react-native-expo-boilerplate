import { Platform } from 'react-native';
import type { FcmRemoteMessage } from 'react-native-notify-kit';
import notifee, { EventType } from 'react-native-notify-kit';
import { getApp } from '@react-native-firebase/app';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import { ANDROID_DISPLAY_STRATEGY } from './config';
import { describeRemoteMessage, logNotification } from './log';
import { enqueuePress } from './pendingPress';
import { parsePayload } from './routing';

/**
 * Background and killed-state handlers.
 *
 * Registered at MODULE SCOPE, imported for its side effect from the entry file
 * (`index.ts` at the project root).
 * This is not stylistic: when a background message arrives the JS runtime is
 * spun up headless, with no component tree, so anything registered inside a
 * React component never runs. A handler attached in a `useEffect` is attached
 * too late by definition.
 */

/**
 * iOS ONLY — give remote-notification taps back to Firebase.
 *
 * Two libraries want to be `UNUserNotificationCenter.delegate`: NotifyKit and
 * React Native Firebase Messaging. NotifyKit always ends up holding it, because
 * it re-chains itself in on every `didBecomeActive` while Firebase installs
 * itself exactly once at launch.
 *
 * With `handleRemoteNotifications` left at its default of `true`, NotifyKit
 * then PARSES an FCM tap as its own instead of passing it down the chain
 * whenever it has no delegate below it to pass to. Firebase never learns the
 * notification was opened, and both of its tap APIs go quiet on iOS:
 *
 *   • `onNotificationOpenedApp()`      → background tap never routes
 *   • `getInitialNotification()`       → killed-state tap never routes
 *
 * NotifyKit cannot cover for it either: the payload it claimed carries no
 * NotifyKit-authored id, so its own `getInitialNotification()` returns `null`
 * for that tap as well. The notification opens the app and lands nowhere —
 * which is exactly the reported iOS bug, and why Android (no delegate chain,
 * no contest) was unaffected.
 *
 * Setting the flag makes NotifyKit forward every remote notification to
 * Firebase instead of claiming it, so remote push has one owner on iOS and
 * local triggers keep theirs. It is set here rather than in
 * `configureNotifications()` because this file is the earliest JS in the app —
 * `configureNotifications()` runs behind storage and i18n init, several
 * seconds into launch.
 *
 * A tap that beats even this — a cold start where iOS delivers the response
 * before the bundle has loaded — is caught by the press queue below.
 */
if (Platform.OS === 'ios') {
  void notifee
    .setNotificationConfig({ ios: { handleRemoteNotifications: false } })
    .catch((error) => {
      logNotification('iOS remote-notification hand-back to Firebase FAILED', error);
    });
}

/**
 * Remote messages while the app is backgrounded or killed.
 *
 * Under `fcm-draws` — the default strategy, where the backend sends a
 * `notification` block — FCM has ALREADY drawn the tray
 * notification by the time this runs. Calling `displayNotification` or
 * `handleFcmMessage` here would draw a second one, and the user gets every push
 * twice. That is the trap this file exists to make unreachable rather than
 * merely documented, so the strategy is branched on rather than assumed.
 *
 * The handler still has to exist and resolve: Firebase awaits it, and an
 * unregistered handler logs a warning on every background message.
 */
setBackgroundMessageHandler(getMessaging(getApp()), async (message) => {
  // Reaches Metro even though this runs headless with no component tree — the
  // only visibility into a push that arrived while the app was closed.
  logNotification('BACKGROUND/KILLED message received', describeRemoteMessage(message));

  if (ANDROID_DISPLAY_STRATEGY === 'app-draws') {
    // FCM Mode: data-only payloads, the app draws in every state. Requires the
    // backend to send NotifyKit-shaped payloads and an iOS Notification Service
    // Extension — see README.md § Switching to FCM Mode.
    // Firebase types `data` as `string | object` per key because it decodes
    // JSON-ish values; FCM only ever transmits strings, which is what NotifyKit
    // declares. The cast reconciles two descriptions of the same wire format.
    await notifee.handleFcmMessage(message as FcmRemoteMessage);
    return;
  }

  // `fcm-draws`: nothing to draw. Data-only side effects (cache warming, badge
  // counts) would go here — deliberately empty rather than absent, so the next
  // person sees that the omission is a decision.
});

/**
 * Taps and dismissals on a notification while the app is backgrounded.
 *
 * Routing is still NOT done here — there is no navigator mounted in a headless
 * runtime. The press is parsed and parked instead, and `NotificationProvider`
 * drains the queue once the router and auth guards are ready.
 *
 * Parking rather than relying on the next launch is what fixes the iOS
 * background tap: iOS delivers the response while the app is merely INACTIVE,
 * so NotifyKit routes it here, and a backgrounded app is never relaunched —
 * `getInitialPayload()` has already run and will not run again. See
 * `pendingPress.ts` for the full account.
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  logNotification('BACKGROUND event', {
    type: EventType[type] ?? type,
    data: detail.notification?.data,
  });

  if (type === EventType.PRESS && detail.notification?.data) {
    enqueuePress(parsePayload(detail.notification.data));
    return;
  }

  if (type === EventType.DISMISSED && detail.notification?.id) {
    await notifee.cancelNotification(detail.notification.id);
  }
});

/**
 * The SAME presses, on NotifyKit's other channel — subscribed here, at module
 * scope, rather than from the provider.
 *
 * NotifyKit splits presses across two channels by the app state at the moment
 * it hands the event to JS, and on a COLD START that split lands on the wrong
 * side of the app's own startup:
 *
 *  1. iOS delivers the tap response before the bundle has loaded, so there is
 *     no JS listener yet and NotifyKit buffers the event natively.
 *  2. The bundle loads, this file runs, the first listener attaches, and
 *     NotifyKit flushes the buffer — re-reading the app state AS IT FLUSHES.
 *     The app is `Active` by then (it is up, drawing the splash), so the press
 *     that was queued from a killed app comes out on the FOREGROUND channel.
 *  3. `NotificationProvider` does not mount until storage, i18n and the rest of
 *     `useAppBootstrap` have finished — potentially seconds after that flush.
 *
 * A foreground subscription that lives in the provider is therefore attached
 * several seconds too late to catch the launch it exists for, and the press is
 * dropped with nothing listening. Subscribing here closes the window: this is
 * the first app code in the bundle, so the listener is in place before the
 * flush can happen, and `pendingPress` holds whatever arrives until the
 * provider is ready for it.
 *
 * This is why the provider no longer calls `onForegroundEvent` itself — see
 * `service.ts` § onNotificationPress.
 */
notifee.onForegroundEvent(({ type, detail }) => {
  if (type !== EventType.PRESS || !detail.notification?.data) return;

  logNotification('FOREGROUND-CHANNEL press', detail.notification.data);
  enqueuePress(parsePayload(detail.notification.data));
});
