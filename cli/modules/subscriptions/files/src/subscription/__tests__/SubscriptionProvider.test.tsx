import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  INTRO_ELIGIBILITY_STATUS,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  STORE_REPLACEMENT_MODE,
} from 'react-native-purchases';
import Toast from 'react-native-toast-message';

import { initI18n } from '@/localization/i18n';

import { ENTITLEMENT_ID } from '../config';
import * as service from '../service';
import { SubscriptionProvider, useSubscriptionContext } from '../SubscriptionProvider';

// The modal is UI-only and pulls in the whole style layer; the entitlement
// logic under test never renders it.
jest.mock('../components/UnlockModal', () => () => null);

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));

// The real helper also loads the styled toast renderer, which needs the style
// engine's native module. Same mapping (title → text1, message → text2).
jest.mock('@/shared/utils/toast', () => {
  const Toast = require('react-native-toast-message').default;
  const show =
    (type: string) =>
    ({ title, message, ...rest }: { title: string; message?: string }) =>
      Toast.show({ ...rest, type, text1: title, text2: message });
  return {
    showErrorToast: show('error'),
    showInfoToast: show('info'),
    showSuccessToast: show('success'),
    showWarningToast: show('warning'),
  };
});

// Every function the provider imports from ./service must appear here — a
// missing one is `undefined`, and the provider's try/catch turns the resulting
// TypeError into a silent "purchase returned null".
jest.mock('../service', () => ({
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(),
  checkTrialEligibility: jest.fn().mockResolvedValue(null),
  configurePurchases: jest.fn().mockResolvedValue(undefined),
  ensureIdentifiedUser: jest.fn().mockResolvedValue(true),
  getCustomerInfo: jest.fn().mockResolvedValue(null),
  getOfferings: jest.fn().mockResolvedValue(null),
  invalidateCustomerInfoCache: jest.fn().mockResolvedValue(undefined),
  loginToPurchases: jest.fn().mockResolvedValue(null),
  logoutFromPurchases: jest.fn().mockResolvedValue(null),
  purchasePackage: jest.fn().mockResolvedValue(null),
  restorePurchases: jest.fn().mockResolvedValue(null),
  syncAndRefresh: jest.fn().mockResolvedValue(null),
  syncUserAttributes: jest.fn().mockResolvedValue(undefined),
}));

const mocked = service as jest.Mocked<typeof service>;

/** A CustomerInfo carrying the given active entitlements. */
const customerInfo = (
  active: Record<string, { isActive: boolean; willRenew?: boolean; periodType?: string }>,
  activeSubscriptions: string[] = [],
) =>
  ({
    entitlements: {
      active: Object.fromEntries(
        Object.entries(active).map(([id, e]) => [
          id,
          {
            identifier: id,
            isActive: e.isActive,
            willRenew: e.willRenew ?? true,
            periodType: e.periodType ?? 'NORMAL',
            // A subscription expires; no expiry would make it a lifetime purchase.
            expirationDate: '2099-01-01T00:00:00Z',
          },
        ]),
      ),
    },
    activeSubscriptions,
    managementURL: null,
  }) as never;

const subscribed = customerInfo({ [ENTITLEMENT_ID]: { isActive: true } });

const user = { id: '42', email: 'a@b.com' };

const render = (props: Partial<React.ComponentProps<typeof SubscriptionProvider>> = {}) =>
  renderHook(() => useSubscriptionContext(), {
    wrapper: ({ children }) => (
      <SubscriptionProvider userData={user} onOpenPaywall={jest.fn()} {...props}>
        {children}
      </SubscriptionProvider>
    ),
  });

// Plan-change behaviour is platform-specific, so one test switches Platform.OS.
// Restore it afterwards or every later test inherits Android.
const originalPlatform = Platform.OS;

// The provider reports unrecoverable purchase problems through Alert; spying
// keeps the assertions on what the user is actually told.
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

afterAll(() => alertSpy.mockRestore());

// Real English copy, so assertions read like what the user is told.
beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = originalPlatform;
  mocked.getCustomerInfo.mockResolvedValue(null);
  mocked.getOfferings.mockResolvedValue(null);
  // The wrapper resolves to a map of eligibilities; "none known" is an empty
  // map, not null — null would not survive the first `Object.keys` on it.
  mocked.checkTrialEligibility.mockResolvedValue({});
  mocked.loginToPurchases.mockResolvedValue(null);
  mocked.ensureIdentifiedUser.mockResolvedValue(true);
});

