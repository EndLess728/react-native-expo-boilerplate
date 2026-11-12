/**
 * subscription/planChange.ts
 *
 * Pure plan-change logic — no SDK calls, no React, no state.
 *
 * Google Play applies a replacement mode to every subscription change, and it
 * does not accept all five modes in every situation. The rule that governs this
 * project: when the old and the new plan are two base plans of ONE subscription
 * product, Play accepts only CHARGE_FULL_PRICE and WITHOUT_PRORATION. Anything
 * else fails the purchase outright with
 *
 *   BillingWrapper purchases failed to update: DebugMessage: Requested
 *   replacement mode is not supported for this request. ErrorCode:
 *   DEVELOPER_ERROR
 *
 * which surfaces through the SDK as PurchaseInvalidError. That is exactly this
 * project's Android catalogue: one `premium` product with `monthly` (P1M) and
 * `yearly` (P1Y) base plans, so *every* Android plan change goes down that
 * restricted path.
 *
 * Two further Play rules are encoded below for the separate-product case:
 *  • CHARGE_PRORATED_PRICE is valid only when the price per unit of TIME goes
 *    up. Annual plans are near-universally cheaper per month than monthly ones,
 *    so it must never be used for a move to a longer billing period.
 *  • DEFERRED is downgrade-only; Play rejects a deferred upgrade.
 *
 * Left unset, Play falls back to the mode configured on the base plan — both of
 * this project's are SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE
 * (verified against the Play Console via the RevenueCat API, 18 Aug 2026),
 * i.e. WITHOUT_PRORATION in both directions. That is right for a downgrade and
 * wrong for an upgrade: someone moving monthly → yearly would get the yearly
 * plan at once and not be charged for it until their monthly period ran out.
 * So the mode is still set explicitly on every change; this module decides it.
 *
 * iOS resolves plan changes itself through the products' shared subscription
 * group, so everything here is Android-only by construction and
 * SubscriptionProvider only calls it on Android.
 *
 * References: Play "About subscriptions" → replacement modes; RevenueCat
 * Android handbook, "Subscription upgrades and downgrades".
 */

import type { PurchasesPackage, StoreProductChangeInfo } from 'react-native-purchases';
import { PACKAGE_TYPE, STORE_REPLACEMENT_MODE } from 'react-native-purchases';

import { translate } from '@/localization/utils';

/**
 * Billing periods ordered shortest to longest. Moving up the list is an
 * upgrade and moving down is a downgrade; that ordering is what selects the
 * replacement mode. LIFETIME and CUSTOM are deliberately absent — they are not
 * renewing subscriptions, so replacing one is not a plan change.
 */
const PERIOD_RANK: Record<string, number> = {
  [PACKAGE_TYPE.WEEKLY]: 1,
  [PACKAGE_TYPE.MONTHLY]: 2,
  [PACKAGE_TYPE.TWO_MONTH]: 3,
  [PACKAGE_TYPE.THREE_MONTH]: 4,
  [PACKAGE_TYPE.SIX_MONTH]: 5,
  [PACKAGE_TYPE.ANNUAL]: 6,
};

/**
 * Play identifies an active subscription as `productId:basePlanId`, but expects
 * the bare product id when naming the subscription being replaced. The SDK
 * strips the suffix itself; slicing it here keeps the intent visible.
 */
export const baseProductId = (identifier: string | null | undefined): string | null => {
  if (!identifier) return null;
  const [productId] = identifier.split(':');
  return productId || null;
};

export interface ReplacementModeInput {
  /** Package type of the plan the user is on today, if it could be identified. */
  currentPackageType: string | undefined;
  /** Package type of the plan being bought. */
  nextPackageType: string;
  /** True while the current subscription is inside a free trial. */
  isInTrial: boolean;
  /**
   * True when both plans are base plans of the SAME Play subscription product.
   * Play restricts such a switch to CHARGE_FULL_PRICE or WITHOUT_PRORATION, so
   * this flag decides which half of the logic applies.
   */
  sameSubscriptionProduct: boolean;
}

