/**
 * subscription/config.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EVERY project-specific value in this module lives here, apart from the user
 *  mapping in `useSubscriptionUser.ts`. See README.md § Setup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';

import Env from '@env';

// ─── RevenueCat API keys ──────────────────────────────────────────────────────
/**
 * The platform's public SDK key, from `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` /
 * `_ANDROID` in your `.env.*` files (RevenueCat → Project settings → API keys).
 *
 * Empty means "not set up yet": the provider skips RevenueCat entirely, nobody
 * is premium, and the paywall shows its "plans couldn't be loaded" state —
 * rather than the SDK throwing at startup.
 */
export const RC_API_KEY =
  (Platform.OS === 'android'
    ? Env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID
    : Env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS) ?? '';

// ─── Entitlement identifier ───────────────────────────────────────────────────
/**
 * The entitlement's identifier in the RevenueCat dashboard, exactly. Written by
 * `create-expo-boilerplate add subscriptions --entitlement`.
 *
 * Only THIS entitlement makes a user premium. Another active entitlement (a
 * second tier, a typo here) does not, and in development a warning names the
 * entitlements that were found instead — see `subscriptionState.ts`.
 */
export const ENTITLEMENT_ID = '__ENTITLEMENT_ID__';

// ─── Legal links ──────────────────────────────────────────────────────────────
/**
 * Shown under the paywall's purchase button. Both stores reject subscription
 * apps whose paywall doesn't link to the terms and privacy policy, so replace
 * these before you submit.
 */
export const TERMS_OF_USE_URL = 'https://example.com/terms';
export const PRIVACY_POLICY_URL = 'https://example.com/privacy';

// ─── Dev shortcut ─────────────────────────────────────────────────────────────
/**
 * When true, `isPremium` is always true in __DEV__ — for working on premium
 * screens without a sandbox purchase. Never true in a release build, and a
 * test fails if it is committed enabled.
 */
export const DEV_ALWAYS_PREMIUM = false;
