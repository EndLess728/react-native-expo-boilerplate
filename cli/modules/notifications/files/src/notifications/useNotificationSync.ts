import { useCallback } from 'react';
import { Platform } from 'react-native';
import { createMutation } from 'react-query-kit';
import type { AxiosError } from 'axios';

import { client } from '@/services';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOST ADAPTER — the file to edit when your backend's token API differs.
 *
 *  Everything else in `src/notifications/` is project-agnostic apart from
 *  `config.ts`. This is where the module meets your API: change the endpoint
 *  or the body below to match it. See README.md § Backend contract.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Written by `create-expo-boilerplate add notifications --token-endpoint`. */
const TOKEN_ENDPOINT = '__TOKEN_ENDPOINT__';

type Variables = { token: string; platform: typeof Platform.OS };

export const useRegisterPushToken = createMutation<unknown, Variables, AxiosError>({
  mutationFn: async (variables) =>
    client({
      url: TOKEN_ENDPOINT,
      method: 'POST',
      data: variables,
      // Runs in the background with nothing the user could do about a failure,
      // so it must never surface as an error toast.
      silent: true,
    }).then((response) => response.data),
});

export function useNotificationSync() {
  const { mutateAsync: registerPushToken } = useRegisterPushToken();

  /**
   * Sends the token to the backend.
   *
   * Failures are swallowed on purpose. This runs in the background off a
   * permission change or a token refresh, with no UI attached and nothing the
   * user could do about it — and the token is re-registered on the next launch
   * anyway. Letting it reject would surface an unhandled rejection out of a
   * provider effect, which is noise rather than signal.
   */
  const registerToken = useCallback(
    async (token: string) => {
      try {
        await registerPushToken({ token, platform: Platform.OS });
      } catch {
        // Retried on next launch.
      }
    },
    [registerPushToken],
  );

  return { registerToken };
}

/**
 * ── Why there is no `revokeToken` ────────────────────────────────────────────
 *
 * The backend should detach the token from the user as part of its logout
 * endpoint, so signing out is what stops delivery. If yours doesn't, add a
 * call here and invoke it from your logout flow.
 *
 * The local token is deliberately NOT deleted. Deleting it would force FCM to
 * mint a fresh one on the next sign-in for no benefit: re-registering the same
 * token against the new user is both correct and cheaper.
 */
