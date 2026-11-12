import { Alert, Linking, Platform } from 'react-native';

import { translate } from '@/localization/utils';

/**
 * Opens the store's own subscription-management page — the only place a user
 * can cancel, change payment method or switch plans for a store subscription.
 *
 * RevenueCat's `managementURL` is null for some purchases (promotional grants,
 * some sandbox states); then the user is told where to find it themselves
 * rather than tapping a button that does nothing.
 */
export async function openSubscriptionManagement(managementURL: string | null): Promise<void> {
  if (managementURL) {
    try {
      await Linking.openURL(managementURL);
      return;
    } catch {
      // Fall through to the instructions.
    }
  }
  Alert.alert(
    translate('subscription.manage_unavailable_title'),
    translate(
      Platform.OS === 'android'
        ? 'subscription.manage_unavailable_android'
        : 'subscription.manage_unavailable_ios',
    ),
  );
}
