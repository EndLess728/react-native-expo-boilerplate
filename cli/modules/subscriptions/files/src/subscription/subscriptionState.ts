/**
 * subscription/subscriptionState.ts
 *
 * Pure derivation of subscription status from CustomerInfo — no SDK calls, no
 * React, no state.
 *
 * A subscription is not a boolean. Between "paying" and "free" sit a free trial,
 * a grace period, a Play pause, and cancelled-but-still-inside-the-paid-period,
 * and each one wants different UI: someone whose card just failed should be asked
 * to fix it, not shown a paywall. Collapsing all of it to `isActive` is what
 * makes those users churn silently.
 *
 * ─── Where the fields actually live ──────────────────────────────────────────
 * RevenueCat exposes two overlapping records and the spellings differ:
 *
 *   customerInfo.entitlements.active[id]        → PurchasesEntitlementInfo
 *     billingIssueDetectedAt   (SINGULAR "Issue")
 *
 *   customerInfo.subscriptionsByProductIdentifier[productId]
 *                                              → PurchasesSubscriptionInfo
 *     billingIssuesDetectedAt  (PLURAL "Issues")
 *     gracePeriodExpiresDate, autoResumeDate, refundedAt  ← no entitlement equivalent
 *
 * Reading only the entitlement leaves grace-period detection permanently false,
 * because the field name there is the singular one. Both are read below, and the
 * subscription record wins when present since it carries the deadlines.
 *
 * ─── The half that cannot come from the device ───────────────────────────────
 * Two states are structurally invisible to RevenueCat, and both are recoverable:
 *
 *   account hold  — after grace expires, Play holds the account for up to 30
 *                   days. On-device this is indistinguishable from a plain
 *                   lapse, and guessing would send a recoverable subscriber to a
 *                   full paywall, where the likely outcome is a SECOND
 *                   subscription bought while the first is still billing.
 *   deferred change — after a downgrade the entitlement keeps reporting the old
 *                   plan until the period rolls over, and RC exposes no
 *                   "change scheduled" signal at all.
 *
 * Both are read off the backend's own record (`BackendActiveSubscription`, fed
 * by RevenueCat's webhooks) rather than inferred. It never grants access: the
 * entitlement is still the gate, and the record only explains a state the device
 * can already see is not premium.
 */

import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesPackage,
  PurchasesSubscriptionInfo,
} from 'react-native-purchases';

import { ENTITLEMENT_ID } from './config';

// ─── The backend's own record ─────────────────────────────────────────────────
/**
 * The server's own record of the subscription, if your backend keeps one (fed
 * by RevenueCat webhooks). Optional — see `SubscriptionContextConfig`.
 *
 * This is the half RevenueCat cannot tell the device: `on_hold` (Play holds a
 * lapsed account for 30 days and the card can still be fixed) is indisinguishable
 * from a genuine expiry on-device, and a deferred plan change has no client-side
 * signal at all. Both are recoverable states that the client would otherwise
 * answer with a full paywall.
 *
 * It is not a substitute for the entitlement. RevenueCat still decides what to
 * unlock on the device; this record decides what the server serves, and lets the
 * UI explain a state rather than guess at it.
 *
 * Only as truthful as the webhook feeding it.
 */
export interface BackendActiveSubscription {
  _id?: string;
  user_id?: string;
  product_id?: string | null;
  product_identifier: string | null;
  plan_type: 'MONTHLY' | 'YEARLY' | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /**
   * The plan that takes over at the end of the current period.
   *
   * A downgrade on either store is deferred: the entitlement keeps reporting the
   * plan the user just left until the period rolls over, and RevenueCat exposes
   * no "change scheduled" signal — so without this field the paywall highlights
   * the old plan and the switch reads as having failed.
   */
  pending_plan_type?: 'MONTHLY' | 'YEARLY' | null;
  platform: string | null;
  is_trial_plan: boolean;
  status: 'active' | 'in_grace' | 'on_hold' | 'expired' | null;
  subscription_id: string | null;
  price?: { amount: string; currency: string } | null;
}

// ─── Subscription store ───────────────────────────────────────────────────────
/** Which store the active subscription was purchased through. */
export type SubscriptionStore =
  | 'APP_STORE'
  | 'PLAY_STORE'
  | 'AMAZON'
  | 'STRIPE'
  | 'PROMOTIONAL'
  | 'OTHER'
  | null;

// ─── Entitlement lookup ───────────────────────────────────────────────────────

/** Entitlement ids already warned about, so the dev warning fires once each. */
const warnedAbout = new Set<string>();

