import { getActionFromState, getStateFromPath } from '@react-navigation/native';

import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigationRef';

import { logNotification } from './log';

/** Frames to wait for `NavigationContainer` to report ready before giving up. */
const MAX_READY_FRAMES = 120;

/**
 * Opens a route resolved from a notification.
 *
 * Routes in `config.ts` are paths (`/settings`) so the config is the same
 * for Expo Router and React Navigation. They resolve through the deep-link
 * config in `src/navigation/linking.ts`, so any path that works as a deep link
 * works here, and one that doesn't is logged and ignored.
 */
export function navigateFromNotification(route: string, frame = 0): void {
  if (!navigationRef.isReady()) {
    if (frame < MAX_READY_FRAMES) {
      requestAnimationFrame(() => navigateFromNotification(route, frame + 1));
    } else {
      logNotification('ROUTE dropped — navigator never became ready', route);
    }
    return;
  }

  const state = getStateFromPath(route, linking.config);
  const action = state ? getActionFromState(state, linking.config) : undefined;

  if (!action) {
    logNotification('ROUTE dropped — no screen in linking.ts matches', route);
    return;
  }

  navigationRef.dispatch(action);
}
