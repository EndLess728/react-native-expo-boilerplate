/**
 * subscription/service.ts
 *
 * Pure RevenueCat SDK wrappers — no React, no state beyond "configured yet?".
 * Swap this file if you ever migrate away from react-native-purchases.
 *
 *  • Every call that can run in the background is wrapped so callers never
 *    crash on it; purchase and restore rethrow, because the UI must react.
 *  • configurePurchases is idempotent, and is never undone: RevenueCat is
 *    configured once per process. Switching users is logIn / logOut.
 *  • Log level is ERROR in production and DEBUG in dev.
 */

import Purchases, {
  type CustomerInfo,
  type IntroEligibility,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesPackage,
  type StoreProductChangeInfo,
} from 'react-native-purchases';

import { RC_API_KEY } from './config';
import type { RevenueCatUser } from './types';

let _isConfigured = false;

/** Whether RevenueCat is set up for this process. False until a key is configured. */
export const isPurchasesConfigured = (): boolean => _isConfigured;

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Initialise RevenueCat. Idempotent — calling it again is a no-op.
 *
 * @param userId  The backend user id when already signed in, so the SDK starts
 *                as that user instead of minting an anonymous id first.
 *
 * Without an API key this logs a dev warning and does nothing: the app runs as
 * if nobody is premium until the key is added to the env files.
 */
export const configurePurchases = async (userId?: string): Promise<void> => {
  if (_isConfigured) return;

  if (!RC_API_KEY) {
    if (__DEV__) {
      console.warn(
        '[subscription] No RevenueCat API key — set EXPO_PUBLIC_REVENUECAT_API_KEY_IOS / ' +
          '_ANDROID in your .env files. Subscriptions are disabled until then.',
      );
    }
    return;
  }

  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey: RC_API_KEY, appUserID: userId ?? undefined });
    _isConfigured = true;
    if (__DEV__) console.log('✅ RevenueCat configured', { userId });
  } catch (error) {
    console.error('❌ RevenueCat configuration failed', error);
  }
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Identify the current user with RevenueCat, so purchases are attributed to
 * your user rather than an anonymous device id. No-op if already identified.
 */
export const loginToPurchases = async (
  user: RevenueCatUser,
): Promise<{ customerInfo: CustomerInfo; created: boolean } | null> => {
  if (!_isConfigured) return null;
  try {
    const isAnon = await Purchases.isAnonymous();
    const currentUserId = await Purchases.getAppUserID();

    if (!isAnon && currentUserId === user.id) {
      return { customerInfo: await Purchases.getCustomerInfo(), created: false };
    }

    const { customerInfo, created } = await Purchases.logIn(user.id);
    await syncUserAttributes(user);

    if (__DEV__)
      console.log('✅ RevenueCat logged in', {
        userId: user.id,
        hasActiveEntitlement: Object.keys(customerInfo.entitlements.active).length > 0,
        isNewUser: created,
      });
    return { customerInfo, created };
  } catch (error) {
    console.error('❌ RevenueCat login error:', error);
    throw error;
  }
};

/**
 * Syncs user attributes (email, display name) to RevenueCat, for the dashboard
 * and integrations. Call it again whenever the profile changes.
 */
export const syncUserAttributes = async (user: Partial<RevenueCatUser>): Promise<void> => {
  if (!_isConfigured) return;
  try {
    if (user.email) await Purchases.setEmail(user.email);

    const { first_name, last_name } = user;
    // Backends serialise a missing name as the string "null" surprisingly often.
    const firstName = first_name && first_name !== 'null' ? first_name.trim() : '';
    const lastName = last_name && last_name !== 'null' ? last_name.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) await Purchases.setDisplayName(fullName);
  } catch (error) {
    console.error('❌ RevenueCat sync attributes error:', error);
  }
};

/**
 * Detach the signed-in user (call on sign-out). The SDK stays configured and
 * switches to a fresh anonymous id, so the next account does not inherit this
 * one's entitlements.
 */
export const logoutFromPurchases = async (): Promise<CustomerInfo | null> => {
  if (!_isConfigured) return null;
  try {
    // Logging out an anonymous user is an error, not a no-op.
    if (await Purchases.isAnonymous()) return null;
    return await Purchases.logOut();
  } catch (error) {
    console.error('❌ RevenueCat logout error:', error);
    return null;
  }
};

