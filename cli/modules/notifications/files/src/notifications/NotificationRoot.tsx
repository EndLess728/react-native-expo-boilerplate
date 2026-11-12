import React from 'react';

import { useIsLoggedIn } from '@/features/auth';

import { navigateFromNotification } from './navigation';
import { NotificationProvider } from './NotificationProvider';

/**
 * `NotificationProvider` wired to this app: the session from the auth feature
 * and the navigator from `navigation.ts`. Rendered once, in `AppProviders`,
 * around the navigation root.
 */
export function NotificationRoot({ children }: { children: React.ReactNode }): React.JSX.Element {
  const isLoggedIn = useIsLoggedIn();

  return (
    <NotificationProvider isLoggedIn={isLoggedIn} onNavigate={navigateFromNotification}>
      {children}
    </NotificationProvider>
  );
}
