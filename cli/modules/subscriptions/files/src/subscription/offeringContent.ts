/**
 * subscription/offeringContent.ts
 *
 * Turns whatever the current RevenueCat offering contains into the rows the
 * paywall renders — pure, no SDK calls, no React.
 *
 * The rule this file exists to enforce: the app must not decide WHAT is on sale.
 * RevenueCat and the stores do. The paywall used to hardcode two cards, a
 * monthly one and an annual one, read the two matching package types out of the
 * offering and ignore everything else. Adding a weekly plan, a lifetime, a
 * second price point for an experiment, or simply renaming a plan therefore
 * meant shipping a build — and a build takes days to reach users through review,
 * which is exactly the window in which pricing experiments are supposed to move.
 *
 * What comes from where now:
 *
 *   price          product.priceString — already localised by the store, in the
 *                  user's own currency. Never formatted or hardcoded here, which
 *                  is what makes per-country pricing work with no app change.
 *   which plans    offering.availablePackages, in the order RevenueCat serves
 *                  them (the position configured on the offering).
 *   intro offer    product.introPrice, via introOffer.ts. Absent → no badge.
 *   plan name      offering.metadata if it names one, else a label derived from
 *                  the package's own billing period.
 *   feature list   offering.metadata if present, else the app's default copy.
 *
 * The one thing the app keeps is TRANSLATION. Metadata is a single value per
 * key, so copy set there is copy in one language; this module therefore accepts
 * either a plain value or a `{ en, es, ar }` map, and falls back to translated
 * app strings when metadata says nothing. That is the only way to be both
 * server-driven and localised — see README for the metadata shape.
 */

import { PACKAGE_TYPE, type PurchasesPackage } from 'react-native-purchases';

import type { TxKeyPath } from '@/localization/utils';

/** The "stay on free" card. Not a product — there is nothing to buy. */
export const FREE_PLAN_ID = 'free';

/**
 * Package type → the label for the plan and the suffix beside its price.
 *
 * Every renewing type RevenueCat defines is covered, not just the two this
 * catalogue sells today, so a new package appears correctly labelled the moment
 * it is added to the offering.
 */
const PERIOD_COPY: Partial<Record<PACKAGE_TYPE, { title: TxKeyPath; suffix: TxKeyPath }>> = {
  [PACKAGE_TYPE.WEEKLY]: {
    title: 'subscription.plan_period_weekly',
    suffix: 'subscription.price_per_weekly',
  },
  [PACKAGE_TYPE.MONTHLY]: {
    title: 'subscription.plan_period_monthly',
    suffix: 'subscription.price_per_monthly',
  },
  [PACKAGE_TYPE.TWO_MONTH]: {
    title: 'subscription.plan_period_two_month',
    suffix: 'subscription.price_per_two_month',
  },
  [PACKAGE_TYPE.THREE_MONTH]: {
    title: 'subscription.plan_period_three_month',
    suffix: 'subscription.price_per_three_month',
  },
  [PACKAGE_TYPE.SIX_MONTH]: {
    title: 'subscription.plan_period_six_month',
    suffix: 'subscription.price_per_six_month',
  },
  [PACKAGE_TYPE.ANNUAL]: {
    title: 'subscription.plan_period_annual',
    suffix: 'subscription.price_per_annual',
  },
  // Bought once — a price suffix would claim a renewal that never happens.
  [PACKAGE_TYPE.LIFETIME]: { title: 'subscription.plan_period_lifetime', suffix: '' as TxKeyPath },
};

/**
 * ISO 8601 billing period → the package type it corresponds to, for the
 * CUSTOM and UNKNOWN packages RevenueCat does not classify. A custom package
 * wrapping a P1M product is still a monthly plan to the person reading it.
 */
const PERIOD_BY_ISO: Record<string, PACKAGE_TYPE> = {
  P1W: PACKAGE_TYPE.WEEKLY,
  P7D: PACKAGE_TYPE.WEEKLY,
  P1M: PACKAGE_TYPE.MONTHLY,
  P2M: PACKAGE_TYPE.TWO_MONTH,
  P3M: PACKAGE_TYPE.THREE_MONTH,
  P6M: PACKAGE_TYPE.SIX_MONTH,
  P1Y: PACKAGE_TYPE.ANNUAL,
  P12M: PACKAGE_TYPE.ANNUAL,
};

/** The package type to describe this package as, resolving CUSTOM by its period. */
export function effectivePackageType(pkg: PurchasesPackage): PACKAGE_TYPE | null {
  if (PERIOD_COPY[pkg.packageType]) return pkg.packageType;
  const iso = pkg.product?.subscriptionPeriod?.toUpperCase();
  return (iso && PERIOD_BY_ISO[iso]) || null;
}

/**
 * Read one value out of offering metadata, honouring a locale map.
 *
 * Accepts `"Premium"`, or `{ en: "Premium", es: "Premium" }`. An unknown locale
 * falls back to `en`, then to the first entry — a paywall that shows the wrong
 * language beats one that shows a blank card.
 */