/**
 * The entitlement this app gates on — `ENTITLEMENT_ID`, and only that one.
 *
 * Deliberately no fallback to "whatever else is active": with a second tier (or
 * a typo in config.ts) that fallback silently makes every entitlement premium.
 * A mismatch instead shows up at once in development, as nobody being premium,
 * with a warning naming the entitlements that were active.
 */
export function getActiveEntitlement(info: CustomerInfo): PurchasesEntitlementInfo | null {
  const active = info.entitlements?.active ?? {};
  const match = active[ENTITLEMENT_ID] ?? null;

  if (__DEV__ && !match) {
    const others = Object.keys(active).filter((id) => !warnedAbout.has(id));
    if (others.length > 0) {
      others.forEach((id) => warnedAbout.add(id));
      console.warn(
        `[subscription] Active entitlement(s) ${others.join(', ')} found, but ENTITLEMENT_ID ` +
          `is "${ENTITLEMENT_ID}". Check src/subscription/config.ts.`,
      );
    }
  }
  return match;
}

export function isEntitlementActive(info: CustomerInfo): boolean {
  return !!getActiveEntitlement(info)?.isActive;
}

export function getSubscriptionStore(info: CustomerInfo | null): SubscriptionStore {
  if (!info) return null;
  const store = getActiveEntitlement(info)?.store as string | undefined;
  if (!store) return null;
  const known: SubscriptionStore[] = ['APP_STORE', 'PLAY_STORE', 'AMAZON', 'STRIPE', 'PROMOTIONAL'];
  return (known.includes(store as SubscriptionStore) ? store : 'OTHER') as SubscriptionStore;
}

/**
 * Whether the active subscription belongs to a store this device can't manage
 * or replace — the other mobile store, but also web billing (Stripe, RevenueCat
 * Web Billing → OTHER) and Amazon. Buying here would start a SECOND
 * subscription, billed by both. Promotional grants are not "cross-store": they
 * belong to no store, and are handled by `canPurchase`.
 */
export function isCrossStore(store: SubscriptionStore, os: string): boolean {
  if (store === null || store === 'PROMOTIONAL') return false;
  const own = os === 'android' ? 'PLAY_STORE' : os === 'ios' ? 'APP_STORE' : null;
  return store !== own;
}

// ─── Subscription record lookup ───────────────────────────────────────────────

/** Most recently expiring subscription — the one that just lapsed, if any did. */
function latestSubscription(
  subscriptions: PurchasesSubscriptionInfo[],
): PurchasesSubscriptionInfo | null {
  const at = (s: PurchasesSubscriptionInfo | null) =>
    s?.expiresDate ? Date.parse(s.expiresDate) : Number.NEGATIVE_INFINITY;
  return subscriptions.reduce<PurchasesSubscriptionInfo | null>(
    (latest, s) => (at(s) > at(latest) ? s : latest),
    null,
  );
}

/**
 * The subscription record behind the current state.
 *
 * Keyed by the active entitlement's product when there is one. When there is
 * not, it falls back to the most recently expiring record — a paused or refunded
 * subscription has NO active entitlement, so those states are only reachable
 * through the fallback.
 */
export function findRelevantSubscription(
  info: CustomerInfo,
  entitlement: PurchasesEntitlementInfo | null,
): PurchasesSubscriptionInfo | null {
  const byId = info.subscriptionsByProductIdentifier ?? {};
  const all = Object.values(byId);
  if (all.length === 0) return null;

  if (entitlement) {
    // Play keys a base-plan subscription as `productId:basePlanId`; the App
    // Store keys it by the bare product id. Try the more specific form first.
    const base = entitlement.productIdentifier;
    const plan = entitlement.productPlanIdentifier;
    for (const key of plan ? [`${base}:${plan}`, base] : [base]) {
      if (byId[key]) return byId[key];
    }
  }

  return latestSubscription(all);
}

// ─── Which plan is the user actually on ───────────────────────────────────────

/**
 * Every store identifier that could name the active subscription, most specific
 * first.
 *
 * This exists because the entitlement and the offering disagree about how to
 * name an Android base plan. A package's `product.identifier` is the combined
 * `productId:basePlanId` (`premium:monthly`), but the entitlement splits it:
 * `productIdentifier` is just `premium` and the base plan lives in
 * `productPlanIdentifier`. Comparing `productIdentifier` against a package
 * identifier therefore NEVER matches on Android — both plans report `premium`,
 * so neither monthly nor yearly can be recognised. Recombining them first is
 * what makes the comparison work.
 *
 * `activeSubscriptions` is appended as a backstop: it already carries the
 * combined form, and covers stores that populate it differently.
 */
