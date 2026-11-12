import React from 'react';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { openPaywall } from './navigation';
import { SubscriptionProvider } from './SubscriptionProvider';
import { useSubscriptionUser } from './useSubscriptionUser';

/**
 * `SubscriptionProvider` wired to this app: the user from `useSubscriptionUser`
 * and the paywall route from `navigation.ts`. Rendered once, in `AppProviders`,
 * around the navigation root.
 *
 * Also hosts `BottomSheetModalProvider`, which the premium gate sheet portals
 * into. If your app already renders one, remove it here.
 *
 * Pass `backendSubscription` here if your server keeps its own subscription
 * record (fed by RevenueCat webhooks) — it unlocks the account-hold and
 * scheduled-plan-change banners. See README.md § Backend record.
 */
export function SubscriptionRoot({ children }: { children: React.ReactNode }): React.JSX.Element {
  const userData = useSubscriptionUser();

  return (
    <BottomSheetModalProvider>
      <SubscriptionProvider userData={userData} onOpenPaywall={openPaywall}>
        {children}
      </SubscriptionProvider>
    </BottomSheetModalProvider>
  );
}
