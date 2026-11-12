import { useMemo } from 'react';

import { useCurrentUser } from '@/features/auth';

import type { RevenueCatUser } from './types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOST ADAPTER — map your signed-in user to a RevenueCat identity.
 *
 *  RevenueCat attributes purchases to `id`. It must be your backend's stable,
 *  non-guessable user id — never an email (it changes, and it is personal data
 *  RevenueCat would store as the customer key).
 *
 *  Until you return one, purchases are attributed to an anonymous id tied to
 *  this install: they still work and restore through the store account, but
 *  they don't follow the user to a new device via your login, and your
 *  backend can't match RevenueCat webhooks to a user.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useSubscriptionUser(): RevenueCatUser | null {
  const user = useCurrentUser();

  return useMemo(() => {
    if (!user) return null;
    // TODO: return { id: user.id, email: user.email } once your User has an id.
    return null;
  }, [user]);
}