describe('isPremium', () => {
  it('is false before RevenueCat has reported anything', async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPremium).toBe(false);
  });

  it('is true when the configured entitlement is active', async () => {
    mocked.getCustomerInfo.mockResolvedValue(subscribed);

    const { result } = render();

    await waitFor(() => expect(result.current.isPremium).toBe(true));
  });

  // An entitlement can be present but expired. Keying off presence alone
  // would hand a lapsed subscriber full access.
  it('is false when the entitlement is present but inactive', async () => {
    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: false } }),
    );

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPremium).toBe(false);
  });

  // No fallback to another active entitlement: with a second tier (or a typo in
  // config.ts) that would make every entitlement premium.
  it('ignores an entitlement other than the configured one', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.getCustomerInfo.mockResolvedValue(customerInfo({ 'Legacy Pro': { isActive: true } }));

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPremium).toBe(false);
    warn.mockRestore();
  });

  it('is false when there are no active entitlements at all', async () => {
    mocked.getCustomerInfo.mockResolvedValue(customerInfo({}));

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPremium).toBe(false);
  });
});

describe('purchase', () => {
  const pkg = { identifier: 'monthly', product: { priceString: '$9.99' } } as never;

  it('notifies the host app so it can sync the purchase to the backend', async () => {
    mocked.purchasePackage.mockResolvedValue(subscribed);
    const onPurchaseSuccess = jest.fn().mockResolvedValue(undefined);

    const { result } = render({ onPurchaseSuccess });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.purchase(pkg);
    });

    expect(mocked.purchasePackage).toHaveBeenCalledWith(pkg, null);
    expect(onPurchaseSuccess).toHaveBeenCalledWith(subscribed);
  });

  it('unlocks premium once the purchase resolves', async () => {
    mocked.purchasePackage.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPremium).toBe(false);

    await act(async () => {
      await result.current.purchase(pkg);
    });

    expect(result.current.isPremium).toBe(true);
  });

  // Backing out of the App Store sheet is not a failure. Treating it as one
  // would fire the backend sync and show the user an error for a deliberate
  // action.
  it('treats a user cancellation as a no-op', async () => {
    const onPurchaseSuccess = jest.fn();
    mocked.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
      userCancelled: true,
      message: 'cancelled',
    });

    const { result } = render({ onPurchaseSuccess });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.purchase(pkg);
    });

    expect(returned).toBeNull();
    expect(onPurchaseSuccess).not.toHaveBeenCalled();
  });

  // This used to be blocked on the belief that the store would reject it. Both
  // stores allow it — the Play base plans are RESUBSCRIBE_STATE_ACTIVE — and
  // blocking turned the one recoverable moment in the churn path into a hard
  // stop. Re-buying while cancelled is how auto-renew gets switched back on.
  it('allows a purchase while the subscription is cancelled', async () => {
    const cancelled = customerInfo({ [ENTITLEMENT_ID]: { isActive: true, willRenew: false } });
    mocked.getCustomerInfo.mockResolvedValue(cancelled);
    mocked.purchasePackage.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));
    expect(result.current.subscriptionState.isCancelled).toBe(true);

    let returned: unknown;
    await act(async () => {
      returned = await result.current.purchase(pkg);
    });

    expect(mocked.purchasePackage).toHaveBeenCalled();
    expect(returned).toBe(subscribed);
  });

  it('allows a plan change while the subscription is renewing', async () => {
    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true, willRenew: true } }),
    );
    mocked.purchasePackage.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.purchase(pkg);
    });

    // iOS resolves the plan change itself through the subscription group, so
    // no product-change payload is sent.
    expect(mocked.purchasePackage).toHaveBeenCalledWith(pkg, null);
  });

  // Monthly and yearly are base plans of one Play subscription product, so the
  // replacement is only distinguishable at `productId:basePlanId` precision.
  // Without an explicit mode Play falls back to WITHOUT_PRORATION.
  const annual = {
    identifier: 'yearly',
    packageType: PACKAGE_TYPE.ANNUAL,
    product: { identifier: 'sit_pro:yearly-base', priceString: '$59.99' },
  } as never;

  const androidOffering = {
    identifier: 'default',
    availablePackages: [
      {
        identifier: 'monthly',
        packageType: PACKAGE_TYPE.MONTHLY,
        product: { identifier: 'sit_pro:monthly-base' },
      },
      annual,
    ],
  } as never;

  it('tells Play which subscription a plan change replaces', async () => {
    Platform.OS = 'android';

    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true } }, ['sit_pro:monthly-base']),
    );
    mocked.getOfferings.mockResolvedValue(androidOffering);
    mocked.purchasePackage.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.purchase(annual);
    });

    // Both plans are base plans of one `sit_pro` product, which is the case Play
    // restricts to CHARGE_FULL_PRICE / WITHOUT_PRORATION — any other mode fails
    // the purchase with DEVELOPER_ERROR. See planChange.ts.
    expect(mocked.purchasePackage).toHaveBeenCalledWith(annual, {
      oldProductIdentifier: 'sit_pro',
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
    });
  });

  // Play's default would hand the annual plan over free until the trial's
  // original end date.
  it('charges immediately when the upgrade happens during a trial', async () => {
    Platform.OS = 'android';

    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true, periodType: 'TRIAL' } }, [
        'sit_pro:monthly-base',
      ]),
    );
    mocked.getOfferings.mockResolvedValue(androidOffering);
    mocked.purchasePackage.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.purchase(annual);
    });

    expect(mocked.purchasePackage).toHaveBeenCalledWith(annual, {
      oldProductIdentifier: 'sit_pro',
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_FULL_PRICE,
    });
  });
});

