/**
 * service.ts wraps the RevenueCat SDK and holds one piece of module state
 * (configured yet?), so each test re-imports it against a fresh registry.
 *
 * The SDK itself is mocked in jest.setup; these tests re-point individual
 * methods per case.
 */

// A key, so configuration actually happens (the env files have none in tests).
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  RC_API_KEY: 'test_key',
}));

type Service = typeof import('../service');
type Purchases = jest.Mocked<typeof import('react-native-purchases').default>;

let service: Service;
let rc: Purchases;

/**
 * Most of this file drives failure paths, which report through the console.
 * Each test claims the output it expects; anything unclaimed fails the test, so
 * an unexpected warning can't scroll by unread.
 */
let logged: string[] = [];
let claimed = new Set<number>();
let spies: jest.SpyInstance[] = [];

const consoleOut = {
  expectMessage(fragment: string) {
    const index = logged.findIndex((line, i) => !claimed.has(i) && line.includes(fragment));
    expect(index).toBeGreaterThanOrEqual(0);
    claimed.add(index);
  },
};

beforeEach(() => {
  logged = [];
  claimed = new Set();
  spies = (['warn', 'error'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    }),
  );
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
  const unclaimed = logged.filter((_, i) => !claimed.has(i));
  if (unclaimed.length > 0) {
    throw new Error(`Unexpected console output:\n${unclaimed.map((l) => `  • ${l}`).join('\n')}`);
  }
});

/** A CustomerInfo stub; only the fields the service reads are populated. */
const customerInfo = (overrides: Record<string, unknown> = {}) =>
  ({
    originalAppUserId: '$RCAnonymousID:abc',
    entitlements: { active: {} },
    ...overrides,
  }) as never;

/** Order of two SDK calls, by jest's global invocation counter. */
const ranBefore = (a: jest.Mock, b: jest.Mock) =>
  a.mock.invocationCallOrder[0] < b.mock.invocationCallOrder[0];

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  rc = require('react-native-purchases').default;
  rc.configure.mockImplementation(() => undefined as never);
  rc.getCustomerInfo.mockResolvedValue(customerInfo());
  rc.logIn.mockResolvedValue({ customerInfo: customerInfo(), created: false } as never);
  rc.logOut.mockResolvedValue(customerInfo() as never);
  rc.restorePurchases.mockResolvedValue(customerInfo() as never);
  rc.isAnonymous.mockResolvedValue(true);
  rc.getAppUserID.mockResolvedValue('user-42');
  rc.getOfferings.mockResolvedValue({ current: null, all: {} } as never);

  service = require('../service');
});

describe('configurePurchases', () => {
  it('configures the SDK with the identified user', async () => {
    await service.configurePurchases('user-42');

    expect(rc.configure).toHaveBeenCalledWith(expect.objectContaining({ appUserID: 'user-42' }));
    expect(service.isPurchasesConfigured()).toBe(true);
  });

  // No id lets RC mint an anonymous id, which is right for a signed-out launch.
  it('configures anonymously when no user is known yet', async () => {
    await service.configurePurchases();

    expect(rc.configure).toHaveBeenCalledWith(expect.objectContaining({ appUserID: undefined }));
  });

  it('is idempotent across repeated calls', async () => {
    await service.configurePurchases('user-42');
    await service.configurePurchases('user-42');

    expect(rc.configure).toHaveBeenCalledTimes(1);
  });

  it('swallows a configuration failure instead of breaking startup', async () => {
    rc.configure.mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(service.configurePurchases()).resolves.toBeUndefined();
    expect(service.isPurchasesConfigured()).toBe(false);
    consoleOut.expectMessage('RevenueCat configuration failed');
  });

  it('stays unconfigured after a failure so a later call can retry', async () => {
    rc.configure.mockImplementationOnce(() => {
      throw new Error('transient');
    });
    await service.configurePurchases();
    await service.configurePurchases();

    expect(rc.configure).toHaveBeenCalledTimes(2);
    consoleOut.expectMessage('RevenueCat configuration failed');
  });
});

