import type { PurchasesPackage } from 'react-native-purchases';
import { PACKAGE_TYPE, STORE_REPLACEMENT_MODE } from 'react-native-purchases';

import { initI18n } from '@/localization/i18n';

import {
  baseProductId,
  planChangeNotice,
  resolvePlanChange,
  resolveReplacementMode,
} from '../planChange';

beforeAll(async () => {
  // Real English copy, so the assertions read like what users see.
  await initI18n();
});

/**
 * A package stub carrying only the two fields resolvePlanChange reads.
 *
 * Identifiers follow the recommended Play setup: a single subscription product,
 * `premium`, with `monthly` and `yearly` base plans, so both identifiers share
 * the `premium` prefix and differ only after the colon.
 */
const pkg = (identifier: string, packageType: string) =>
  ({ packageType, product: { identifier } }) as unknown as PurchasesPackage;

const monthly = pkg('premium:monthly', PACKAGE_TYPE.MONTHLY);
const yearly = pkg('premium:yearly', PACKAGE_TYPE.ANNUAL);
const available = [monthly, yearly];

describe('baseProductId', () => {
  it('strips the base plan suffix Play appends', () => {
    expect(baseProductId('premium:monthly')).toBe('premium');
  });

  it('leaves a bare product id alone', () => {
    expect(baseProductId('premium')).toBe('premium');
  });

  it.each([null, undefined, ''])('returns null for %p', (value) => {
    expect(baseProductId(value)).toBeNull();
  });
});

describe('resolveReplacementMode', () => {
  /**
   * Two base plans of ONE product — this project's entire Android catalogue.
   * Play accepts only CHARGE_FULL_PRICE and WITHOUT_PRORATION here; every other
   * mode fails the purchase with DEVELOPER_ERROR, which is what these first
   * cases exist to pin down.
   */
  describe('base plans of one subscription product', () => {
    it('charges the full price for an upgrade', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.MONTHLY,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: false,
          sameSubscriptionProduct: true,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE);
    });

    // The user keeps the period they already paid for and the cheaper price
    // starts at the next billing date. DEFERRED would be the natural choice but
    // Play refuses it between base plans.
    it('switches a downgrade without proration', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.ANNUAL,
          nextPackageType: PACKAGE_TYPE.MONTHLY,
          isInTrial: false,
          sameSubscriptionProduct: true,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.WITHOUT_PRORATION);
    });

    // A trial changes nothing: the restricted pair is all Play will take.
    it('still charges the full price for an upgrade out of a trial', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.MONTHLY,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: true,
          sameSubscriptionProduct: true,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE);
    });

    // Anything outside the accepted pair is a purchase that fails outright, so
    // this sweeps the whole input space rather than trusting the branches above.
    it('never returns a mode Play rejects for this case', () => {
      const modes = [PACKAGE_TYPE.WEEKLY, PACKAGE_TYPE.MONTHLY, PACKAGE_TYPE.ANNUAL].flatMap(
        (currentPackageType) =>
          [PACKAGE_TYPE.WEEKLY, PACKAGE_TYPE.MONTHLY, PACKAGE_TYPE.ANNUAL].flatMap(
            (nextPackageType) =>
              [true, false].map((isInTrial) =>
                resolveReplacementMode({
                  currentPackageType,
                  nextPackageType,
                  isInTrial,
                  sameSubscriptionProduct: true,
                }),
              ),
          ),
      );

      for (const mode of modes) {
        expect([
          STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
          STORE_REPLACEMENT_MODE.WITHOUT_PRORATION,
        ]).toContain(mode);
      }
    });
  });

  describe('separate subscription products', () => {
    it('prorates an upgrade so the unused time is credited back', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.MONTHLY,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: false,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION);
    });

    // Charging for a shorter plan on top of a year already paid for is the
    // behaviour that generates refund requests. Play rejects DEFERRED on an
    // upgrade, so it must only ever come back for a downgrade.
    it('defers a downgrade to the end of the paid period', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.ANNUAL,
          nextPackageType: PACKAGE_TYPE.MONTHLY,
          isInTrial: false,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.DEFERRED);
    });

    // No time has been paid for yet, so there is nothing to prorate. Charging
    // now is what stops the upgrade being free until the trial's original end.
    // CHARGE_PRORATED_PRICE is only valid when the price per unit of TIME goes
    // up, which needs the billing period to stay the same.
    it('charges the prorated price when the period is unchanged in a trial', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.MONTHLY,
          nextPackageType: PACKAGE_TYPE.MONTHLY,
          isInTrial: true,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE);
    });

    // A longer period is cheaper per month, so the prorated mode would be
    // rejected — the full price is the only honest charge-now option.
    it('charges the full price when a trial upgrade lengthens the period', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.MONTHLY,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: true,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE);
    });

    it('still defers a downgrade taken during a trial', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.ANNUAL,
          nextPackageType: PACKAGE_TYPE.MONTHLY,
          isInTrial: true,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.DEFERRED);
    });

    it('prorates when the current plan cannot be identified', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: undefined,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: false,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION);
    });

    it('prorates for package types outside the billing-period ladder', () => {
      expect(
        resolveReplacementMode({
          currentPackageType: PACKAGE_TYPE.LIFETIME,
          nextPackageType: PACKAGE_TYPE.ANNUAL,
          isInTrial: false,
          sameSubscriptionProduct: false,
        }),
      ).toBe(STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION);
    });

    // Between separate products WITHOUT_PRORATION grants the new plan
    // immediately but charges nothing until the old expiry date — free paid
    // access, and the worst outcome of the five modes. Nothing on this path may
    // return it, whatever the inputs.
    it('never returns WITHOUT_PRORATION', () => {
      const combinations = [PACKAGE_TYPE.WEEKLY, PACKAGE_TYPE.MONTHLY, PACKAGE_TYPE.ANNUAL].flatMap(
        (currentPackageType) =>
          [PACKAGE_TYPE.WEEKLY, PACKAGE_TYPE.MONTHLY, PACKAGE_TYPE.ANNUAL].flatMap(
            (nextPackageType) =>
              [true, false].map((isInTrial) =>
                resolveReplacementMode({
                  currentPackageType,
                  nextPackageType,
                  isInTrial,
                  sameSubscriptionProduct: false,
                }),
              ),
          ),
      );

      expect(combinations).not.toContain(STORE_REPLACEMENT_MODE.WITHOUT_PRORATION);
    });
  });
});

