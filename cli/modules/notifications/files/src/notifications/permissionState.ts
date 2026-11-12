import { AuthorizationStatus } from 'react-native-notify-kit';

import type { NotificationPermissionState } from './types';

/**
 * Everything this function needs, named separately so tests can build one
 * without constructing a whole `NotificationSettings`.
 */
export interface PermissionInput {
  authorizationStatus: AuthorizationStatus;
  /** Android only: has the user muted `PRIMARY_CHANNEL_ID`? */
  isChannelBlocked?: boolean;
  /**
   * Whether the OS will still show a prompt.
   *
   * iOS: false after the first denial, always. Android: false after the second.
   * There is no API that reports this directly, so the caller tracks it — see
   * `hasRequested` in `useNotificationPermission`.
   */
  canAskAgain?: boolean;
}

/**
 * Raw OS status → the state the banner renders from.
 *
 * Pure, and the only place the five-way distinction is decided. Two orderings
 * here are load-bearing:
 *
 * 1. `channel-blocked` is checked FIRST, before authorization. It only occurs
 *    while app-level permission is granted, so checking it after would be
 *    unreachable — the function would have already returned `granted` and the
 *    user would sit in front of a screen that claims notifications are on
 *    while Android silently drops every one.
 *
 * 2. `DENIED` splits on `canAskAgain`. Collapsing the two gives the banner a
 *    button that calls `requestPermission()` into the void on iOS, which is
 *    worse than no button: it looks like the app is broken rather than like the
 *    user has a decision to reverse in Settings.
 *
 * `PROVISIONAL` counts as granted. iOS delivers those quietly to the
 * notification centre without a prompt, which is a real authorization — just a
 * less prominent one — and nothing in this app requests it today.
 */
export function derivePermissionState({
  authorizationStatus,
  isChannelBlocked = false,
  canAskAgain = true,
}: PermissionInput): NotificationPermissionState {
  const isAuthorized =
    authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    authorizationStatus === AuthorizationStatus.PROVISIONAL;

  if (isAuthorized) {
    return isChannelBlocked ? 'channel-blocked' : 'granted';
  }

  if (authorizationStatus === AuthorizationStatus.DENIED) {
    return canAskAgain ? 'denied' : 'blocked';
  }

  return 'undetermined';
}

/** Whether notifications will actually be delivered in this state. */
export function isDelivering(state: NotificationPermissionState): boolean {
  return state === 'granted';
}

/**
 * Whether the OS prompt is still reachable. `blocked` and `channel-blocked`
 * both need a trip to Settings instead, so the banner has to swap its CTA.
 */
export function canPrompt(state: NotificationPermissionState): boolean {
  return state === 'undetermined' || state === 'denied';
}
