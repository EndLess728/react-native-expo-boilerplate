import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesSubscriptionInfo,
} from 'react-native-purchases';

import { ENTITLEMENT_ID } from '../config';
import {
  activeProductIdentifiers,
  deriveSubscriptionState,
  findActivePackage,
  findRelevantSubscription,
  getActiveEntitlement,
  getSubscriptionStore,
  inferPlanPeriod,
  isCrossStore,
  isEntitlementActive,
} from '../subscriptionState';

/**
 * Identifiers match this project's real catalog: Play sells one subscription
 * product, `premium`, with `monthly` and `yearly` base plans, so an active Play
 * subscription is keyed `premium:monthly`.
 */
const entitlement = (overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo =>
  ({
    identifier: ENTITLEMENT_ID,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    store: 'PLAY_STORE',
    productIdentifier: 'premium',
    productPlanIdentifier: 'monthly',
    expirationDate: '2026-09-17T00:00:00Z',
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED',
    ...overrides,
  }) as PurchasesEntitlementInfo;

const subscription = (
  overrides: Partial<PurchasesSubscriptionInfo> = {},
): PurchasesSubscriptionInfo =>
  ({
    productIdentifier: 'premium',
    productPlanIdentifier: 'monthly',
    purchaseDate: '2026-08-17T00:00:00Z',
    originalPurchaseDate: '2026-08-17T00:00:00Z',
    expiresDate: '2026-09-17T00:00:00Z',
    store: 'PLAY_STORE',
    unsubscribeDetectedAt: null,
    isSandbox: false,
    billingIssuesDetectedAt: null,
    gracePeriodExpiresDate: null,
    ownershipType: 'PURCHASED',
    periodType: 'NORMAL',
    refundedAt: null,
    storeTransactionId: 'tx-1',
    isActive: true,
    willRenew: true,
    autoResumeDate: null,
    displayName: null,
    managementURL: null,
    ...overrides,
  }) as PurchasesSubscriptionInfo;

const info = ({
  active = {},
  subscriptions = {},
  activeSubscriptions = [],
}: {
  active?: Record<string, PurchasesEntitlementInfo>;
  subscriptions?: Record<string, PurchasesSubscriptionInfo>;
  activeSubscriptions?: string[];
} = {}): CustomerInfo =>
  ({
    entitlements: { active, all: active },
    activeSubscriptions,
    subscriptionsByProductIdentifier: subscriptions,
    managementURL: null,
  }) as unknown as CustomerInfo;

/** The ordinary case: one active Play subscription on the monthly base plan. */
const paying = info({
  active: { [ENTITLEMENT_ID]: entitlement() },
  subscriptions: { 'premium:monthly': subscription() },
  activeSubscriptions: ['premium:monthly'],
});

describe('getActiveEntitlement', () => {
  it('prefers the configured entitlement', () => {
    const configured = entitlement();
    const other = entitlement({ identifier: 'Something Else' });

    expect(
      getActiveEntitlement(info({ active: { Other: other, [ENTITLEMENT_ID]: configured } })),
    ).toBe(configured);
  });

  // No fallback to "whatever else is active": with a second tier, or a typo in
  // config.ts, that would make every entitlement premium. A mismatch is loud in
  // development instead.
  it('ignores other entitlements, and warns in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const other = entitlement({ identifier: 'Renamed Pro' });

    expect(getActiveEntitlement(info({ active: { 'Renamed Pro': other } }))).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Renamed Pro'));
    warn.mockRestore();
  });

  it('returns null when nothing is active', () => {
    expect(getActiveEntitlement(info())).toBeNull();
  });
});

describe('isEntitlementActive', () => {
  it('follows the entitlement isActive flag', () => {
    expect(isEntitlementActive(paying)).toBe(true);
    expect(
      isEntitlementActive(info({ active: { [ENTITLEMENT_ID]: entitlement({ isActive: false }) } })),
    ).toBe(false);
    expect(isEntitlementActive(info())).toBe(false);
  });
});

describe('getSubscriptionStore', () => {
  it('passes through the stores the app branches on', () => {
    expect(getSubscriptionStore(paying)).toBe('PLAY_STORE');
    expect(
      getSubscriptionStore(
        info({ active: { [ENTITLEMENT_ID]: entitlement({ store: 'PROMOTIONAL' }) } }),
      ),
    ).toBe('PROMOTIONAL');
  });

  it('collapses stores it does not model to OTHER', () => {
    expect(
      getSubscriptionStore(
        info({ active: { [ENTITLEMENT_ID]: entitlement({ store: 'PADDLE' }) } }),
      ),
    ).toBe('OTHER');
  });

  it.each([null, info()])('returns null without an active entitlement (%#)', (value) => {
    expect(getSubscriptionStore(value)).toBeNull();
  });
});

