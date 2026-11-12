/**
 * subscription/SubscriptionProvider.tsx
 *
 * The single owner of the RevenueCat lifecycle: configuration, identity,
 * offerings, the customer-info listener, purchases, restores, and the premium
 * gate sheet. Rendered once, by `SubscriptionRoot` in `AppProviders`.
 *
 *  • One RC listener for the whole app — consumers read context, never the SDK.
 *  • Every listener is removed in its effect's cleanup.
 *  • A cancelled flag stops state updates after unmount or a user switch.
 *  • Host callbacks live in refs, so a new callback identity never re-runs the
 *    bootstrap.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Platform } from 'react-native';
import {
  INTRO_ELIGIBILITY_STATUS,
  type PurchasesError,
  type StoreProductChangeInfo,
} from 'react-native-purchases';

import { translate } from '@/localization/utils';
import { showErrorToast, showInfoToast, showSuccessToast } from '@/shared/utils/toast';

import PremiumGate, { type PremiumGateHandle } from './components/PremiumGate';
import { DEV_ALWAYS_PREMIUM } from './config';
import { formatIntroOffer } from './introOffer';
import { planChangeNotice, resolvePlanChange } from './planChange';
import { describePurchaseError, planChangeBlockedMessage } from './purchaseErrors';
import {
  addCustomerInfoUpdateListener,
  checkTrialEligibility,
  configurePurchases,
  ensureIdentifiedUser,
  getCustomerInfo,
  getOfferings,
  loginToPurchases,
  logoutFromPurchases,
  purchasePackage,
  removeCustomerInfoUpdateListener,
  restorePurchases,
  syncAndRefresh,
  syncUserAttributes,
} from './service';
// Entitlement and subscription-state derivation lives in subscriptionState.ts so
// it can be unit-tested without mounting the provider.
import {
  deriveSubscriptionState,
  getActiveEntitlement,
  getSubscriptionStore,
  isCrossStore,
  isEntitlementActive,
} from './subscriptionState';
import type {
  CustomerInfo,
  IntroEligibility,
  PremiumGateCopy,
  PurchasesOffering,
  PurchasesPackage,
  SubscriptionContextConfig,
  SubscriptionContextValue,
} from './types';

// ─── Context ──────────────────────────────────────────────────────────────────

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

/**
 * Hand a finished purchase or restore to the host app WITHOUT holding the UI on
 * it.
 *
 * Awaiting it would make the host's bookkeeping part of the purchase: if the
 * callback waits on a backend, `isPurchasing` stays true after the store has
 * already taken the money and RevenueCat has already granted the entitlement,
 * and the purchase looks stuck at exactly the moment it succeeded.
 *
 * The entitlement comes from RevenueCat, not from the host callback, so nothing
 * the user sees depends on this finishing. Failures are logged rather than
 * thrown: an unhandled rejection here would surface long after the purchase
 * the user already completed.
 */
const notifyHost = (
  handler: ((info: CustomerInfo) => void | Promise<void>) | undefined,
  info: CustomerInfo,
  label: string,
) => {
  try {
    void Promise.resolve(handler?.(info)).catch((error) => {
      console.warn(`[subscription] ${label} callback failed:`, error);
    });
  } catch (error) {
    console.warn(`[subscription] ${label} callback threw:`, error);
  }
};

const alertSubscriptionLinked = () =>
  Alert.alert(translate('subscription.linked_title'), translate('subscription.linked_body'), [
    { text: translate('common.ok'), style: 'cancel' },
  ]);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface SubscriptionProviderProps extends SubscriptionContextConfig {
  children: React.ReactNode;
  /** Opens the paywall screen; the gate sheet's CTA calls it. See `navigation.ts`. */
  onOpenPaywall: () => void;
}

