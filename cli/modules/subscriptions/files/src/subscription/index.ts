/**
 * subscription/index.ts  ←  The public API of this module
 *
 * The ONLY import path app code should use:
 *   import { useSubscription, openPaywall } from '@/subscription';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Wiring (done for you by `create-expo-boilerplate add subscriptions`):
 *
 *  - src/providers/AppProviders.tsx — inside APIProvider, around the navigator:
 *      <SubscriptionRoot>{children}</SubscriptionRoot>
 *  - the paywall screen registered as `/subscription` (Expo Router route file,
 *    or a screen in the React Navigation root stack).
 *
 * Gating a feature:
 *   const { requirePremium } = useSubscription();
 *   onPress={() => requirePremium(startExport, { title: t('export.locked') })}
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Note on the barrel: barrel exports have a bundle-size cost in Metro. This one
 * is intentional because it is the module's external API boundary. Files INSIDE
 * src/subscription/ import from each other directly, never through here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Provider & hooks ──────────────────────────────────────────────────────────
export {
  SubscriptionProvider,
  useSubscription,
  useSubscriptionContext,
} from './SubscriptionProvider';
export { SubscriptionRoot } from './SubscriptionRoot';

// ── Host adapter (adapt per project) ──────────────────────────────────────────
export { useSubscriptionUser } from './useSubscriptionUser';

// ── Navigation ────────────────────────────────────────────────────────────────
export { closePaywall, openPaywall } from './navigation';
export { openSubscriptionManagement } from './management';

// ── Screens & components ──────────────────────────────────────────────────────
export { default as CrossPlatformNotice } from './components/CrossPlatformNotice';
export { default as SubscriptionStatusNotice } from './components/SubscriptionStatusNotice';
export { PaywallScreen } from './screens/PaywallScreen';

// ── Offering-driven paywall content (pure) ────────────────────────────────────
export type { OfferingMetadata, PaywallPlan } from './offeringContent';
export {
  buildPaywallPlans,
  effectivePackageType,
  FREE_PLAN_ID,
  readMetadataValue,
  resolveFeatures,
} from './offeringContent';

// ── Subscription state derivation (pure) ──────────────────────────────────────
export type { NoticeKind, NoticeTone, StatusNotice } from './statusNotice';
export { canPurchase, formatNoticeDate, resolveStatusNotice } from './statusNotice';
export type { PlanPeriod } from './subscriptionState';
export {
  activeProductIdentifiers,
  deriveSubscriptionState,
  findActivePackage,
  inferPlanPeriod,
  isCrossStore,
} from './subscriptionState';

// ── Service layer ─────────────────────────────────────────────────────────────
export {
  configurePurchases,
  loginToPurchases,
  logoutFromPurchases,
  purchasePackage,
  restorePurchases,
  syncUserAttributes,
} from './service';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  BackendActiveSubscription,
  CustomerInfo,
  IntroEligibility,
  PremiumGateCopy,
  PurchasesOffering,
  PurchasesPackage,
  RevenueCatUser,
  SubscriptionContextConfig,
  SubscriptionContextValue,
  SubscriptionState,
  SubscriptionStore,
  UseSubscriptionReturn,
} from './types';

// ── Config (for advanced consumers that need to read constants) ────────────────
export { ENTITLEMENT_ID } from './config';
