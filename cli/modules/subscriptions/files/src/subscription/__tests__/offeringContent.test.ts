import { PACKAGE_TYPE, type PurchasesPackage } from 'react-native-purchases';

import {
  buildPaywallPlans,
  effectivePackageType,
  FREE_PLAN_ID,
  readMetadataValue,
  resolveFeatures,
} from '../offeringContent';

/**
 * Translation stand-in: returns the key, with any interpolation appended, so a
 * test can assert which key was chosen without depending on the copy.
 */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${Object.values(options).join(',')}` : key;

const pkg = (
  identifier: string,
  packageType: PACKAGE_TYPE,
  product: Partial<PurchasesPackage['product']> = {},
): PurchasesPackage =>
  ({
    identifier,
    packageType,
    product: {
      identifier: `product.${identifier}`,
      title: `Store title for ${identifier}`,
      priceString: '$1.00',
      subscriptionPeriod: null,
      ...product,
    },
  }) as PurchasesPackage;

const build = (packages: PurchasesPackage[], metadata: Record<string, unknown> | null = null) =>
  buildPaywallPlans({
    packages,
    metadata,
    locale: 'en',
    t: t as never,
    getPackagePrice: (p) => p.product.priceString,
    getTrialText: () => '',
  });

describe('buildPaywallPlans', () => {
  it('renders every package the offering serves, in its order, after the free card', () => {
    const plans = build([
      pkg('$rc_weekly', PACKAGE_TYPE.WEEKLY),
      pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY),
      pkg('$rc_annual', PACKAGE_TYPE.ANNUAL),
    ]);

    expect(plans.map((plan) => plan.id)).toEqual([
      FREE_PLAN_ID,
      '$rc_weekly',
      '$rc_monthly',
      '$rc_annual',
    ]);
  });

  // The regression this module exists for: a plan added in the dashboard used
  // to be dropped because the paywall only looked for MONTHLY and ANNUAL.
  it('shows a package type the app has never seen before', () => {
    const plans = build([pkg('$rc_six_month', PACKAGE_TYPE.SIX_MONTH)]);

    expect(plans[1]).toMatchObject({
      id: '$rc_six_month',
      title: 'subscription.plan_title:subscription.plan_period_six_month',
      pricePeriod: 'subscription.price_per_six_month',
    });
  });

  it('takes the price from the store, never formatting one itself', () => {
    const plans = build([pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY, { priceString: '₹499.00' })]);

    expect(plans[1].price).toBe('₹499.00');
  });

  // "$0" is the wrong currency everywhere outside the US, and the free card is
  // not a product with a store price to read.
  it('gives the free card a translated word rather than a currency amount', () => {
    const [free] = build([]);

    expect(free.price).toBe('subscription.plan_free_price');
    expect(free.pkg).toBeNull();
  });

  it('labels a lifetime package with no renewal period', () => {
    const plans = build([pkg('$rc_lifetime', PACKAGE_TYPE.LIFETIME)]);

    expect(plans[1].pricePeriod).toBe('');
  });

  it('falls back to the store product title for an unclassifiable package', () => {
    const plans = build([pkg('custom', PACKAGE_TYPE.CUSTOM)]);

    expect(plans[1].title).toBe('Store title for custom');
    expect(plans[1].pricePeriod).toBe('');
  });

  it('reads a custom package as its billing period when the product has one', () => {
    const plans = build([pkg('custom', PACKAGE_TYPE.CUSTOM, { subscriptionPeriod: 'P3M' })]);

    expect(plans[1].title).toBe('subscription.plan_title:subscription.plan_period_three_month');
  });

  describe('metadata', () => {
    it('takes the plan name from the dashboard when it sets one', () => {
      const plans = build([pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY)], {
        titles: { $rc_monthly: 'Founding Member' },
      });

      expect(plans[1].title).toBe('Founding Member');
    });

    it('picks the caller locale out of a locale map', () => {
      const plans = buildPaywallPlans({
        packages: [pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY)],
        metadata: { titles: { $rc_monthly: { en: 'Monthly', es: 'Mensual' } } },
        locale: 'es',
        t: t as never,
        getPackagePrice: (p) => p.product.priceString,
        getTrialText: () => '',
      });

      expect(plans[1].title).toBe('Mensual');
    });

    it('moves the popular badge without an app change', () => {
      const packages = [
        pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY),
        pkg('$rc_annual', PACKAGE_TYPE.ANNUAL),
      ];

      expect(build(packages).find((plan) => plan.popular)?.id).toBe('$rc_monthly');
      expect(
        build(packages, { popular_package: '$rc_annual' }).find((plan) => plan.popular)?.id,
      ).toBe('$rc_annual');
    });

    // A typo in the dashboard must not crash the paywall or badge the wrong plan.
    it('badges nothing when metadata names a package that is not in the offering', () => {
      const plans = build([pkg('$rc_annual', PACKAGE_TYPE.ANNUAL)], {
        popular_package: '$rc_does_not_exist',
      });

      expect(plans.some((plan) => plan.popular)).toBe(false);
    });
  });
});

describe('resolveFeatures', () => {
  const fallback = ['app copy'];

  it('uses the app copy when the dashboard sets none', () => {
    expect(resolveFeatures({ metadata: null, locale: 'en', fallback })).toEqual(fallback);
    expect(resolveFeatures({ metadata: {}, locale: 'en', fallback })).toEqual(fallback);
  });

  it('uses the dashboard list when it sets one', () => {
    expect(
      resolveFeatures({ metadata: { features: ['one', 'two'] }, locale: 'en', fallback }),
    ).toEqual(['one', 'two']);
  });

  it('reads a locale map', () => {
    expect(
      resolveFeatures({
        metadata: { features: { en: ['one'], ar: ['واحد'] } },
        locale: 'ar',
        fallback,
      }),
    ).toEqual(['واحد']);
  });

  // Half-written metadata is likelier than none at all, and the paywall must
  // not render an empty feature list because someone saved a stray value.
  it('ignores a malformed value rather than rendering it', () => {
    expect(
      resolveFeatures({ metadata: { features: 'not a list' }, locale: 'en', fallback }),
    ).toEqual(fallback);
    expect(resolveFeatures({ metadata: { features: [] }, locale: 'en', fallback })).toEqual(
      fallback,
    );
    expect(resolveFeatures({ metadata: { features: [1, 2] }, locale: 'en', fallback })).toEqual(
      fallback,
    );
  });
});

describe('readMetadataValue', () => {
  const isString = (value: unknown): value is string => typeof value === 'string';

  it('falls back through region, then English, then whatever exists', () => {
    expect(readMetadataValue({ en: 'a', 'es-MX': 'b' }, 'es-MX', isString)).toBe('b');
    expect(readMetadataValue({ en: 'a', es: 'b' }, 'es-MX', isString)).toBe('b');
    expect(readMetadataValue({ en: 'a', fr: 'c' }, 'de', isString)).toBe('a');
    expect(readMetadataValue({ fr: 'c' }, 'de', isString)).toBe('c');
  });

  it('returns null for a value of the wrong shape', () => {
    expect(readMetadataValue(42, 'en', isString)).toBeNull();
    expect(readMetadataValue(null, 'en', isString)).toBeNull();
  });
});

describe('effectivePackageType', () => {
  it('keeps a recognised type and resolves an unrecognised one by period', () => {
    expect(effectivePackageType(pkg('a', PACKAGE_TYPE.ANNUAL))).toBe(PACKAGE_TYPE.ANNUAL);
    expect(
      effectivePackageType(pkg('b', PACKAGE_TYPE.UNKNOWN, { subscriptionPeriod: 'P1Y' })),
    ).toBe(PACKAGE_TYPE.ANNUAL);
    expect(effectivePackageType(pkg('c', PACKAGE_TYPE.UNKNOWN))).toBeNull();
  });
});
