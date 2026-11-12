import { canPurchase, formatNoticeDate, resolveStatusNotice } from '../statusNotice';
import type { SubscriptionState } from '../subscriptionState';

/** A plain paying subscriber; each test overrides only what it is about. */
const state = (overrides: Partial<SubscriptionState> = {}): SubscriptionState => ({
  isActive: true,
  willRenew: true,
  periodType: 'NORMAL',
  store: 'PLAY_STORE',
  expiresAt: '2026-09-17T00:00:00Z',
  planPeriod: 'monthly',
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
  activeSubscriptionCount: 1,
  ...overrides,
});

const resolve = (
  overrides: Partial<SubscriptionState> = {},
  {
    isCrossPlatformSubscription = false,
    hasManagementURL = true,
  }: { isCrossPlatformSubscription?: boolean; hasManagementURL?: boolean } = {},
) =>
  resolveStatusNotice({
    state: state(overrides),
    isCrossPlatformSubscription,
    hasManagementURL,
  });

describe('resolveStatusNotice', () => {
  it('says nothing to someone who has never subscribed', () => {
    expect(resolve({ isActive: false, store: null, expiresAt: null })).toBeNull();
  });

  it('confirms an ordinary active subscription with its renewal date', () => {
    expect(resolve()).toMatchObject({
      kind: 'active',
      tone: 'success',
      date: '2026-09-17T00:00:00Z',
      canManage: true,
    });
  });

  describe('severity order', () => {
    // Being billed twice costs real money and needs a human, so it outranks
    // everything else that might also be true.
    it('puts duplicate billing above a grace period', () => {
      expect(resolve({ hasMultipleActiveSubscriptions: true, inGracePeriod: true })?.kind).toBe(
        'duplicate',
      );
    });

    // The whole point of surfacing a grace period is that it is time-limited.
    // "You're premium" is true but useless here.
    it('puts a grace period above the active confirmation', () => {
      expect(
        resolve({ inGracePeriod: true, gracePeriodExpiresAt: '2026-08-24T00:00:00Z' }),
      ).toMatchObject({ kind: 'grace', tone: 'danger', date: '2026-08-24T00:00:00Z' });
    });

    // A failed card is more urgent than the end date of a plan they chose to end.
    it('puts a grace period above a cancellation', () => {
      expect(resolve({ inGracePeriod: true, isCancelled: true, willRenew: false })?.kind).toBe(
        'grace',
      );
    });

    it('puts a pause above family sharing', () => {
      expect(
        resolve({ isPaused: true, resumesAt: '2026-10-01T00:00:00Z', isFamilyShared: true })?.kind,
      ).toBe('paused');
    });

    it('puts family sharing above the cross-store notice', () => {
      expect(resolve({ isFamilyShared: true }, { isCrossPlatformSubscription: true })?.kind).toBe(
        'familyShared',
      );
    });

    it('puts a cancellation above a trial', () => {
      expect(resolve({ isCancelled: true, willRenew: false, isInTrial: true })?.kind).toBe(
        'cancelled',
      );
    });
  });

  describe('access with nothing to manage', () => {
    // The store page shows a family member nothing they can change, so offering
    // the control is a dead end.
    it('offers no management for family-shared access', () => {
      expect(resolve({ isFamilyShared: true })).toMatchObject({
        kind: 'familyShared',
        tone: 'info',
        canManage: false,
      });
    });

    it('offers no management for promotional access', () => {
      expect(resolve({ store: 'PROMOTIONAL' })).toMatchObject({
        kind: 'promotional',
        canManage: false,
      });
    });

    // A promotional entitlement reports no management URL anyway, but the flag
    // must not depend on that coincidence.
    it('still offers no management for promotional access when a URL exists', () => {
      expect(resolve({ store: 'PROMOTIONAL' }, { hasManagementURL: true })?.canManage).toBe(false);
    });
  });

  // Every "manage" affordance is conditional on actually having somewhere to send
  // the user; a button that opens nothing reads as broken.
  it('withholds management when RevenueCat gave no URL', () => {
    expect(resolve({}, { hasManagementURL: false })?.canManage).toBe(false);
    expect(resolve({ inGracePeriod: true }, { hasManagementURL: false })?.canManage).toBe(false);
  });

  it('reports a paused subscription even though the entitlement is inactive', () => {
    expect(
      resolve({ isActive: false, isPaused: true, resumesAt: '2026-10-01T00:00:00Z' }),
    ).toMatchObject({ kind: 'paused', tone: 'warning', date: '2026-10-01T00:00:00Z' });
  });

  it('reports a trial with the date the charge lands', () => {
    expect(
      resolve({ isInTrial: true, periodType: 'TRIAL', trialEndsAt: '2026-08-24T00:00:00Z' }),
    ).toMatchObject({ kind: 'trial', date: '2026-08-24T00:00:00Z' });
  });

  it('reports a cancellation with the remaining paid-up date', () => {
    expect(resolve({ isCancelled: true, willRenew: false })).toMatchObject({
      kind: 'cancelled',
      tone: 'warning',
      date: '2026-09-17T00:00:00Z',
    });
  });

  // An inactive entitlement with nothing special about it is just a free user,
  // and a lapsed subscriber should see the paywall, not a status banner.
  it('says nothing for a plain lapsed subscription', () => {
    expect(resolve({ isActive: false, isCancelled: false })).toBeNull();
  });
});