export function readMetadataValue<T>(
  value: unknown,
  locale: string | undefined,
  isValid: (candidate: unknown) => candidate is T,
): T | null {
  if (isValid(value)) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const byLocale = value as Record<string, unknown>;
  const candidates = [
    locale && byLocale[locale],
    locale && byLocale[locale.split('-')[0]],
    byLocale.en,
    ...Object.values(byLocale),
  ];
  for (const candidate of candidates) {
    if (isValid(candidate)) return candidate;
  }
  return null;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

/** Offering metadata, as this app reads it. Every key optional by design. */
export interface OfferingMetadata {
  /** Bullet list on the paywall. String array, or a locale map of them. */
  features?: unknown;
  /** Identifier of the package to badge as most popular, e.g. `$rc_annual`. */
  popular_package?: unknown;
  /** Per-package display names, keyed by package identifier. */
  titles?: unknown;
}

export interface PaywallPlan {
  /** Package identifier, or FREE_PLAN_ID. Stable across renders and locales. */
  id: string;
  /** null for the free card, which has nothing to purchase. */
  pkg: PurchasesPackage | null;
  title: string;
  price: string;
  /** "/month". Empty for one-off products and for free. */
  pricePeriod: string;
  /** The real introductory offer, when the product carries one. */
  badge?: string;
  subtitle?: string;
  popular: boolean;
}

export interface BuildPaywallPlansInput {
  packages: readonly PurchasesPackage[];
  /** `offering.metadata` — `{}` when the dashboard sets none. */
  metadata: Record<string, unknown> | null | undefined;
  locale?: string;
  t: (key: TxKeyPath, options?: Record<string, unknown>) => string;
  /** Store-localised price string for a package. */
  getPackagePrice: (pkg: PurchasesPackage) => string;
  /** Real intro-offer text, or '' when the product has no offer. */
  getTrialText: (pkg: PurchasesPackage) => string;
  /** Whether the user currently has an active subscription. */
  isPremium?: boolean;
}

/**
 * The plan cards to render, in the offering's own order, with the free card
 * first.
 *
 * Free is kept in the app rather than modelled as a package because it is not
 * something the stores sell — it is the way out of the paywall. Its price is
 * the translated word, never a formatted "$0", which would be the wrong
 * currency everywhere outside the US.
 */
export function buildPaywallPlans({
  packages,
  metadata,
  locale,
  t,
  getPackagePrice,
  getTrialText,
  isPremium,
}: BuildPaywallPlansInput): PaywallPlan[] {
  const meta = (metadata ?? {}) as OfferingMetadata;

  const titles = (meta.titles ?? null) as Record<string, unknown> | null;
  const popularFromMeta = readMetadataValue(meta.popular_package, locale, isNonEmptyString);

  // No metadata: badge the monthly package, which is what the hand-written
  // paywall did. A dashboard value overrides it without a build, and naming a
  // package that is not in the offering simply badges nothing.
  const popularId =
    popularFromMeta ??
    packages.find((pkg) => pkg.packageType === PACKAGE_TYPE.MONTHLY)?.identifier ??
    null;

  const free: PaywallPlan = {
    id: FREE_PLAN_ID,
    pkg: null,
    title: t('subscription.plan_free_title'),
    price: t('subscription.plan_free_price'),
    pricePeriod: '',
    badge: t('subscription.plan_free_badge'),
    subtitle: t('subscription.plan_free_subtitle'),
    popular: false,
  };

  const paid = packages.map<PaywallPlan>((pkg) => {
    const type = effectivePackageType(pkg);
    const copy = type ? PERIOD_COPY[type] : undefined;

    // Dashboard name → period-derived name → the store's own product title,
    // which is always populated and never leaves a card unlabelled.
    const fromMeta = titles
      ? readMetadataValue(titles[pkg.identifier], locale, isNonEmptyString)
      : null;
    const title =
      fromMeta ??
      (copy ? t('subscription.plan_title', { period: t(copy.title) }) : pkg.product.title);

    return {
      id: pkg.identifier,
      pkg,
      title,
      price: getPackagePrice(pkg),
      // Stating the period beside the price is an App Store review requirement,
      // so it is derived rather than omitted when the type is unrecognised.
      pricePeriod: copy?.suffix ? t(copy.suffix) : '',
      badge: getTrialText(pkg) || undefined,
      popular: pkg.identifier === popularId,
    };
  });

  return isPremium ? paid : [free, ...paid];
}

/**
 * The paywall's feature bullets: the dashboard's list when it sets one, the
 * app's translated defaults otherwise.
 */
export function resolveFeatures({
  metadata,
  locale,
  fallback,
}: {
  metadata: Record<string, unknown> | null | undefined;
  locale?: string;
  fallback: string[];
}): string[] {
  const meta = (metadata ?? {}) as OfferingMetadata;
  return readMetadataValue(meta.features, locale, isStringArray) ?? fallback;
}