export function activeProductIdentifiers(info: CustomerInfo): string[] {
  const entitlement = getActiveEntitlement(info);
  const ids: string[] = [];

  if (entitlement?.productIdentifier) {
    if (entitlement.productPlanIdentifier) {
      ids.push(`${entitlement.productIdentifier}:${entitlement.productPlanIdentifier}`);
    }
    ids.push(entitlement.productIdentifier);
  }

  for (const id of info.activeSubscriptions ?? []) {
    if (id && !ids.includes(id)) ids.push(id);
  }

  return ids;
}

/** The package the user is currently subscribed to, when it is still on offer. */
export function findActivePackage(
  info: CustomerInfo | null,
  packages: readonly (PurchasesPackage | null | undefined)[],
): PurchasesPackage | null {
  if (!info || !isEntitlementActive(info)) return null;

  for (const id of activeProductIdentifiers(info)) {
    const match = packages.find((pkg) => pkg?.product?.identifier === id);
    if (match) return match;
  }
  return null;
}

export type PlanPeriod = 'monthly' | 'annual';

/**
 * Every identifier that could name a subscription record, most specific first.
 *
 * The key it is filed under comes first on purpose: on Play that key is the
 * combined `premium:monthly`, while the record's own `productIdentifier` is the
 * bare `premium`, which names no period at all. Recombining the record's two
 * fields covers stores that key the map differently.
 */
function subscriptionIdentifiers(
  info: CustomerInfo,
  subscription: PurchasesSubscriptionInfo | null,
): string[] {
  if (!subscription) return [];

  const ids: string[] = [];
  for (const [key, value] of Object.entries(info.subscriptionsByProductIdentifier ?? {})) {
    if (value === subscription) ids.push(key);
  }

  const { productIdentifier: base, productPlanIdentifier: plan } = subscription;
  if (base && plan) ids.push(`${base}:${plan}`);
  if (base) ids.push(base);

  return ids;
}

/**
 * Last-resort period guess from the identifiers themselves, for a subscription
 * bought on a product that is no longer in the current offering — otherwise a
 * legacy subscriber sees no active plan at all.
 *
 * Annual is tested first: a product named `12month_plan` is yearly, and checking
 * for "month" first would misread it.
 */
export function inferPlanPeriod(identifiers: readonly string[]): PlanPeriod | null {
  for (const raw of identifiers) {
    const id = raw.toLowerCase();
    if (id.includes('year') || id.includes('annual')) return 'annual';
    if (id.includes('month')) return 'monthly';
  }
  return null;
}

// ─── Derived state ────────────────────────────────────────────────────────────

export interface SubscriptionState {
  /** The premium gate. True only while the entitlement itself is active. */
  isActive: boolean;
  /** Will bill again at the end of the current period. */
  willRenew: boolean;
  /** 'NORMAL' | 'TRIAL' | 'INTRO' | 'PREPAID', when known. */
  periodType: string | null;
  store: SubscriptionStore;
  /** End of the current period — the trial's end date while in a trial. */
  expiresAt: string | null;
  /**
   * How long a billing period runs — monthly or annual. Read off the store
   * identifiers rather than the offering, so it survives a subscriber whose
   * product is no longer on sale. Null when no identifier names a period.
   */
  planPeriod: PlanPeriod | null;

  /**
   * A non-expiring purchase (a lifetime package, or a promotional grant with no
   * end date). Never "cancelled": it has no renewal to turn off.
   */
  isLifetime: boolean;

  /** Active with auto-renew off. Recoverable: both stores allow resubscribing. */
  isCancelled: boolean;
  unsubscribedAt: string | null;

  /**
   * The card failed and the store is retrying while access CONTINUES — up to
   * the grace period configured on the store (Play lets you choose per base plan).
   * The best moment to save the subscription, and the user is owed a warning.
   */
  inGracePeriod: boolean;
  billingIssueDetectedAt: string | null;
  /** Deadline to fix payment. Only the subscription record reports it. */
  gracePeriodExpiresAt: string | null;

  isInTrial: boolean;
  trialEndsAt: string | null;

  /** Google Play pause. `autoResumeDate` is set only for a paused Play sub. */
  isPaused: boolean;
  resumesAt: string | null;

  /** Entitled through someone else's purchase — cannot cancel or change it. */
  isFamilyShared: boolean;
  refundedAt: string | null;
  isSandbox: boolean;

  /**
   * Lapsed but recoverable — Play's account hold, or Apple's billing retry after
   * expiry. Access is off and the entitlement is gone, but the subscription is
   * not: fixing the payment method restores it with no new purchase.
   *
   * Only ever true when the entitlement is inactive. While access continues the
   * same billing failure is a grace period, which is the more useful thing to
   * say and outranks this.
   */
  isOnHold: boolean;
  /**
   * The plan taking over at the end of the current period, after a deferred
   * downgrade. Null when no change is scheduled — which includes every case
   * where the backend has not told us, so this must never be read as "no change
   * was made".
   */
  pendingPlanType: 'MONTHLY' | 'YEARLY' | null;
  /** The server's own status, or null when it has no record. Diagnostic. */
  backendStatus: BackendActiveSubscription['status'];