describe('without an API key', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config', () => ({ ...jest.requireActual('../config'), RC_API_KEY: '' }));
    rc = require('react-native-purchases').default;
    service = require('../service');
  });

  // `doMock` survives `resetModules`; put the keyed config back for later tests.
  afterEach(() => {
    jest.doMock('../config', () => ({
      ...jest.requireActual('../config'),
      RC_API_KEY: 'test_key',
    }));
  });

  // Not set up yet must mean "nobody is premium", not a crash at startup.
  it('skips configuration, and every call degrades to nothing', async () => {
    await service.configurePurchases('user-42');

    expect(rc.configure).not.toHaveBeenCalled();
    await expect(service.getCustomerInfo()).resolves.toBeNull();
    await expect(service.getOfferings()).resolves.toBeNull();
    await expect(service.loginToPurchases({ id: 'user-42' })).resolves.toBeNull();
    consoleOut.expectMessage('No RevenueCat API key');
  });
});

describe('loginToPurchases', () => {
  beforeEach(() => service.configurePurchases());

  it('logs in and syncs attributes for a new identity', async () => {
    await service.loginToPurchases({ id: 'user-42', email: 'a@b.com' });

    expect(rc.logIn).toHaveBeenCalledWith('user-42');
    expect(rc.setEmail).toHaveBeenCalledWith('a@b.com');
  });

  it('skips the login when already identified as that user', async () => {
    rc.isAnonymous.mockResolvedValue(false);
    rc.getAppUserID.mockResolvedValue('user-42');

    await service.loginToPurchases({ id: 'user-42' });

    expect(rc.logIn).not.toHaveBeenCalled();
  });

  it('logs in when the SDK is identified as a different user', async () => {
    rc.isAnonymous.mockResolvedValue(false);
    rc.getAppUserID.mockResolvedValue('someone-else');

    await service.loginToPurchases({ id: 'user-42' });

    expect(rc.logIn).toHaveBeenCalledWith('user-42');
  });

  it('rethrows so the caller cannot proceed on a failed identity', async () => {
    rc.logIn.mockRejectedValue(new Error('network'));

    await expect(service.loginToPurchases({ id: 'user-42' })).rejects.toThrow('network');
    consoleOut.expectMessage('RevenueCat login error');
  });
});