/**
 * One app login, two devices, two different store accounts.
 *
 * Device A subscribes. Device B signs into the same app account but a different
 * Google account, and tries to switch plan. Play refuses — it will not let one
 * account replace a subscription another one owns — and RevenueCat surfaces that
 * as a conflict code.
 *
 * The trap is the recovery path: it restores whatever this profile owns, which
 * is still the Device A subscription, still active. Read as "recovered", that
 * looks like a successful purchase and the paywall pops itself off the stack —
 * the plan silently unchanged and nothing said.
 */
describe('plan change blocked by a different store account', () => {
  // Same shape as the plan-change fixtures above; kept local so this block
  // stands on its own.
  const annual = {
    identifier: 'yearly',
    packageType: PACKAGE_TYPE.ANNUAL,
    product: { identifier: 'sit_pro:yearly-base', priceString: '$59.99' },
  } as never;

  const androidOffering = {
    identifier: 'default',
    availablePackages: [
      {
        identifier: 'monthly',
        packageType: PACKAGE_TYPE.MONTHLY,
        product: { identifier: 'sit_pro:monthly-base' },
      },
      annual,
    ],
  } as never;

  const monthlyActive = customerInfo({ [ENTITLEMENT_ID]: { isActive: true } }, [
    'sit_pro:monthly-base',
  ]);

  const refusePlanChange = () => {
    Platform.OS = 'android';
    mocked.getCustomerInfo.mockResolvedValue(monthlyActive);
    mocked.getOfferings.mockResolvedValue(androidOffering);
    mocked.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
      message: 'Product already purchased',
      userCancelled: false,
    });
  };

  it('reports failure rather than the untouched old plan', async () => {
    refusePlanChange();
    // Recovery finds the Device A subscription — active, and exactly what was
    // active before the attempt.
    mocked.syncAndRefresh.mockResolvedValue(monthlyActive);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase(annual);
    });

    // Null is what stops the paywall navigating away as though it worked.
    expect(outcome).toBeNull();
  });

  it('names the store account as the reason', async () => {
    refusePlanChange();
    mocked.syncAndRefresh.mockResolvedValue(monthlyActive);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.purchase(annual);
    });

    const [title, message] = alertSpy.mock.calls.at(-1) ?? [];
    expect(title).toBe("Can't change this plan here");
    expect(message).toContain('Google account');
    // The old wording blamed the app profile and told them to log in elsewhere,
    // which is the wrong account entirely.
    expect(message).not.toContain('profile');
  });

  it('still treats recovery as success when the change actually landed', async () => {
    refusePlanChange();
    // Same conflict, but the restore comes back on the annual plan — the switch
    // did go through, so this is a real success and must not be reported as an
    // error.
    mocked.syncAndRefresh.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true } }, ['sit_pro:annual-base']),
    );

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase(annual);
    });

    expect(outcome).not.toBeNull();
  });

  // A FIRST purchase of something this store account already owns is the case
  // silent recovery exists for: the entitlement coming back active means there
  // is nothing to warn about.
  it('recovers an already-owned first purchase silently', async () => {
    Platform.OS = 'ios';
    mocked.getCustomerInfo.mockResolvedValue(null);
    mocked.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
      message: 'Product already purchased',
      userCancelled: false,
    });
    mocked.syncAndRefresh.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase(annual);
    });

    expect(outcome).not.toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // A receipt that belongs to ANOTHER app account can't be fixed by a sync from
  // this one — the user is told where the subscription lives instead.
  it('explains a receipt linked to another account without trying to recover', async () => {
    Platform.OS = 'ios';
    mocked.getCustomerInfo.mockResolvedValue(null);
    mocked.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR,
      message: 'Receipt already in use',
      userCancelled: false,
    });

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase(annual);
    });

    expect(outcome).toBeNull();
    expect(mocked.syncAndRefresh).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Subscription linked to another account');
  });
});