describe('canPurchase', () => {
  it('allows a purchase in the ordinary case', () => {
    expect(canPurchase({ state: state(), isCrossPlatformSubscription: false })).toBe(true);
  });

  it('allows a lapsed user to subscribe again', () => {
    expect(
      canPurchase({ state: state({ isActive: false }), isCrossPlatformSubscription: false }),
    ).toBe(true);
  });

  // Buying cannot change any of these, and on the cross-store path it actively
  // creates a second subscription billed alongside the first.
  it.each([
    ['family-shared access', { isFamilyShared: true }, false],
    ['promotional access', { store: 'PROMOTIONAL' as const }, false],
    // The third element is the expected answer, spelled out per row rather
    // than assumed, so a row that should ALLOW a purchase cannot be added here
    // and silently assert the opposite.
  ])('refuses a purchase for %s', (_label, overrides, expected) => {
    expect(canPurchase({ state: state(overrides), isCrossPlatformSubscription: false })).toBe(
      expected,
    );
  });

  it('refuses a purchase when the subscription belongs to the other store', () => {
    expect(canPurchase({ state: state(), isCrossPlatformSubscription: true })).toBe(false);
  });
});

describe('formatNoticeDate', () => {
  it('renders a short absolute date', () => {
    // Asserted loosely: the exact wording is locale and ICU-version dependent.
    const formatted = formatNoticeDate('2026-09-17T10:31:07Z', 'en-US');

    expect(formatted).toContain('2026');
    expect(formatted).not.toBe('');
  });

  // Every date in a notice is a deadline that falls at a moment, not at
  // midnight, so the time ships in release builds too — and it is what makes a
  // 5-minute sandbox renewal distinguishable from the one before it.
  it('includes the time of day', () => {
    expect(formatNoticeDate('2026-09-17T10:31:07Z', 'en-US')).toMatch(/\d:\d\d/);
  });

  // Minute precision only: seconds read like a log line to a real subscriber.
  it('omits seconds', () => {
    expect(formatNoticeDate('2026-09-17T10:31:07Z', 'en-US')).not.toMatch(/\d:\d\d:\d\d/);
  });

  // Rendering "Invalid Date" at a user is worse than dropping the date and using
  // the undated wording, which is what an empty string signals to the caller.
  it.each([null, undefined, '', 'not-a-date'])('returns empty for %p', (value) => {
    expect(formatNoticeDate(value)).toBe('');
  });
});

describe('states only the backend can report', () => {
  // The alternative is a full paywall, and a user who buys from it ends up
  // paying for two subscriptions at once — the exact outcome REN-2 is about.
  it('explains an account hold rather than falling through to silence', () => {
    const notice = resolve({ isActive: false, isOnHold: true });

    expect(notice).toMatchObject({ kind: 'onHold', tone: 'danger', canManage: true });
  });

  // Neither store reports when the hold runs out; an invented deadline would be
  // worse than none.
  it('carries no date on the hold', () => {
    expect(resolve({ isActive: false, isOnHold: true })?.date).toBeNull();
  });

  // While access continues the same billing failure is a grace period, which is
  // the more actionable thing to say.
  it('prefers the grace period while access is still on', () => {
    const notice = resolve({ inGracePeriod: true, isOnHold: true });

    expect(notice?.kind).toBe('grace');
  });

  it('says a scheduled plan change is scheduled', () => {
    const notice = resolve({ pendingPlanType: 'MONTHLY' });

    expect(notice).toMatchObject({ kind: 'pendingChange', date: '2026-09-17T00:00:00Z' });
  });

  // `active` would describe the plan the user just switched away from, which
  // reads as the change having failed — and invites a second attempt.
  it('outranks the ordinary active confirmation', () => {
    expect(resolve({})?.kind).toBe('active');
    expect(resolve({ pendingPlanType: 'YEARLY' })?.kind).toBe('pendingChange');
  });

  // A card that failed still matters more than a plan change taking effect later.
  it('yields to a billing failure', () => {
    expect(resolve({ pendingPlanType: 'YEARLY', inGracePeriod: true })?.kind).toBe('grace');
  });
});