describe('findRelevantSubscription', () => {
  // Play keys a base-plan subscription `productId:basePlanId`.
  it('matches a Play base plan by its compound key', () => {
    const sub = subscription();
    const found = findRelevantSubscription(
      info({ subscriptions: { 'premium:monthly': sub } }),
      entitlement(),
    );

    expect(found).toBe(sub);
  });

  // The App Store keys it by the bare product id.
  it('matches an App Store product by its bare id', () => {
    const sub = subscription({ productIdentifier: 'com.example.app.monthly' });
    const found = findRelevantSubscription(
      info({ subscriptions: { 'com.example.app.monthly': sub } }),
      entitlement({ productIdentifier: 'com.example.app.monthly', productPlanIdentifier: null }),
    );

    expect(found).toBe(sub);
  });

  // Pause and refund leave NO active entitlement, so those states are only
  // reachable through this fallback.
  it('falls back to the latest-expiring record with no active entitlement', () => {
    const older = subscription({ expiresDate: '2026-01-01T00:00:00Z' });
    const newer = subscription({ expiresDate: '2026-08-01T00:00:00Z' });

    expect(
      findRelevantSubscription(info({ subscriptions: { old: older, new: newer } }), null),
    ).toBe(newer);
  });

  it('returns null when there are no subscription records', () => {
    expect(findRelevantSubscription(info(), entitlement())).toBeNull();
  });
});

describe('activeProductIdentifiers', () => {
  // The bug this exists to fix: on Android both plans report `premium` as the
  // entitlement's productIdentifier, and the base plan is carried separately.
  // Recombining them is the only way to tell monthly from yearly.
  it('recombines an Android product id with its base plan, most specific first', () => {
    expect(activeProductIdentifiers(paying)).toEqual(['premium:monthly', 'premium']);
  });

  it('uses the bare product id on iOS, where there is no base plan', () => {
    expect(
      activeProductIdentifiers(
        info({
          active: {
            [ENTITLEMENT_ID]: entitlement({
              productIdentifier: 'com.example.app.monthly',
              productPlanIdentifier: null,
            }),
          },
        }),
      ),
    ).toEqual(['com.example.app.monthly']);
  });

  it('appends anything in activeSubscriptions that is not already listed', () => {
    expect(
      activeProductIdentifiers(
        info({
          active: { [ENTITLEMENT_ID]: entitlement() },
          activeSubscriptions: ['premium:monthly', 'legacy_pro'],
        }),
      ),
    ).toEqual(['premium:monthly', 'premium', 'legacy_pro']);
  });

  it('returns nothing without an active entitlement', () => {
    expect(activeProductIdentifiers(info())).toEqual([]);
  });
});

describe('findActivePackage', () => {
  const pkg = (identifier: string) => ({ product: { identifier } }) as never;
  const monthlyPkg = pkg('premium:monthly');
  const yearlyPkg = pkg('premium:yearly');

  // The regression under test. Comparing the raw productIdentifier (`premium`)
  // against these packages matched neither, so every Play subscriber looked like
  // they had no plan: no Active badge, Free preselected, and a CTA offering to
  // sell them what they already owned.
  it('matches an Android base-plan package', () => {
    expect(findActivePackage(paying, [monthlyPkg, yearlyPkg])).toBe(monthlyPkg);
  });

  it('matches the yearly base plan', () => {
    const yearly = info({
      active: {
        [ENTITLEMENT_ID]: entitlement({ productPlanIdentifier: 'yearly' }),
      },
      activeSubscriptions: ['premium:yearly'],
    });

    expect(findActivePackage(yearly, [monthlyPkg, yearlyPkg])).toBe(yearlyPkg);
  });

  it('matches an iOS package by its bare identifier', () => {
    const iosMonthly = pkg('com.example.app.monthly');
    const iosInfo = info({
      active: {
        [ENTITLEMENT_ID]: entitlement({
          productIdentifier: 'com.example.app.monthly',
          productPlanIdentifier: null,
          store: 'APP_STORE',
        }),
      },
    });

    expect(findActivePackage(iosInfo, [iosMonthly, yearlyPkg])).toBe(iosMonthly);
  });

  it('returns null for a non-subscriber', () => {
    expect(findActivePackage(info(), [monthlyPkg, yearlyPkg])).toBeNull();
    expect(findActivePackage(null, [monthlyPkg, yearlyPkg])).toBeNull();
  });

  it('returns null when the active product is no longer on offer', () => {
    const legacy = info({
      active: {
        [ENTITLEMENT_ID]: entitlement({
          productIdentifier: 'legacy_pro',
          productPlanIdentifier: null,
        }),
      },
    });

    expect(findActivePackage(legacy, [monthlyPkg, yearlyPkg])).toBeNull();
  });

  it('tolerates null entries in the package list', () => {
    expect(findActivePackage(paying, [null, undefined, monthlyPkg])).toBe(monthlyPkg);
  });
});