describe('restore', () => {
  it('notifies the host app so it can sync the restored entitlement', async () => {
    mocked.restorePurchases.mockResolvedValue(subscribed);
    const onRestoreSuccess = jest.fn().mockResolvedValue(undefined);

    const { result } = render({ onRestoreSuccess });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(mocked.restorePurchases).toHaveBeenCalled();
    expect(onRestoreSuccess).toHaveBeenCalledWith(subscribed);
  });

  it('unlocks premium after a successful restore', async () => {
    mocked.restorePurchases.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(result.current.isPremium).toBe(true);
  });
});

describe('requirePremium', () => {
  // The gate re-reads CustomerInfo but must NOT invalidate the cache to do it.
  // Forcing a network fetch on every premium tap adds a round-trip to something
  // that should be instant, burns RC request quota, and locks out a paying
  // subscriber who is offline. Freshness comes from the update listener and the
  // app-resume refresh instead.
  it('reads customer info without invalidating the cache', async () => {
    mocked.getCustomerInfo.mockResolvedValue(subscribed);

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));
    mocked.invalidateCustomerInfoCache.mockClear();
    mocked.getCustomerInfo.mockClear();

    await act(async () => {
      await result.current.requirePremium(jest.fn());
    });

    expect(mocked.getCustomerInfo).toHaveBeenCalled();
    expect(mocked.invalidateCustomerInfoCache).not.toHaveBeenCalled();
  });

  it('runs the action for a subscriber', async () => {
    mocked.getCustomerInfo.mockResolvedValue(subscribed);
    const action = jest.fn();

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.requirePremium(action);
    });

    expect(action).toHaveBeenCalled();
  });

  it('withholds the action from a non-subscriber', async () => {
    mocked.getCustomerInfo.mockResolvedValue(customerInfo({}));
    const action = jest.fn();

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.requirePremium(action);
    });

    expect(action).not.toHaveBeenCalled();
  });

  // A subscription that lapsed since the app launched must not coast on the
  // isPremium value already in state.
  it('re-locks when the fresh check says the entitlement has lapsed', async () => {
    mocked.getCustomerInfo.mockResolvedValue(subscribed);
    const action = jest.fn();

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: false } }),
    );

    await act(async () => {
      await result.current.requirePremium(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.current.isPremium).toBe(false);
  });
});

