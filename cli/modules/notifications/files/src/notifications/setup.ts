/**
 * Imported for its side effects from the entry file (`index.ts`), before the
 * app renders anything.
 *
 * 1. The background / killed-state handlers must be registered at module scope
 *    — a headless JS runtime has no component tree to register them from.
 * 2. Android channels are created up front: on Android 13+ the OS refuses to
 *    show the permission prompt until the app has at least one channel. This
 *    never prompts by itself.
 */
import './backgroundHandler';

import { logNotification } from './log';
import { configureNotifications } from './service';

configureNotifications().catch((error: unknown) => {
  logNotification('configureNotifications FAILED', error);
});