describe('inferPlanPeriod', () => {
  it.each([
    [['premium:monthly'], 'monthly'],
    [['premium:yearly'], 'annual'],
    [['com.example.app.annual'], 'annual'],
  ])('reads %p as %s', (ids, expected) => {
    expect(inferPlanPeriod(ids)).toBe(expected);
  });

  // A product named 12month_plan is yearly; checking for "month" first would
  // misread it, so annual has to be tested first.
  it('does not misread a yearly plan named in months', () => {
    expect(inferPlanPeriod(['app_12month_yearly'])).toBe('annual');
  });

  it.each([[[]], [['premium']], [['app_pro_lifetime']]])('returns null for %p', (ids) => {
    expect(inferPlanPeriod(ids)).toBeNull();
  });
});

describe('deriveSubscriptionState', () => {
  it('reports a plain paying subscriber with no warnings raised', () => {
    expect(deriveSubscriptionState(paying)).toMatchObject({
      isActive: true,
      willRenew: true,
      isCancelled: false,
      inGracePeriod: false,
      isInTrial: false,
      isPaused: false,
      isFamilyShared: false,
      hasMultipleActiveSubscriptions: false,
      store: 'PLAY_STORE',
      expiresAt: '2026-09-17T00:00:00Z',
    });
  });

  it('reports nothing at all for a null CustomerInfo', () => {
    expect(deriveSubscriptionState(null)).toMatchObject({
      isActive: false,
      activeSubscriptionCount: 0,
      periodType: null,
    });
  });

  describe('grace period (REN-1)', () => {
    // The entitlement spells it billingIssueDetectedAt (singular) and the
    // subscription record billingIssuesDetectedAt (plural). Reading only one is
    // how this check ends up permanently false.
    it('detects a billing issue reported on the subscription record', () => {
      const state = deriveSubscriptionState(
        info({
          active: { [ENTITLEMENT_ID]: entitlement() },
          subscriptions: {
            'premium:monthly': subscription({
              billingIssuesDetectedAt: '2026-08-15T00:00:00Z',
              gracePeriodExpiresDate: '2026-08-22T00:00:00Z',
            }),
          },
        }),
      );

      expect(state.inGracePeriod).toBe(true);
      expect(state.gracePeriodExpiresAt).toBe('2026-08-22T00:00:00Z');
    });

    it('detects a billing issue reported only on the entitlement', () => {
      const state = deriveSubscriptionState(
        info({
          active: {
            [ENTITLEMENT_ID]: entitlement({ billingIssueDetectedAt: '2026-08-15T00:00:00Z' }),
          },
        }),
      );

      expect(state.inGracePeriod).toBe(true);
      expect(state.billingIssueDetectedAt).toBe('2026-08-15T00:00:00Z');
    });

    // Once access is gone it is a lapse or a Play account hold, and neither
    // store reports which. Claiming "grace period" there would be a guess.
    it('does not call it a grace period once access has ended', () => {
      const state = deriveSubscriptionState(
        info({
          subscriptions: {
            'premium:monthly': subscription({
              isActive: false,
              billingIssuesDetectedAt: '2026-08-15T00:00:00Z',
            }),
          },
        }),
      );

      expect(state.isActive).toBe(false);
      expect(state.inGracePeriod).toBe(false);
      expect(state.billingIssueDetectedAt).toBe('2026-08-15T00:00:00Z');
    });
  });

  describe('cancelled but still inside the paid period (REN-4)', () => {
    it('exposes the remaining time rather than just blocking', () => {
      const state = deriveSubscriptionState(
        info({
          active: { [ENTITLEMENT_ID]: entitlement({ willRenew: false }) },
          subscriptions: {
            'premium:monthly': subscription({
              willRenew: false,
              unsubscribeDetectedAt: '2026-08-16T00:00:00Z',
            }),
          },
        }),
      );

      expect(state).toMatchObject({
        isActive: true,
        isCancelled: true,
        willRenew: false,
        unsubscribedAt: '2026-08-16T00:00:00Z',
        expiresAt: '2026-09-17T00:00:00Z',
      });
    });
  });

  describe('trial vs paying (TRIAL-4)', () => {
    it('distinguishes a trialist and dates the end of the trial', () => {
      const state = deriveSubscriptionState(
        info({
          active: { [ENTITLEMENT_ID]: entitlement({ periodType: 'TRIAL' }) },
          subscriptions: { 'premium:monthly': subscription({ periodType: 'TRIAL' }) },
        }),
      );

      expect(state).toMatchObject({
        isInTrial: true,
        periodType: 'TRIAL',
        trialEndsAt: '2026-09-17T00:00:00Z',
      });
    });

    it('leaves trialEndsAt null for a paying subscriber', () => {
      expect(deriveSubscriptionState(paying)).toMatchObject({
        isInTrial: false,
        trialEndsAt: null,
      });
    });

    it('does not mistake introductory pricing for a trial', () => {
      expect(
        deriveSubscriptionState(
          info({
            active: { [ENTITLEMENT_ID]: entitlement({ periodType: 'INTRO' }) },
          }),
        ),
      ).toMatchObject({ isInTrial: false, periodType: 'INTRO' });
    });
  });

  // The banner names the plan next to the date, so this has to survive the
  // states where the entitlement is gone.
  describe('plan period', () => {
    it('reads the period off the active Play base plan', () => {
      expect(deriveSubscriptionState(paying).planPeriod).toBe('monthly');
    });

    it('reads an annual plan', () => {
      const state = deriveSubscriptionState(
        info({
          active: { [ENTITLEMENT_ID]: entitlement({ productPlanIdentifier: 'yearly' }) },
          subscriptions: { 'premium:yearly': subscription({ productPlanIdentifier: 'yearly' }) },
          activeSubscriptions: ['premium:yearly'],
        }),
      );

      expect(state.planPeriod).toBe('annual');
    });

    // A paused subscription has no active entitlement and reports nothing in
    // activeSubscriptions, so the period can only come from the record.
    it('falls back to the subscription record when the entitlement is gone', () => {
      const state = deriveSubscriptionState(
        info({
          subscriptions: {
            'premium:yearly': subscription({
              productPlanIdentifier: 'yearly',
              isActive: false,
              autoResumeDate: '2026-10-01T00:00:00Z',
            }),
          },
        }),
      );

      expect(state).toMatchObject({ isPaused: true, planPeriod: 'annual' });
    });

    // Better to drop the plan line than to guess a period from an identifier
    // that does not name one.
    it('is null when no identifier names a period', () => {
      const state = deriveSubscriptionState(
        info({
          active: { [ENTITLEMENT_ID]: entitlement({ productPlanIdentifier: null }) },
          subscriptions: { premium: subscription({ productPlanIdentifier: null }) },
          activeSubscriptions: ['premium'],
        }),
      );

      expect(state.planPeriod).toBeNull();
    });

    it('reports no plan at all for a null CustomerInfo', () => {
      expect(deriveSubscriptionState(null).planPeriod).toBeNull();
    });
  });

  describe('Play pause (REN-3)', () => {
    // autoResumeDate is set only for a paused Play subscription, and a paused
    // subscription has no active entitlement.
    it('reports a paused subscription and when it resumes', () => {
      const state = deriveSubscriptionState(
        info({
          subscriptions: {
            'premium:monthly': subscription({
              isActive: false,
              autoResumeDate: '2026-10-01T00:00:00Z',
            }),
          },
        }),
      );

      expect(state).toMatchObject({
        isActive: false,
        isPaused: true,
        resumesAt: '2026-10-01T00:00:00Z',
      });
    });

    it('is not paused in the ordinary case', () => {
      expect(deriveSubscriptionState(paying)).toMatchObject({ isPaused: false, resumesAt: null });
    });
  });

  describe('family sharing (GATE-3)', () => {
    // Fully entitled, but cannot cancel or change it — so no management control
    // should be offered.
    it('flags an entitlement received through family sharing', () => {
      expect(
        deriveSubscriptionState(
          info({
            active: { [ENTITLEMENT_ID]: entitlement({ ownershipType: 'FAMILY_SHARED' }) },
            subscriptions: {
              'premium:monthly': subscription({ ownershipType: 'FAMILY_SHARED' }),
            },
          }),
        ),
      ).toMatchObject({ isActive: true, isFamilyShared: true });
    });

    it('does not flag a purchase the user made themselves', () => {
      expect(deriveSubscriptionState(paying).isFamilyShared).toBe(false);
    });
  });

  describe('duplicate subscriptions (CHG-7)', () => {
    // Two live store subscriptions is the double-billing signature from a plan
    // change made on a device signed into a different store account.
    it('flags more than one active store subscription', () => {
      expect(
        deriveSubscriptionState(
          info({
            active: { [ENTITLEMENT_ID]: entitlement() },
            activeSubscriptions: ['premium:monthly', 'premium:yearly'],
          }),
        ),
      ).toMatchObject({ hasMultipleActiveSubscriptions: true, activeSubscriptionCount: 2 });
    });

    // A plan change between base plans of one Play product replaces rather than
    // duplicates, so the ordinary upgrade must not trip this.
    it('does not flag a single active subscription', () => {
      expect(deriveSubscriptionState(paying)).toMatchObject({
        hasMultipleActiveSubscriptions: false,
        activeSubscriptionCount: 1,
      });
    });
  });

  describe('refunds (REN-6)', () => {
    it('surfaces the refund timestamp', () => {
      expect(
        deriveSubscriptionState(
          info({
            subscriptions: {
              'premium:monthly': subscription({
                isActive: false,
                refundedAt: '2026-08-16T00:00:00Z',
              }),
            },
          }),
        ),
      ).toMatchObject({ isActive: false, refundedAt: '2026-08-16T00:00:00Z' });
    });
  });
});