describe('syncUserAttributes', () => {
  beforeEach(() => service.configurePurchases());

  it('sets the display name from both name parts', async () => {
    await service.syncUserAttributes({ first_name: 'Ada', last_name: 'Lovelace' });
    expect(rc.setDisplayName).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('treats the literal string "null" as no name', async () => {
    await service.syncUserAttributes({ first_name: 'null', last_name: 'null' });
    expect(rc.setDisplayName).not.toHaveBeenCalled();
  });

  it('skips the email when there is none', async () => {
    await service.syncUserAttributes({ first_name: 'Ada' });
    expect(rc.setEmail).not.toHaveBeenCalled();
  });

  it('swallows failures rather than failing the login that called it', async () => {
    rc.setEmail.mockRejectedValue(new Error('nope'));

    await expect(service.syncUserAttributes({ email: 'a@b.com' })).resolves.toBeUndefined();
    consoleOut.expectMessage('RevenueCat sync attributes error');
  });
});

describe('logoutFromPurchases', () => {
  beforeEach(() => service.configurePurchases());

  it('logs out an identified user', async () => {
    rc.isAnonymous.mockResolvedValue(false);

    await service.logoutFromPurchases();

    expect(rc.logOut).toHaveBeenCalled();
  });

  // RevenueCat is configured once per process; switching users is logIn and
  // logOut. Resetting the flag here used to reconfigure the SDK on the next
  // sign-in.
  it('keeps the SDK configured, so the next sign-in does not reconfigure it', async () => {
    rc.isAnonymous.mockResolvedValue(false);

    await service.logoutFromPurchases();
    await service.configurePurchases('next-user');

    expect(rc.configure).toHaveBeenCalledTimes(1);
  });

  // Logging out an anonymous user is an error in the SDK, not a no-op.
  it('does nothing for an anonymous user', async () => {
    rc.isAnonymous.mockResolvedValue(true);

    await expect(service.logoutFromPurchases()).resolves.toBeNull();
    expect(rc.logOut).not.toHaveBeenCalled();
  });
});

describe('offerings and customer info', () => {
  beforeEach(() => service.configurePurchases());

  it('returns the current offering', async () => {
    const current = { identifier: 'default', availablePackages: [] };
    rc.getOfferings.mockResolvedValue({ current, all: {} } as never);

    await expect(service.getOfferings()).resolves.toBe(current);
  });

  it('returns null, with a dev hint, when RevenueCat has no current offering', async () => {
    await expect(service.getOfferings()).resolves.toBeNull();
    consoleOut.expectMessage('No current offering');
  });

  it('returns null rather than throwing when offerings fail', async () => {
    rc.getOfferings.mockRejectedValue(new Error('offline'));

    await expect(service.getOfferings()).resolves.toBeNull();
    consoleOut.expectMessage('getOfferings error');
  });

  it('returns null rather than throwing when customer info fails', async () => {
    rc.getCustomerInfo.mockRejectedValue(new Error('offline'));

    await expect(service.getCustomerInfo()).resolves.toBeNull();
    consoleOut.expectMessage('getCustomerInfo error');
  });

  it('returns an empty map when trial eligibility fails', async () => {
    rc.checkTrialOrIntroductoryPriceEligibility.mockRejectedValue(new Error('offline'));

    await expect(service.checkTrialEligibility(['premium'])).resolves.toEqual({});
    consoleOut.expectMessage('checkTrialEligibility error');
  });
});

describe('syncAndRefresh', () => {
  beforeEach(() => service.configurePurchases());

  // Silent recovery must not raise the store's sign-in prompt, which is what
  // `restorePurchases` can do on iOS.
  it('syncs receipts and re-reads fresh customer info, without restoring', async () => {
    const fresh = customerInfo({ activeSubscriptions: ['premium'] });
    rc.getCustomerInfo.mockResolvedValue(fresh);

    await expect(service.syncAndRefresh()).resolves.toBe(fresh);
    expect(rc.restorePurchases).not.toHaveBeenCalled();
    expect(
      ranBefore(rc.syncPurchases as jest.Mock, rc.invalidateCustomerInfoCache as jest.Mock),
    ).toBe(true);
  });

  it('returns null when the sync fails', async () => {
    (rc.syncPurchases as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(service.syncAndRefresh()).resolves.toBeNull();
    consoleOut.expectMessage('syncPurchases error');
  });
});

describe('purchasePackage', () => {
  const pkg = { identifier: 'monthly', product: { identifier: 'premium' } } as never;

  it('returns the customer info from a completed purchase', async () => {
    const info = customerInfo();
    rc.purchasePackage.mockResolvedValue({ customerInfo: info } as never);

    await expect(service.purchasePackage(pkg)).resolves.toBe(info);
  });

  it('passes the plan-change info as the third argument', async () => {
    rc.purchasePackage.mockResolvedValue({ customerInfo: customerInfo() } as never);
    const change = { oldProductIdentifier: 'premium', replacementMode: 'DEFERRED' } as never;

    await service.purchasePackage(pkg, change);

    expect(rc.purchasePackage).toHaveBeenCalledWith(pkg, null, change);
  });

  it('rethrows the SDK error untouched so the caller can read its code', async () => {
    const error = { code: '20', message: 'pending' };
    rc.purchasePackage.mockRejectedValue(error);

    await expect(service.purchasePackage(pkg)).rejects.toBe(error);
  });
});

describe('ensureIdentifiedUser', () => {
  beforeEach(() => service.configurePurchases());

  it('re-identifies when the SDK is on a different user', async () => {
    rc.getAppUserID.mockResolvedValue('someone-else');

    await expect(service.ensureIdentifiedUser('user-42')).resolves.toBe(true);
    expect(rc.logIn).toHaveBeenCalledWith('user-42');
  });

  it('does nothing when the identity already matches', async () => {
    await expect(service.ensureIdentifiedUser('user-42')).resolves.toBe(false);
    expect(rc.logIn).not.toHaveBeenCalled();
  });

  // `originalAppUserId` stays the anonymous id for anyone who used the app
  // before signing in. Comparing against it re-ran logIn before every purchase.
  it('compares against the current app user id, not the original anonymous one', async () => {
    rc.getCustomerInfo.mockResolvedValue(customerInfo({ originalAppUserId: '$RCAnonymousID:x' }));

    await expect(service.ensureIdentifiedUser('user-42')).resolves.toBe(false);
    expect(rc.logIn).not.toHaveBeenCalled();
  });

  it('reports false rather than throwing when the SDK errors', async () => {
    rc.getAppUserID.mockRejectedValue(new Error('offline'));

    await expect(service.ensureIdentifiedUser('user-42')).resolves.toBe(false);
    consoleOut.expectMessage('ensureIdentifiedUser error');
  });
});