export const SubscriptionProvider = ({
  children,
  userData,
  backendSubscription,
  onPurchaseSuccess,
  onRestoreSuccess,
  onOpenPaywall,
}: SubscriptionProviderProps) => {
  // ── Stable callback refs — changing callbacks doesn't cause re-renders ──────
  const onPurchaseSuccessRef = useRef(onPurchaseSuccess);
  const onRestoreSuccessRef = useRef(onRestoreSuccess);
  useEffect(() => {
    onPurchaseSuccessRef.current = onPurchaseSuccess;
    onRestoreSuccessRef.current = onRestoreSuccess;
  }, [onPurchaseSuccess, onRestoreSuccess]);

  // The identity RevenueCat was last given. RC keeps whoever it was told about
  // until told otherwise, so signing out has to be pushed to it — otherwise the
  // next account inherits this one's entitlements. Remembering it tells a
  // sign-out apart from a cold start that was never signed in.
  const identifiedUserIdRef = useRef<string | null>(null);

  // ── RC state ─────────────────────────────────────────────────────────────────
  const [offerings, setOfferings] = useState<PurchasesOffering | null>(null);
  const [availablePackages, setAvailablePackages] = useState<PurchasesPackage[]>([]);
  const [trialEligibility, setTrialEligibility] = useState<{
    [productId: string]: IntroEligibility;
  }>({});
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * The gate sheet is raised through this ref, and its open/closed state lives
   * in `PremiumGate` rather than here: every render of this provider re-renders
   * every context consumer, so holding the flag here would re-render the whole
   * visible app on the sheet's first animation frames.
   */
  const gateRef = useRef<PremiumGateHandle>(null);

  // ── isPremium: driven purely by the live RC entitlement ──────────────────
  const isPremium =
    DEV_ALWAYS_PREMIUM && __DEV__ ? true : customerInfo ? isEntitlementActive(customerInfo) : false;

  // ── Derived subscription state ─────────────────────────────────────────────
  // Grace period, cancelled-but-active, in-trial, paused, family-shared,
  // lifetime — plus the two states only a backend record can carry (account
  // hold, scheduled plan change). Every consumer reads this one answer.
  const subscriptionState = deriveSubscriptionState(customerInfo, backendSubscription);

  const subscriptionStore = getSubscriptionStore(customerInfo);
  const isCrossPlatformSubscription = isCrossStore(subscriptionStore, Platform.OS);
  const managementURL = customerInfo?.managementURL ?? null;

  // ── Load offerings + packages + trial eligibility ────────────────────────
  async function loadOfferings() {
    const current = await getOfferings();
    if (!current?.availablePackages?.length) {
      // Leaves `availablePackages` empty. The paywall reads that as "could not
      // load" and offers a retry rather than rendering empty prices.
      return;
    }
    setOfferings(current);
    // Taken whole, in RevenueCat's order: what the offering contains is what the
    // paywall shows, so a plan added in the dashboard lands without a release.
    setAvailablePackages(current.availablePackages);
    setTrialEligibility(
      await checkTrialEligibility(current.availablePackages.map((pkg) => pkg.product.identifier)),
    );
  }

  // ── Configure RC + identity + data + listeners ────────────────────────────
  // Keyed on the user's ID, not the `userData` object: hosts commonly build that
  // object inline, and a new identity every render would re-run all of this —
  // RevenueCat calls, listener churn, an offerings refetch — on every render.
  const userId = userData?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Synchronous up to `Purchases.configure`, so the listener added below
        // finds the SDK configured.
        await configurePurchases(userId ?? undefined);

        if (userId) {
          await loginToPurchases({ id: userId });
          identifiedUserIdRef.current = userId;
        } else if (identifiedUserIdRef.current) {
          await logoutFromPurchases();
          identifiedUserIdRef.current = null;
        }

        const [info] = await Promise.all([getCustomerInfo(), loadOfferings()]);
        if (!cancelled) setCustomerInfo(info);
      } catch (err) {
        console.error('❌ SubscriptionProvider: bootstrap failed', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();

    const onCustomerInfo = (info: CustomerInfo) => {
      if (!cancelled) setCustomerInfo(info);
    };
    addCustomerInfoUpdateListener(onCustomerInfo);

    // Renewals, cancellations and refunds happen while the app is away.
    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') return;
      void getCustomerInfo().then((info) => {
        if (info && !cancelled) setCustomerInfo(info);
      });
    };
    const appStateSub = AppState.addEventListener('change', onAppState);

    return () => {
      cancelled = true;
      removeCustomerInfoUpdateListener(onCustomerInfo);
      appStateSub.remove();
    };
    // `loadOfferings` only touches state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Profile attributes follow the profile, without re-running the bootstrap.
  const email = userData?.email;
  const firstName = userData?.first_name;
  const lastName = userData?.last_name;
  useEffect(() => {
    if (!userId) return;
    void syncUserAttributes({ email, first_name: firstName, last_name: lastName });
  }, [userId, email, firstName, lastName]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const purchase = async (pkg: PurchasesPackage): Promise<CustomerInfo | null> => {
    setIsPurchasing(true);

    /**
     * Set when this purchase is a plan CHANGE rather than a first subscription,
     * along with what was active before it. Recovery needs both: "you already
     * have an active entitlement" is success for a first purchase, but for a
     * change it can mean the OLD plan is still sitting there.
     */
    let productChange: StoreProductChangeInfo | null = null;
    let activeBefore: readonly string[] = [];

    try {
      // Safety net: make sure RC is identified as the current user.
      if (userId) await ensureIdentifiedUser(userId);

      // Fresh data for the guards below.
      const freshInfo = await getCustomerInfo();
      if (freshInfo) setCustomerInfo(freshInfo);
      const infoToUse = freshInfo ?? customerInfo;

      // Cross-store guard, enforced here rather than only on the paywall so no
      // second entry point to purchase() can bypass it: the store cannot replace
      // a subscription it does not own, so it starts a SECOND one and the user
      // is billed by both.
      if (isCrossStore(getSubscriptionStore(infoToUse), Platform.OS)) {
        showErrorToast({
          title: translate('subscription.wrong_store_title'),
          message: translate('subscription.wrong_store_body'),
          visibilityTime: 6000,
        });
        return null;
      }

      // A cancelled-but-still-active subscription is deliberately NOT blocked:
      // both stores allow resubscribing, and it is the one recoverable moment
      // in the churn path.

      // Google Play has to be told which subscription this purchase replaces.
      // Left out, it starts a second subscription alongside the first and the
      // user pays for both. StoreKit works it out itself, so iOS passes null.
      activeBefore = infoToUse?.activeSubscriptions ?? [];
      productChange =
        Platform.OS === 'android' && infoToUse
          ? resolvePlanChange({
              activeSubscriptions: infoToUse.activeSubscriptions,
              nextPackage: pkg,
              availablePackages: offerings?.availablePackages ?? [],
              // Upgrading out of a trial must be charged now, not granted free
              // until the trial's original end date.
              isInTrial: getActiveEntitlement(infoToUse)?.periodType === 'TRIAL',
            })
          : null;

      const info = await purchasePackage(pkg, productChange);
      if (!info) return null;

      setCustomerInfo(info);

      // Both delayed replacement modes leave the paywall looking unchanged in
      // some way; without a word about it users try to buy again.
      const changeNotice = planChangeNotice(productChange);
      if (changeNotice) {
        showSuccessToast({
          title: translate('subscription.plan_updated_title'),
          message: changeNotice,
          visibilityTime: 6000,
        });
      }

      // Two live store subscriptions at once — a duplicate from before the
      // product-change fix, or one made from another store account. This device
      // can't cancel it, so say so and point at support.
      if ((info.activeSubscriptions?.length ?? 0) > 1) {
        console.warn('[subscription] Multiple active subscriptions:', info.activeSubscriptions);
        showErrorToast({
          title: translate('subscription.duplicate_title'),
          message: translate('subscription.notice_duplicate'),
          visibilityTime: 8000,
        });
      }

      notifyHost(onPurchaseSuccessRef.current, info, 'Purchase success');
      return info;
    } catch (error) {
      const purchaseError = error as PurchasesError;
      const outcome = describePurchaseError(purchaseError.code, Platform.OS);

      switch (outcome.kind) {
        case 'cancelled':
        case 'inProgress':
          return null;

        case 'pending':
          // Not a failure: the listener grants access if it clears.
          showInfoToast({
            title: translate('subscription.pending_title'),
            message: outcome.message,
            visibilityTime: 8000,
          });
          return null;

        case 'retryable':
        case 'blocked':
          showErrorToast({
            title: translate('subscription.purchase_failed_title'),
            message: outcome.message,
            visibilityTime: 6000,
          });
          return null;

        case 'linkedElsewhere':
          alertSubscriptionLinked();
          return null;

        case 'alreadyOwned': {
          // This store account already owns it. Re-post the receipts (no
          // sign-in prompt) and look again.
          const recovered = await syncAndRefresh();
          const owned = recovered !== null && isEntitlementActive(recovered);
          // For a plan CHANGE, owning the entitlement is not enough: the store
          // may have refused the switch and left the OLD plan in place — most
          // often because the subscription belongs to a different store account.
          const changeApplied =
            recovered !== null &&
            (recovered.activeSubscriptions ?? []).join('|') !== activeBefore.join('|');

          if (recovered) setCustomerInfo(recovered);

          if (owned && (!productChange || changeApplied)) {
            notifyHost(onPurchaseSuccessRef.current, recovered, 'Purchase recovery');
            return recovered;
          }
          if (owned && productChange) {
            Alert.alert(
              translate('subscription.plan_change_blocked_title'),
              planChangeBlockedMessage(Platform.OS),
              [{ text: translate('common.ok'), style: 'cancel' }],
            );
            return null;
          }
          // Owned by the store account, yet not by this app account.
          alertSubscriptionLinked();
          return null;
        }

        case 'unknown':
          console.error('❌ Purchase error:', {
            code: purchaseError.code,
            message: purchaseError.message,
          });
          showErrorToast({
            title: translate('subscription.purchase_failed_title'),
            message: translate('errors.something_went_wrong'),
          });
          return null;
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const restore = async (): Promise<CustomerInfo | null> => {
    setIsLoading(true);
    try {
      if (userId) await ensureIdentifiedUser(userId);

      const info = await restorePurchases();
      setCustomerInfo(info);

      if (isEntitlementActive(info)) {
        showSuccessToast({ title: translate('subscription.restore_success') });
        notifyHost(onRestoreSuccessRef.current, info, 'Restore success');
      } else {
        Alert.alert(
          translate('subscription.restore_none_title'),
          translate('subscription.restore_none_body'),
        );
      }
      return info;
    } catch (error) {
      const restoreError = error as PurchasesError;
      const outcome = describePurchaseError(restoreError.code, Platform.OS);

      if (outcome.kind === 'linkedElsewhere') {
        alertSubscriptionLinked();
        return null;
      }
      console.error('❌ Restore purchases error:', {
        code: restoreError.code,
        message: restoreError.message,
      });
      showErrorToast({
        title: translate('subscription.restore_failed_title'),
        message:
          outcome.kind === 'retryable' || outcome.kind === 'blocked'
            ? outcome.message
            : translate('errors.something_went_wrong'),
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  /** Re-fetch the offering after a failed load, without leaving the paywall. */
  const reloadOfferings = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await loadOfferings();
    } finally {
      setIsLoading(false);
    }
  };

  // ── Gate helper ───────────────────────────────────────────────────────────
  const requirePremium = useCallback(
    async (action?: () => void, copy?: PremiumGateCopy) => {
      // The cached read, not a forced refresh: invalidating first would put a
      // network round-trip in front of a tap that should be instant, and fail a
      // paying subscriber who happens to be offline. The listener and the
      // resume refresh keep the cache current.
      const freshInfo = await getCustomerInfo();

      // Adopted only when the answer changed — the cache returns an equivalent
      // but NEW object nearly every time, and writing it would re-render every
      // consumer on every gate tap.
      if (freshInfo && isEntitlementActive(freshInfo) !== isPremium) {
        setCustomerInfo(freshInfo);
      }

      const currentlyPremium =
        DEV_ALWAYS_PREMIUM && __DEV__
          ? true
          : freshInfo
            ? isEntitlementActive(freshInfo)
            : isPremium;

      if (currentlyPremium) {
        action?.();
      } else {
        gateRef.current?.open(copy);
      }
    },
    [isPremium],
  );

  // ── UI helpers ────────────────────────────────────────────────────────────
  const getPackagePrice = (pkg: PurchasesPackage | null): string =>
    pkg?.product?.priceString || '—';

  /**
   * The product's real introductory offer, or '' so the caller renders nothing.
   *
   * Eligibility is checked as well as existence: `introPrice` describes the
   * offer on the PRODUCT, and a returning subscriber who already used it would
   * otherwise be shown an offer the store will refuse. Only a definite
   * INELIGIBLE hides it — Android answers UNKNOWN for almost everything, and
   * hiding a real offer from an eligible user is the more expensive mistake.
   */
  const getTrialText = (pkg: PurchasesPackage | null): string => {
    if (!pkg?.product?.introPrice) return '';
    const status = trialEligibility[pkg.product.identifier]?.status;
    if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE) return '';
    return formatIntroOffer(pkg.product.introPrice);
  };

  const value: SubscriptionContextValue = {
    userData,
    backendSubscription,
    onPurchaseSuccess,
    onRestoreSuccess,
    isPremium,
    requirePremium,
    offerings,
    availablePackages,
    isPurchasing,
    isLoading,
    customerInfo,
    trialEligibility,
    subscriptionState,
    subscriptionStore,
    isCrossPlatformSubscription,
    managementURL,
    purchase,
    restore,
    reloadOfferings,
    getPackagePrice,
    getTrialText,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
      {/* Exactly one gate for the whole app. Its feature list is the offering's
          metadata — the same the paywall reads — so the two can't disagree. */}
      <PremiumGate ref={gateRef} metadata={offerings?.metadata} onSubscribe={onOpenPaywall} />
    </SubscriptionContext.Provider>
  );
};

// ─── Hook: read from context ──────────────────────────────────────────────────

/** Read the subscription context. Must be used inside <SubscriptionProvider>. */
export const useSubscriptionContext = (): SubscriptionContextValue => {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscriptionContext must be used inside <SubscriptionProvider>.');
  }
  return ctx;
};

/** `isPremium`, `requirePremium`, purchases and state — the module's main hook. */
export const useSubscription = useSubscriptionContext;