describe('purchase failures the user can act on', () => {
  const pkg = { identifier: 'monthly', product: { priceString: '$9.99' } } as never;

  const failWith = (code: string) => {
    mocked.purchasePackage.mockRejectedValue({ code, message: 'nope' });
  };

  const purchaseAndSettle = async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.purchase(pkg);
    });
    return returned;
  };

  // A pending payment has not failed. Rethrowing it — which is what used to
  // happen — surfaces a crash-shaped error for a purchase that is still on its
  // way, and the customerInfo listener grants access when it clears.
  it('swallows a pending payment and explains it instead of throwing', async () => {
    failWith(PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR);

    await expect(purchaseAndSettle()).resolves.toBeNull();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text2: expect.stringContaining('being processed') }),
    );
  });

  it.each([
    ['a store outage', PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR],
    ['a dropped connection', PURCHASES_ERROR_CODE.NETWORK_ERROR],
    ['device restrictions', PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR],
    ['an unavailable region', PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR],
  ])('reports %s to the user rather than throwing', async (_label, code) => {
    failWith(code);

    await expect(purchaseAndSettle()).resolves.toBeNull();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text2: expect.any(String) }),
    );
  });

  // Anything unrecognised is logged with its real code and told to the user
  // generically — rethrowing it out of a button handler is an unhandled
  // rejection, not a message.
  it('reports an unrecognised failure generically instead of throwing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    failWith(PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR);

    await expect(purchaseAndSettle()).resolves.toBeNull();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(error).toHaveBeenCalledWith(
      '❌ Purchase error:',
      expect.objectContaining({ code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR }),
    );
    error.mockRestore();
  });

  // Two live store subscriptions means the user is being billed twice, which
  // this device cannot fix — the store account that owns the other one is not
  // reachable from here.
  it('warns when the purchase leaves two active subscriptions', async () => {
    mocked.purchasePackage.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true } }, ['premium:monthly', 'premium:yearly']),
    );

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.purchase(pkg);
    });

    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text2: expect.stringContaining('more than one active subscription'),
      }),
    );
    expect(result.current.subscriptionState.hasMultipleActiveSubscriptions).toBe(true);
  });
});

describe('cross-store purchase guard', () => {
  const pkg = { identifier: 'monthly', product: { priceString: '$9.99' } } as never;

  /** An active subscription bought on `store`, seen from this device. */
  const boughtOn = (store: string) =>
    ({
      entitlements: {
        active: {
          [ENTITLEMENT_ID]: {
            identifier: ENTITLEMENT_ID,
            isActive: true,
            willRenew: true,
            periodType: 'NORMAL',
            store,
            productIdentifier: 'premium',
            productPlanIdentifier: null,
          },
        },
      },
      activeSubscriptions: ['premium'],
      subscriptionsByProductIdentifier: {},
      managementURL: 'https://example.test/manage',
    }) as never;

  // The store cannot replace a subscription the current account does not own, so
  // it starts a SECOND one and both platforms bill. This guard used to live only
  // in the paywall screen, meaning any other caller of purchase() reintroduced it.
  it('refuses to purchase over a subscription owned by the other store', async () => {
    Platform.OS = 'android';
    mocked.getCustomerInfo.mockResolvedValue(boughtOn('APP_STORE'));

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.purchase(pkg);
    });

    expect(returned).toBeNull();
    expect(mocked.purchasePackage).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text2: expect.stringContaining('different store') }),
    );
  });

  it('allows a purchase when the subscription belongs to this device store', async () => {
    Platform.OS = 'android';
    mocked.getCustomerInfo.mockResolvedValue(boughtOn('PLAY_STORE'));
    mocked.purchasePackage.mockResolvedValue(boughtOn('PLAY_STORE'));

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    await act(async () => {
      await result.current.purchase(pkg);
    });

    expect(mocked.purchasePackage).toHaveBeenCalled();
  });
});

describe('reloadOfferings', () => {
  // The paywall shows a retry when the offering never arrived; without this the
  // user has to leave and re-enter the screen to try again.
  it('re-fetches the offering and populates the packages', async () => {
    mocked.getOfferings.mockResolvedValue(null);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.availablePackages).toEqual([]);

    const monthly = {
      identifier: '$rc_monthly',
      packageType: PACKAGE_TYPE.MONTHLY,
      product: { identifier: 'premium:monthly' },
    };
    mocked.getOfferings.mockResolvedValue({
      identifier: 'default',
      availablePackages: [monthly],
    } as never);

    await act(async () => {
      await result.current.reloadOfferings();
    });

    expect(result.current.availablePackages).toHaveLength(1);
    expect(result.current.availablePackages[0]).toMatchObject({
      packageType: PACKAGE_TYPE.MONTHLY,
    });
    expect(result.current.isLoading).toBe(false);
  });

  // The old provider picked MONTHLY and ANNUAL out of the offering and dropped
  // the rest, so a plan added in the dashboard could not reach the paywall
  // without an app release. This is the regression test for that.
  it('keeps every package the offering serves, in its order', async () => {
    const pkg = (identifier: string, packageType: PACKAGE_TYPE) => ({
      identifier,
      packageType,
      product: { identifier: `product.${identifier}` },
    });

    mocked.getOfferings.mockResolvedValue({
      identifier: 'default',
      availablePackages: [
        pkg('$rc_weekly', PACKAGE_TYPE.WEEKLY),
        pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY),
        pkg('$rc_annual', PACKAGE_TYPE.ANNUAL),
        pkg('$rc_lifetime', PACKAGE_TYPE.LIFETIME),
      ],
    } as never);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.availablePackages.map((p) => p.identifier)).toEqual([
      '$rc_weekly',
      '$rc_monthly',
      '$rc_annual',
      '$rc_lifetime',
    ]);
  });
});

