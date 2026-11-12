import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { PRIMARY_CHANNEL_ID } from './config';
import { useNotificationContext } from './NotificationProvider';
import { canPrompt, isDelivering } from './permissionState';
import type { NotificationPermissionState } from './types';

export interface UseNotificationPermissionReturn {
  state: NotificationPermissionState;
  /** True only when notifications will actually be delivered. */
  isEnabled: boolean;
  /** Whether the OS prompt is still reachable, or Settings is the only route. */
  canPrompt: boolean;
  /**
   * The single entry point to the OS prompt in this app.
   *
   * Falls through to Settings when the prompt is spent, so one CTA handles
   * every state and callers never have to branch.
   */
  requestOrOpenSettings: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Screen-level permission hook — the only route to the OS prompt.
 *
 * `NotificationProvider` reads permission but never asks for it, so mounting
 * this hook is what makes a screen able to prompt. That keeps the request on a
 * deliberate tap rather than firing at launch, where a user with no context
 * denies it and can never be asked again.
 *
 * Re-reads on focus as well as on the provider's foreground listener, so
 * returning from system settings updates the caller immediately rather than on
 * the next app switch.
 */
export function useNotificationPermission(): UseNotificationPermissionReturn {
  const { permission, refreshPermission, requestPermission, openSettings } =
    useNotificationContext();
  const [isBusy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshPermission();
    }, [refreshPermission]),
  );

  const requestOrOpenSettings = useCallback(async () => {
    if (isBusy) return;
    setBusy(true);

    try {
      if (canPrompt(permission)) {
        const next = await requestPermission();
        // A denial at the prompt means iOS will never show it again. Rather
        // than leaving the user on a banner whose button just stopped working,
        // the next tap takes them to Settings — handled by `canPrompt(next)`
        // being false on the following render.
        if (next === 'granted') return;
        return;
      }

      // `blocked` and `channel-blocked` are only escapable through Settings.
      // The channel id is passed so Android lands on the muted channel itself
      // rather than the app's notification root, where the user would have to
      // find it.
      await openSettings(permission === 'channel-blocked' ? PRIMARY_CHANNEL_ID : undefined);
    } finally {
      setBusy(false);
    }
  }, [isBusy, openSettings, permission, requestPermission]);

  return {
    state: permission,
    isEnabled: isDelivering(permission),
    canPrompt: canPrompt(permission),
    requestOrOpenSettings,
    refresh: refreshPermission,
  };
}
