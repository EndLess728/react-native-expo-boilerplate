import { logNotification } from './log';
import type { NotificationPayload } from './types';

/**
 * A hand-off for notification presses that reach JS before anything can
 * navigate.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `backgroundHandler.ts` runs at module scope, in a runtime with no component
 * tree and no navigator, so it cannot route. Its original assumption was that a
 * background press always relaunches the app and `getInitialPayload()` would
 * pick the notification up on the next launch — true on Android, false on iOS
 * in two separate ways:
 *
 *  1. NotifyKit routes a press to the BACKGROUND channel whenever the app is
 *     not `UIApplicationStateActive` at the moment iOS delivers it — which is
 *     exactly the state during the tap that brings a BACKGROUNDED app forward.
 *     There is no relaunch, so nothing ever re-reads the initial payload
 *     (`hasHandledColdStartRef` has already fired) and the tap is lost.
 *
 *  2. When NotifyKit claims a remote notification on iOS (see
 *     `backgroundHandler.ts` § remote hand-back) its own
 *     `getInitialNotification()` still returns `null` for it — the native store
 *     is only released when the payload carried a NotifyKit-authored id — so a
 *     COLD start from that tap has nothing to read either.
 *
 * Both cases end with the same fact: the press is in JS, on the background
 * channel, and the only thing missing is somewhere to put it until the provider
 * is alive. That is this module.
 *
 * Module-scope state rather than storage: the background event and the app it
 * hands off to share one JS runtime in every case that reaches here — an iOS
 * background press, an iOS cold start, and an Android headless press that
 * launches the activity into the same process.
 */

let pending: NotificationPayload | null = null;
let deliver: ((payload: NotificationPayload) => void) | null = null;

/**
 * Records a press that had nowhere to go, or forwards it straight through if
 * the provider is already listening.
 *
 * Only the most recent press is held. Two taps queued at once would both have
 * to resolve to a route, and the second is the one the user actually chose.
 */
export function enqueuePress(payload: NotificationPayload): void {
  if (deliver) {
    logNotification('PRESS handed to the live listener', payload);
    deliver(payload);
    return;
  }

  logNotification('PRESS parked until the app can navigate', payload);
  pending = payload;
}

/**
 * Subscribes the app to presses arriving through the background channel, and
 * immediately drains anything parked before it mounted.
 *
 * The parked payload is cleared as it is delivered, so a remount cannot
 * re-navigate to a notification the user already followed.
 */
export function subscribeToPendingPress(
  handler: (payload: NotificationPayload) => void,
): () => void {
  deliver = handler;

  if (pending) {
    const queued = pending;
    pending = null;
    logNotification('PRESS drained from the background queue', queued);
    handler(queued);
  }

  return () => {
    if (deliver === handler) deliver = null;
  };
}

/** Test seam. Not part of the module's public API — see `index.ts`. */
export function __resetPendingPress(): void {
  pending = null;
  deliver = null;
}