/**
 * Pick the replacement mode Play will accept for this move.
 *
 * Base plans of one product (this project's whole Android catalogue):
 *  • Upgrade   → CHARGE_FULL_PRICE. Takes effect now, charges the new plan in
 *    full, and carries the unused time of the old plan over on top. This is
 *    Play's own documented example for "upgrade from shorter to longer billing
 *    period".
 *  • Downgrade → WITHOUT_PRORATION. The switch is recorded now, the user keeps
 *    the period they have already paid for, and the cheaper price starts at the
 *    next billing date. Nothing is refunded and nothing is charged twice.
 *
 * Separate subscription products:
 *  • Downgrade → DEFERRED, so the change waits for the paid period to run out.
 *  • Upgrade during a free trial → charge now rather than granting the better
 *    plan free until the trial's original end date. Same billing period means
 *    the price per unit of time went up, which is the one case Play allows
 *    CHARGE_PRORATED_PRICE; a longer period must use CHARGE_FULL_PRICE.
 *  • Otherwise → WITH_TIME_PRORATION, crediting the unused time back.
 *
 * When the current plan cannot be identified it is treated as an upgrade: both
 * of those branches charge the user, which is the safe way to be wrong.
 */
export function resolveReplacementMode({
  currentPackageType,
  nextPackageType,
  isInTrial,
  sameSubscriptionProduct,
}: ReplacementModeInput): STORE_REPLACEMENT_MODE {
  const current = currentPackageType ? PERIOD_RANK[currentPackageType] : undefined;
  const next = PERIOD_RANK[nextPackageType];
  const ranked = current !== undefined && next !== undefined;

  const isDowngrade = ranked && next < current;

  if (sameSubscriptionProduct) {
    return isDowngrade
      ? STORE_REPLACEMENT_MODE.WITHOUT_PRORATION
      : STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE;
  }

  if (isDowngrade) return STORE_REPLACEMENT_MODE.DEFERRED;

  if (isInTrial) {
    return ranked && next === current
      ? STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE
      : STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE;
  }

  return STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION;
}

export interface PlanChangeInput {
  /**
   * `customerInfo.activeSubscriptions` — entries carry the `productId:basePlanId`
   * shape, which is what distinguishes one base plan from another when both
   * belong to the same subscription product.
   */
  activeSubscriptions: readonly string[] | undefined;
  /** The package the user is buying. */
  nextPackage: PurchasesPackage;
  /** Packages on offer — used to work out which plan the user is on today. */
  availablePackages: readonly PurchasesPackage[];
  /** True while the current subscription is inside a free trial. */
  isInTrial?: boolean;
}

/**
 * Build the payload naming the subscription this purchase replaces, or null
 * when the purchase is not a replacement at all.
 *
 * Null is the safe outcome: it produces a plain new purchase, which is correct
 * when there is nothing to replace.
 */
export function resolvePlanChange({
  activeSubscriptions,
  nextPackage,
  availablePackages,
  isInTrial = false,
}: PlanChangeInput): StoreProductChangeInfo | null {
  // Play allows one active purchase per subscription product, so the first
  // active entry is the subscription any plan change replaces.
  const currentSubscription = activeSubscriptions?.[0];
  const oldProductIdentifier = baseProductId(currentSubscription);
  if (!currentSubscription || !oldProductIdentifier) return null;

  // Re-buying the exact base plan already active is not a change. Compared at
  // full `productId:basePlanId` precision — comparing bare product ids would
  // swallow every change between base plans of one subscription product,
  // which is how monthly and yearly are configured here.
  if (currentSubscription === nextPackage.product.identifier) return null;

  const currentPackage = availablePackages.find(
    (candidate) => candidate.product.identifier === currentSubscription,
  );

  return {
    oldProductIdentifier,
    replacementMode: resolveReplacementMode({
      currentPackageType: currentPackage?.packageType,
      nextPackageType: nextPackage.packageType,
      isInTrial,
      // Same bare product id on both sides means Play is switching base plans
      // inside one subscription, which is the restricted case.
      sameSubscriptionProduct:
        baseProductId(nextPackage.product.identifier) === oldProductIdentifier,
    }),
  };
}

/**
 * What to tell the user when the change they just bought does not look like it
 * happened yet, or null when it took full effect immediately.
 *
 * Both delayed modes leave the paywall looking unchanged in some way, and
 * without a word about it users try to buy again:
 *  • DEFERRED holds the whole switch until renewal, so `activeSubscriptions`
 *    keeps reporting the OLD product until Play sends the renewal notification.
 *  • WITHOUT_PRORATION switches the plan straight away but keeps the current
 *    billing date, so the new price is not charged until then.
 */
export const planChangeNotice = (change: StoreProductChangeInfo | null): string | null => {
  switch (change?.replacementMode) {
    case STORE_REPLACEMENT_MODE.DEFERRED:
      return translate('subscription.plan_change_deferred');
    case STORE_REPLACEMENT_MODE.WITHOUT_PRORATION:
      return translate('subscription.plan_change_next_billing');
    default:
      return null;
  }
};