describe('subscriptionState', () => {
  // The provider only has to hand the derived state through; the derivation
  // itself is covered in subscriptionState.test.ts.
  it('exposes the states between paid and free', async () => {
    mocked.getCustomerInfo.mockResolvedValue(
      customerInfo({ [ENTITLEMENT_ID]: { isActive: true, willRenew: false } }, ['premium:monthly']),
    );

    const { result } = render();
    await waitFor(() => expect(result.current.isPremium).toBe(true));

    expect(result.current.subscriptionState).toMatchObject({
      isActive: true,
      isCancelled: true,
      inGracePeriod: false,
      isInTrial: false,
    });
  });

  it('reports an empty state before RevenueCat has answered', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.subscriptionState).toMatchObject({
      isActive: false,
      activeSubscriptionCount: 0,
    });
  });
});

describe('getTrialText', () => {
  const withIntro = (introPrice: unknown) => ({ product: { introPrice } }) as never;

  // The old fallback advertised '3 Days Free Trial' for a product with no offer,
  // which is every product in this catalog — no trial is configured on either
  // store.
  it('says nothing when the product has no introductory offer', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.getTrialText(withIntro(null))).toBe('');
    expect(result.current.getTrialText(null)).toBe('');
  });

  it('describes a real offer using its own unit', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(
      result.current.getTrialText(
        withIntro({ price: 0, priceString: '$0.00', periodUnit: 'MONTH', periodNumberOfUnits: 1 }),
      ),
    ).toBe('1 month free trial');
  });

  // An offer added in the dashboard reaches users without an app release, so the
  // paywall has to be right about who can still claim it. `introPrice` belongs
  // to the product; eligibility belongs to the user.
  describe('eligibility', () => {
    const intro = { price: 0, priceString: '$0.00', periodUnit: 'MONTH', periodNumberOfUnits: 1 };

    const renderWithEligibility = async (status: INTRO_ELIGIBILITY_STATUS) => {
      mocked.getOfferings.mockResolvedValue({
        identifier: 'default',
        availablePackages: [
          {
            identifier: '$rc_monthly',
            packageType: PACKAGE_TYPE.MONTHLY,
            product: { identifier: 'premium:monthly', introPrice: intro },
          },
        ],
      } as never);
      mocked.checkTrialEligibility.mockResolvedValue({
        'premium:monthly': { status },
      } as never);

      const { result } = render();
      await waitFor(() => expect(result.current.availablePackages).toHaveLength(1));
      return result;
    };

    it('hides an offer the user has already used', async () => {
      const result = await renderWithEligibility(
        INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
      );

      expect(result.current.getTrialText(result.current.availablePackages[0])).toBe('');
    });

    // Android answers UNKNOWN for almost everything, and hiding a real offer
    // from an eligible user is the more expensive of the two mistakes.
    it('shows the offer when eligibility is unknown', async () => {
      const result = await renderWithEligibility(
        INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN,
      );

      expect(result.current.getTrialText(result.current.availablePackages[0])).toBe(
        '1 month free trial',
      );
    });
  });
});

describe('useSubscriptionContext', () => {
  it('fails loudly when used outside the provider', () => {
    // The provider owns the only RC listener; a consumer rendered outside it
    // would silently read undefined rather than a real entitlement.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useSubscriptionContext())).toThrow(
      /must be used inside <SubscriptionProvider>/,
    );

    consoleError.mockRestore();
  });
});