  /**
   * More than one live store subscription: the double-billing signature from a
   * plan change made on a device signed into a different store account. Nothing
   * on either platform can merge or cancel them from here, so this exists to be
   * surfaced to support, not repaired.
   */
  hasMultipleActiveSubscriptions: boolean;
  activeSubscriptionCount: number;
}

const EMPTY: SubscriptionState = {
  isActive: false,
  willRenew: false,
  periodType: null,
  store: null,
  expiresAt: null,
  planPeriod: null,
  isLifetime: false,
  isCancelled: false,
  unsubscribedAt: null,
  inGracePeriod: false,
  billingIssueDetectedAt: null,
  gracePeriodExpiresAt: null,
  isInTrial: false,
  trialEndsAt: null,
  isPaused: false,
  resumesAt: null,
  isFamilyShared: false,
  refundedAt: null,
  isSandbox: false,
  isOnHold: false,
  pendingPlanType: null,
  backendStatus: null,
  hasMultipleActiveSubscriptions: false,
  activeSubscriptionCount: 0,
};

/**
 * @param backend The server's record, when the host has one. Optional so the
 *   module still works standalone — without it the two backend-only states
 *   simply never fire, which is where this stood before the endpoint existed.
 */
export function deriveSubscriptionState(
  info: CustomerInfo | null,
  backend?: BackendActiveSubscription | null,
): SubscriptionState {
  if (!info) return { ...EMPTY, backendStatus: backend?.status ?? null };

  const entitlement = getActiveEntitlement(info);
  const subscription = findRelevantSubscription(info, entitlement);

  const isActive = !!entitlement?.isActive;
  const willRenew = entitlement?.willRenew ?? subscription?.willRenew ?? false;
  const expiresAt = entitlement?.expirationDate ?? subscription?.expiresDate ?? null;
  const periodType = subscription?.periodType ?? entitlement?.periodType ?? null;
  const isInTrial = periodType === 'TRIAL';

  // Singular on the entitlement, plural on the subscription record. Both, or
  // this stays false forever.
  const billingIssueDetectedAt =
    subscription?.billingIssuesDetectedAt ?? entitlement?.billingIssueDetectedAt ?? null;

  const activeSubscriptionCount = info.activeSubscriptions?.length ?? 0;

  return {
    isActive,
    willRenew,
    periodType,
    store: getSubscriptionStore(info),
    expiresAt,

    // The subscription record is appended last as the fallback for states with
    // no active entitlement — a paused or lapsed subscription reports nothing in
    // `activeSubscriptions`, and without it their plan would show as unknown.
    planPeriod: inferPlanPeriod([
      ...activeProductIdentifiers(info),
      ...subscriptionIdentifiers(info, subscription),
    ]),

    isLifetime: isActive && expiresAt === null,
    // A lifetime purchase never renews, so `!willRenew` alone would call every
    // lifetime customer "cancelled" and offer them a resubscribe.
    isCancelled: isActive && !willRenew && expiresAt !== null,
    unsubscribedAt:
      subscription?.unsubscribeDetectedAt ?? entitlement?.unsubscribeDetectedAt ?? null,

    // Gated on isActive: a billing issue with access still granted is a grace
    // period. Once access is gone it is a lapse or an account hold, which this
    // module refuses to guess between.
    inGracePeriod: isActive && !!billingIssueDetectedAt,
    billingIssueDetectedAt,
    gracePeriodExpiresAt: subscription?.gracePeriodExpiresDate ?? null,

    isInTrial,
    trialEndsAt: isInTrial ? expiresAt : null,

    isPaused: !!subscription?.autoResumeDate,
    resumesAt: subscription?.autoResumeDate ?? null,

    isFamilyShared: (subscription?.ownershipType ?? entitlement?.ownershipType) === 'FAMILY_SHARED',
    refundedAt: subscription?.refundedAt ?? null,
    isSandbox: subscription?.isSandbox ?? false,

    // Gated on the entitlement being gone: while access continues the same
    // billing failure is a grace period, and a server that has not caught up yet
    // must not be able to lock out a user the store still says is paid.
    isOnHold: !isActive && backend?.status === 'on_hold',
    pendingPlanType: backend?.pending_plan_type ?? null,
    backendStatus: backend?.status ?? null,

    hasMultipleActiveSubscriptions: activeSubscriptionCount > 1,
    activeSubscriptionCount,
  };
}