/**
 * Makes sure the SDK is identified as `userId` before money moves. Compares
 * against the CURRENT app user id — `originalAppUserId` stays the anonymous id
 * for anyone who used the app before signing in, and would re-login every time.
 */
export const ensureIdentifiedUser = async (userId: string): Promise<boolean> => {
  if (!_isConfigured) return false;
  try {
    if ((await Purchases.getAppUserID()) === userId) return false;
    if (__DEV__) console.log(`🔄 Re-identifying RevenueCat user as ${userId}`);
    await Purchases.logIn(userId);
    return true;
  } catch (error) {
    console.error('❌ ensureIdentifiedUser error', error);
    return false;
  }
};

// ─── Offerings ────────────────────────────────────────────────────────────────

/** The current offering, or null when none is configured or the fetch failed. */
export const getOfferings = async (): Promise<PurchasesOffering | null> => {
  if (!_isConfigured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    if (__DEV__ && !offerings.current) {
      console.warn('[subscription] No current offering — mark one as current in RevenueCat.');
    }
    return offerings.current ?? null;
  } catch (error) {
    console.error('❌ getOfferings error', error);
    return null;
  }
};

// ─── Customer info ────────────────────────────────────────────────────────────

/** The latest CustomerInfo for the current user (served from cache when fresh). */
export const getCustomerInfo = async (): Promise<CustomerInfo | null> => {
  if (!_isConfigured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error('❌ getCustomerInfo error', error);
    return null;
  }
};

/**
 * Re-posts the device's store receipts to RevenueCat WITHOUT the sign-in prompt
 * `restorePurchases` can raise on iOS, then returns fresh CustomerInfo. For
 * silent recovery after a purchase reports "already purchased".
 */
export const syncAndRefresh = async (): Promise<CustomerInfo | null> => {
  if (!_isConfigured) return null;
  try {
    await Purchases.syncPurchases();
    await Purchases.invalidateCustomerInfoCache();
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error('❌ syncPurchases error', error);
    return null;
  }
};

// ─── Purchasing ───────────────────────────────────────────────────────────────

/**
 * Purchase a package. Throws `PurchasesError` — the provider decides what each
 * code means to the user (see purchaseErrors.ts).
 *
 * @param productChangeInfo  Android only. Names the subscription this purchase
 *   replaces. Omitting it on a plan change leaves the old subscription running
 *   and bills the user for both — see planChange.ts. Ignored on iOS, where
 *   StoreKit resolves the change through the shared subscription group.
 */
export const purchasePackage = async (
  pkg: PurchasesPackage,
  productChangeInfo?: StoreProductChangeInfo | null,
): Promise<CustomerInfo | null> => {
  try {
    // Second argument is the deprecated UpgradeInfo; product change info is third.
    const { customerInfo } = await Purchases.purchasePackage(pkg, null, productChangeInfo ?? null);
    return customerInfo;
  } catch (error) {
    const purchaseError = error as PurchasesError;
    if (__DEV__ && purchaseError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      console.log('ℹ️ User cancelled the purchase.');
    }
    throw purchaseError;
  }
};

/**
 * Restore previously purchased subscriptions — the user-facing "Restore
 * Purchases" button. May show the store's sign-in prompt. Throws on failure.
 */
export const restorePurchases = async (): Promise<CustomerInfo> => Purchases.restorePurchases();

// ─── Trial eligibility ────────────────────────────────────────────────────────

/** Whether this user can still claim each product's introductory offer. */
export const checkTrialEligibility = async (
  productIdentifiers: string[],
): Promise<{ [key: string]: IntroEligibility }> => {
  if (!_isConfigured) return {};
  try {
    return await Purchases.checkTrialOrIntroductoryPriceEligibility(productIdentifiers);
  } catch (error) {
    console.error('❌ checkTrialEligibility error', error);
    return {};
  }
};

// ─── Real-time listener ───────────────────────────────────────────────────────

/** Subscribe to customerInfo changes. Pair with `removeCustomerInfoUpdateListener`. */
export const addCustomerInfoUpdateListener = (
  listener: (customerInfo: CustomerInfo) => void,
): void => {
  if (_isConfigured) Purchases.addCustomerInfoUpdateListener(listener);
};

export const removeCustomerInfoUpdateListener = (
  listener: (customerInfo: CustomerInfo) => void,
): void => {
  if (_isConfigured) Purchases.removeCustomerInfoUpdateListener(listener);
};

/** Test-only: forget the configured flag between test cases. */
export const __resetForTests = (): void => {
  _isConfigured = false;
};
