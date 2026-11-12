import type { PurchasesIntroPrice } from 'react-native-purchases';

import { initI18n } from '@/localization/i18n';

import { formatIntroDuration, formatIntroOffer, isFreeTrial } from '../introOffer';

beforeAll(async () => {
  // Real English copy, so the assertions read like what users see.
  await initI18n();
});

/** An intro price stub carrying only the fields the formatters read. */
const intro = (
  overrides: Partial<PurchasesIntroPrice> & Pick<PurchasesIntroPrice, 'periodUnit'>,
): PurchasesIntroPrice =>
  ({
    price: 0,
    priceString: '$0.00',
    cycles: 1,
    period: 'P3D',
    periodNumberOfUnits: 3,
    ...overrides,
  }) as PurchasesIntroPrice;

describe('formatIntroDuration', () => {
  // The bug this replaces printed "Days" for every unit, so a one-month intro
  // rendered as "1 Days Free Trial".
  it.each([
    ['DAY', 3, '3 days'],
    ['WEEK', 2, '2 weeks'],
    ['MONTH', 1, '1 month'],
    ['YEAR', 1, '1 year'],
  ])('renders a %s period of %i as %p', (periodUnit, periodNumberOfUnits, expected) => {
    expect(formatIntroDuration(intro({ periodUnit, periodNumberOfUnits }))).toBe(expected);
  });

  it('singularises a count of one', () => {
    expect(formatIntroDuration(intro({ periodUnit: 'DAY', periodNumberOfUnits: 1 }))).toBe('1 day');
  });

  it('accepts a lowercase unit', () => {
    expect(formatIntroDuration(intro({ periodUnit: 'month', periodNumberOfUnits: 2 }))).toBe(
      '2 months',
    );
  });

  it.each([null, undefined])('returns empty for %p', (value) => {
    expect(formatIntroDuration(value)).toBe('');
  });

  it('returns empty for an unrecognised unit rather than guessing', () => {
    expect(formatIntroDuration(intro({ periodUnit: 'FORTNIGHT' }))).toBe('');
  });

  it.each([0, -1])('returns empty for a period of %i units', (periodNumberOfUnits) => {
    expect(formatIntroDuration(intro({ periodUnit: 'DAY', periodNumberOfUnits }))).toBe('');
  });
});

describe('isFreeTrial', () => {
  it('is true only when the offer costs nothing', () => {
    expect(isFreeTrial(intro({ periodUnit: 'DAY', price: 0 }))).toBe(true);
    expect(isFreeTrial(intro({ periodUnit: 'DAY', price: 1.99 }))).toBe(false);
    expect(isFreeTrial(null)).toBe(false);
  });
});

describe('formatIntroOffer', () => {
  it('describes a free trial', () => {
    expect(formatIntroOffer(intro({ periodUnit: 'DAY', periodNumberOfUnits: 7 }))).toBe(
      '7 days free trial',
    );
  });

  // Paid introductory pricing is not a trial and must not be called one.
  it('describes discounted introductory pricing separately', () => {
    expect(
      formatIntroOffer(
        intro({ periodUnit: 'MONTH', periodNumberOfUnits: 3, price: 1.99, priceString: '$1.99' }),
      ),
    ).toBe('$1.99 for the first 3 months');
  });

  // The whole point of the rewrite: this catalog has no trial configured on
  // either store, and the old code answered '3 Days Free Trial' here.
  it.each([null, undefined])('invents nothing when there is no offer (%p)', (value) => {
    expect(formatIntroOffer(value)).toBe('');
  });

  it('invents nothing when the offer has no usable duration', () => {
    expect(formatIntroOffer(intro({ periodUnit: 'DAY', periodNumberOfUnits: 0 }))).toBe('');
  });
});