describe('deriveSubscriptionState with the backend record', () => {
  const backendOnHold = {
    status: 'on_hold' as const,
    plan_type: 'YEARLY' as const,
    platform: 'android',
    product_identifier: 'premium:yearly',
    subscription_id: 'rc_sub_1234',
    current_period_start: '2026-08-01T00:00:00Z',
    current_period_end: '2027-08-01T00:00:00Z',
    cancel_at_period_end: false,
    pending_plan_type: null,
    is_trial_plan: false,
  };

  /** Access gone: no active entitlement, one subscription record left behind. */
  const lapsed = info({ subscriptions: { 'premium:yearly': subscription({ isActive: false }) } });

  it('reports an account hold the device could not have known about', () => {
    const state = deriveSubscriptionState(lapsed, backendOnHold);

    expect(state.isActive).toBe(false);
    expect(state.isOnHold).toBe(true);
    expect(state.backendStatus).toBe('on_hold');
  });

  // The entitlement stays the gate. A backend lagging behind the store must not
  // be able to lock out a user the store still says is paid.
  it('never claims a hold while the entitlement is live', () => {
    const state = deriveSubscriptionState(paying, backendOnHold);

    expect(state.isActive).toBe(true);
    expect(state.isOnHold).toBe(false);
  });

  it('carries a scheduled plan change through', () => {
    const state = deriveSubscriptionState(paying, {
      ...backendOnHold,
      status: 'active',
      pending_plan_type: 'MONTHLY',
    });

    expect(state.pendingPlanType).toBe('MONTHLY');
  });

  // The module has to keep working for a host with no backend at all — that is
  // the position every RevenueCat-only client is in.
  it('leaves both states off when there is no record', () => {
    const state = deriveSubscriptionState(lapsed);

    expect(state.isOnHold).toBe(false);
    expect(state.pendingPlanType).toBeNull();
    expect(state.backendStatus).toBeNull();
  });
});

