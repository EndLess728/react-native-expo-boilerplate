import { DEV_ALWAYS_PREMIUM, ENTITLEMENT_ID } from '../config';

describe('subscription config', () => {
  /**
   * The dev override makes `isPremium` unconditionally true. It is additionally
   * `__DEV__`-guarded in the provider, so it cannot reach production even if
   * flipped — but a developer committing it enabled would silently hand every
   * local and CI run free premium, and every paywall test would pass for the
   * wrong reason. Cheap to assert, and it fails loudly in CI.
   */
  it('never ships with the dev premium override enabled', () => {
    expect(DEV_ALWAYS_PREMIUM).toBe(false);
  });

  /**
   * A mismatch with the dashboard does not throw; nobody is ever premium. This
   * at least catches the placeholder surviving generation.
   */
  it('names a real entitlement', () => {
    expect(ENTITLEMENT_ID).not.toMatch(/^__.*__$/);
    expect(ENTITLEMENT_ID.trim()).not.toBe('');
  });
});
