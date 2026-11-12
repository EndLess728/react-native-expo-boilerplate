/**
 * subscription/components/CrossPlatformNotice.tsx
 *
 * Names the store a subscription was actually bought in, for the user who is
 * looking at it from the other platform — bought on Android, now signed in on
 * iOS, or the reverse.
 *
 * It sits directly under the CTA rather than at the top of the paywall because
 * that CTA is the thing it explains: with a cross-store subscription the button
 * says "Manage Subscription" instead of offering a plan, and without this the
 * screen never says why the plan cards stopped being buyable. RevenueCat cannot
 * move a subscription between stores, so upgrading, downgrading and cancelling
 * all have to happen where it was purchased.
 *
 * Text only, deliberately: the button above it already opens the management
 * URL, and a second link to the same place reads as two different actions.
 */

import React from 'react';
import { Text, View } from 'react-native';

import { useTranslate } from '@/localization/utils';

import { useSubscriptionContext } from '../SubscriptionProvider';
import type { SubscriptionStore } from '../types';

/**
 * What the user calls the store, not what RevenueCat calls it. Left untranslated
 * on purpose — these are brand names, and "Google Play" is "Google Play" in
 * every locale the app ships. No leading article, so the name drops cleanly into
 * the Spanish and Arabic sentences too.
 *
 * STRIPE is deliberately absent alongside OTHER: a web subscription has no store
 * app to send anyone to, so it gets the store-free copy.
 */
const STORE_NAMES: Partial<Record<NonNullable<SubscriptionStore>, string>> = {
  APP_STORE: 'App Store',
  PLAY_STORE: 'Google Play',
  AMAZON: 'Amazon Appstore',
};

/** No warning token in the theme; amber reads as "act soon" on light and dark. */
const WARNING = '#E0A100';

export default function CrossPlatformNotice(): React.JSX.Element | null {
  const t = useTranslate();
  const { isCrossPlatformSubscription, subscriptionStore: store } = useSubscriptionContext();

  if (!isCrossPlatformSubscription) return null;

  // 'OTHER' and null reach here whenever the store is one we have no name for.
  // Falling back to store-free copy beats interpolating "PLAY_STORE" — or an
  // empty string — into a sentence shown to a paying user.
  const storeName = store ? STORE_NAMES[store] : undefined;

  return (
    <View
      accessibilityRole="alert"
      className="mt-3 gap-1 rounded-lg border bg-surface p-3"
      style={{ borderColor: WARNING }}
    >
      <Text className="text-center text-body-sm font-opensans-semibold text-typography">
        {storeName
          ? t('subscription.cross_platform_title', { store: storeName })
          : t('subscription.cross_platform_title_generic')}
      </Text>
      <Text className="text-center text-caption font-opensans text-typography opacity-80">
        {storeName
          ? t('subscription.cross_platform_body', { store: storeName })
          : t('subscription.cross_platform_body_generic')}
      </Text>
    </View>
  );
}