describe('lifetime purchases', () => {
  // A non-expiring entitlement has no renewal to turn off, so `willRenew` is
  // false — which must not read as "cancelled".
  const lifetime = info({
    active: {
      [ENTITLEMENT_ID]: entitlement({ willRenew: false, expirationDate: null }),
    },
    subscriptions: {},
    activeSubscriptions: [],
  });

  it('is lifetime, not cancelled', () => {
    expect(deriveSubscriptionState(lifetime)).toMatchObject({
      isActive: true,
      isLifetime: true,
      isCancelled: false,
    });
  });

  it('still reports an expiring subscription with auto-renew off as cancelled', () => {
    expect(
      deriveSubscriptionState(
        info({ active: { [ENTITLEMENT_ID]: entitlement({ willRenew: false }) } }),
      ),
    ).toMatchObject({ isLifetime: false, isCancelled: true });
  });
});

describe('isCrossStore', () => {
  it.each([
    ['PLAY_STORE', 'ios', true],
    ['APP_STORE', 'android', true],
    // Web billing can't be replaced from a store either: buying here would
    // start a second, separately billed subscription.
    ['STRIPE', 'ios', true],
    ['OTHER', 'android', true],
    ['APP_STORE', 'ios', false],
    ['PLAY_STORE', 'android', false],
    ['PROMOTIONAL', 'ios', false],
    [null, 'ios', false],
  ] as const)('%s on %s → %s', (store, os, expected) => {
    expect(isCrossStore(store, os)).toBe(expected);
  });
});