describe('resolvePlanChange', () => {
  // The two plans share a product id, so the payload has to be built from the
  // full `productId:basePlanId` value to tell them apart at all.
  it('names the old product when moving between base plans of one product', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium:monthly'],
        nextPackage: yearly,
        availablePackages: available,
      }),
    ).toEqual({
      oldProductIdentifier: 'premium',
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
    });
  });

  it('switches a downgrade between base plans without proration', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium:yearly'],
        nextPackage: monthly,
        availablePackages: available,
      }),
    ).toEqual({
      oldProductIdentifier: 'premium',
      replacementMode: STORE_REPLACEMENT_MODE.WITHOUT_PRORATION,
    });
  });

  it('charges immediately when the upgrade happens during a trial', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium:monthly'],
        nextPackage: yearly,
        availablePackages: available,
        isInTrial: true,
      }),
    ).toEqual({
      oldProductIdentifier: 'premium',
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
    });
  });

  it('handles separate subscription products too', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium_monthly:monthly-base'],
        nextPackage: pkg('premium_yearly:yearly-base', PACKAGE_TYPE.ANNUAL),
        availablePackages: [
          pkg('premium_monthly:monthly-base', PACKAGE_TYPE.MONTHLY),
          pkg('premium_yearly:yearly-base', PACKAGE_TYPE.ANNUAL),
        ],
      }),
    ).toEqual({
      oldProductIdentifier: 'premium_monthly',
      replacementMode: STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION,
    });
  });

  // Null means "not a replacement", which is a plain new purchase.
  it.each([undefined, []])(
    'returns null with no active subscription (%p)',
    (activeSubscriptions) => {
      expect(
        resolvePlanChange({
          activeSubscriptions,
          nextPackage: yearly,
          availablePackages: available,
        }),
      ).toBeNull();
    },
  );

  it('returns null when re-buying the exact base plan already active', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium:yearly'],
        nextPackage: yearly,
        availablePackages: available,
      }),
    ).toBeNull();
  });

  // The offering can be stale or partially loaded; the replacement still has to
  // name the old product. With the rank unknown the move is treated as an
  // upgrade, which charges the user rather than handing out free paid time.
  it('still replaces when the active plan is missing from the offering', () => {
    expect(
      resolvePlanChange({
        activeSubscriptions: ['premium:legacy'],
        nextPackage: yearly,
        availablePackages: available,
      }),
    ).toEqual({
      oldProductIdentifier: 'premium',
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
    });
  });
});

describe('planChangeNotice', () => {
  const change = (replacementMode: STORE_REPLACEMENT_MODE) => ({
    oldProductIdentifier: 'premium',
    replacementMode,
  });

  // The paywall keeps reporting the old plan until Play sends the renewal
  // notification, so the user is owed a word about why nothing looks different.
  it('explains a deferred change', () => {
    expect(planChangeNotice(change(STORE_REPLACEMENT_MODE.DEFERRED))).toMatch(/period ends/);
  });

  // The plan switches at once here, but the new price does not — different
  // delay, so a different sentence.
  it('explains a without-proration change', () => {
    expect(planChangeNotice(change(STORE_REPLACEMENT_MODE.WITHOUT_PRORATION))).toMatch(
      /next billing date/,
    );
  });

  // Nothing to explain when the change took full effect immediately.
  it('says nothing for an immediate change', () => {
    expect(planChangeNotice(change(STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE))).toBeNull();
    expect(planChangeNotice(change(STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION))).toBeNull();
    expect(planChangeNotice(null)).toBeNull();
  });
});
