import { useNotificationContext } from './NotificationProvider';
import type { NotificationContextValue } from './types';

/**
 * Read-only-ish access to notification state from any screen.
 *
 * An alias for the context hook, kept as its own export so the common case
 * reads as `useNotifications()` and the context plumbing stays an
 * implementation detail of the module.
 */
export function useNotifications(): NotificationContextValue {
  return useNotificationContext();
}
