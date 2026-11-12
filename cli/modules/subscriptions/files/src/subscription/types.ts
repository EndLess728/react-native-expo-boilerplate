/**
 * subscription/types.ts
 *
 * All shared TypeScript types for the subscription module.
 * Import these from `@/subscription` — never reference this file directly
 * in app code (use the barrel index).
 *
 * ─── Plug-and-play contract ───────────────────────────────────────────────────
 * The only project-specific coupling is via SubscriptionContextConfig:
 * pass userId + optional callbacks to SubscriptionProvider and the module
 * is self-contained — no Redux, no project-specific APIs inside.
 */

import type {
  CustomerInfo,
  IntroEligibility,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

import type {
  BackendActiveSubscription,
  SubscriptionState,
  SubscriptionStore,
} from './subscriptionState';

// Re-export RC types so consumers only need one import
export type { CustomerInfo, IntroEligibility, PurchasesOffering, PurchasesPackage };
// Defined next to the derivation that reads them, so the two files don't
// import each other.
export type { BackendActiveSubscription, SubscriptionState, SubscriptionStore };

// ─── User shape expected by loginToPurchases ──────────────────────────────────
export interface RevenueCatUser {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * What the gate modal says for one particular locked feature.
 *
 * The modal is shared, but the sentence that opens it should not be: a user
 * stopped on a premium *voice* is answering a different question from one
 * stopped on a premium *length*, and a single "Unlock Premium Access!" for
 * every gate makes the app look like it locked something at random. The caller
 * knows which door was tried, so the caller supplies the words — which is also
 * what lets them be translated, since the module itself holds no strings.
 *
 * Every field is optional: omit it and the modal keeps its generic default.
 */
export interface PremiumGateCopy {
  title?: string;
  description?: string;
  buttonLabel?: string;
}

// ─── Return type of useSubscription hook ──────────────────────────────────────
export interface UseSubscriptionReturn {
  // ── Subscription gate ──────────────────────────────────────────────────────
  /** True when user has an active premium entitlement (RC-driven). */
  isPremium: boolean;
  /**
   * Call this instead of executing premium-gated actions.
   * If isPremium → runs `action`, otherwise → shows the paywall modal.
   * The modal is owned by SubscriptionProvider — consumers never render it directly.
   *
   * `copy` tailors that modal to the feature being gated; see `PremiumGateCopy`.
   */
  requirePremium: (action?: () => void, copy?: PremiumGateCopy) => Promise<void>;

  // ── Purchase screen ────────────────────────────────────────────────────────
  offerings: PurchasesOffering | null;
  /**
   * Every package in the current offering, in the order RevenueCat serves them.
   *
   * Deliberately a list rather than the `{ monthly, yearly }` pair this used to
   * be: that shape could not represent a weekly plan, a lifetime, or a second
   * price point added for an experiment, so anything the dashboard added beyond
   * those two was silently dropped and needed an app release to appear.
   */
  availablePackages: PurchasesPackage[];
  isPurchasing: boolean;
  isLoading: boolean;
  customerInfo: CustomerInfo | null;
  trialEligibility: { [productId: string]: IntroEligibility };

  /**
   * The states between paid and free, derived from live RevenueCat data:
   * grace period (card failed, access continues), cancelled-but-still-active,
   * in-trial, Play pause, family-shared, and the duplicate-subscription signal.
   *
   * `isPremium` remains the gate — this is for telling the user WHY, which is
   * what turns a silent lapse into a recoverable one.
   */
  subscriptionState: SubscriptionState;

  // ── Cross-platform / cross-account ─────────────────────────────────────────
  /**
   * Which store the active subscription was originally purchased in.
   * Null when the user has no active subscription.
   */
  subscriptionStore: SubscriptionStore;
  /**
   * True when the active subscription was purchased in a DIFFERENT store from
   * the current device's platform.  e.g. Play Store purchase on an iOS device.
   * When true, purchasing/changing plans on this device is disabled.
   */
  isCrossPlatformSubscription: boolean;
  /**
   * Deep-link URL to the platform's subscription management page.
   * Open with Linking.openURL() to let the user cancel/upgrade externally.
   */
  managementURL: string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  purchase: (pkg: PurchasesPackage) => Promise<CustomerInfo | null>;
  restore: () => Promise<CustomerInfo | null>;
  /** Retry a failed offerings fetch without leaving the paywall. */
  reloadOfferings: () => Promise<void>;

  // ── UI helpers ─────────────────────────────────────────────────────────────
  getPackagePrice: (pkg: PurchasesPackage | null) => string;
  getTrialText: (pkg: PurchasesPackage | null) => string;
}

// ─── Context config — the ONLY project-specific surface of this module ────────

/**
 * Props you pass to <SubscriptionProvider> to wire the module into your app.
 *
 * @param userData         Backend user data — forwarded to RevenueCat so purchases
 *                         are attributed to the correct user. Pass undefined for
 *                         unauthenticated sessions.
 * @param onPurchaseSuccess Called after a successful purchase with live RC info.
 *                          Use this to call your sync API, dispatch state, etc.
 * @param onRestoreSuccess  Called after a successful restore with live RC info.
 */
export interface SubscriptionContextConfig {
  userData?: RevenueCatUser | null;
  /**
   * The host's own subscription record, when it keeps one.
   *
   * Optional, and the module works without it — the two states it carries
   * (account hold, deferred plan change) simply never fire, which is where every
   * RevenueCat-only client stands. It never grants access; see
   * `deriveSubscriptionState`.
   */
  backendSubscription?: BackendActiveSubscription | null;
  /**
   * Called after a purchase or restore, for a host that needs to tell its own
   * backend. Prefer RevenueCat webhooks: they are the only channel that works
   * while the app is closed (renewals, cancellations, refunds), and a
   * client-side call racing them writes the same rows twice. Kept for hosts
   * without webhooks.
   */
  onPurchaseSuccess?: (info: CustomerInfo) => void | Promise<void>;
  onRestoreSuccess?: (info: CustomerInfo) => void | Promise<void>;
}

// ─── Full context value (config + hook return) ────────────────────────────────
export interface SubscriptionContextValue
  extends UseSubscriptionReturn, SubscriptionContextConfig {}
