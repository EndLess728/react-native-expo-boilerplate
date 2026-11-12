/**
 * subscription/introOffer.ts
 *
 * Pure formatting for a product's introductory offer — no SDK calls, no React.
 *
 * Two things were wrong in the copy this replaces. It printed the duration as
 * "Days" whatever `periodUnit` actually said, so a one-month intro rendered as
 * "1 Days Free Trial". And when a product carried no intro offer at all it fell
 * back to a hardcoded "3 Days Free Trial" — an offer that may not exist in your
 * catalog at all. Advertising a trial nobody can claim is
 * a store-review and consumer-law problem, so the rule here is that no offer
 * produces no text, and the caller hides the row.
 *
 * A free trial and introductory pricing are different things and are worded
 * differently — `price === 0` is the only thing that separates them.
 */

import type { PurchasesIntroPrice } from 'react-native-purchases';

import { translate, type TxKeyPath } from '@/localization/utils';

/**
 * RC reports the unit as DAY | WEEK | MONTH | YEAR. The keys are i18next plural
 * keys, resolved from `count` (`_one` / `_other`, plus the extra forms languages
 * like Arabic need); the base key has no entry of its own, hence the cast.
 */
const UNIT_KEY: Record<string, TxKeyPath> = {
  DAY: 'subscription.intro_unit_day' as TxKeyPath,
  WEEK: 'subscription.intro_unit_week' as TxKeyPath,
  MONTH: 'subscription.intro_unit_month' as TxKeyPath,
  YEAR: 'subscription.intro_unit_year' as TxKeyPath,
};

/** True when the offer costs nothing — the only case that may be called a trial. */
export const isFreeTrial = (intro: PurchasesIntroPrice | null | undefined): boolean =>
  !!intro && intro.price === 0 && intro.periodNumberOfUnits > 0;

/**
 * "3 days", "1 month", "2 weeks" — or an empty string when the offer carries no
 * usable duration, which is the signal to render nothing at all.
 *
 */
export function formatIntroDuration(intro: PurchasesIntroPrice | null | undefined): string {
  if (!intro) return '';
  const count = intro.periodNumberOfUnits;
  const key = UNIT_KEY[intro.periodUnit?.toUpperCase() ?? ''];
  if (!key || !Number.isFinite(count) || count <= 0) return '';
  return translate(key, { count });
}

/**
 * The user-facing description of an introductory offer, or an empty string when
 * there is no offer to describe. Never invents one.
 */
export function formatIntroOffer(intro: PurchasesIntroPrice | null | undefined): string {
  const duration = formatIntroDuration(intro);
  if (!duration || !intro) return '';
  return isFreeTrial(intro)
    ? translate('subscription.intro_free_trial', { duration })
    : translate('subscription.intro_discount', { price: intro.priceString, duration });
}
