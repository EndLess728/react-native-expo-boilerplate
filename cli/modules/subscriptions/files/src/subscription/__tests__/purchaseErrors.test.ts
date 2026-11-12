import { PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { initI18n } from '@/localization/i18n';

import {
  describePurchaseError,
  LINKED_ELSEWHERE_CODES,
  storeNameForPlatform,
} from '../purchaseErrors';

beforeAll(async () => {
  // Real English copy, so the assertions read like what users see.
  await initI18n();
});

describe('describePurchaseError', () => {
  it('treats a cancellation as a non-event with no message', () => {
    expect(describePurchaseError(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, 'ios')).toEqual({
      kind: 'cancelled',
    });
  });

  // A second tap while the store sheet is up is not an error either.
  it('treats an operation already in progress as a non-event', () => {
    expect(
      describePurchaseError(PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR, 'ios'),
    ).toEqual({ kind: 'inProgress' });
  });

  // A pending payment has not failed. Android cash and slow-card methods settle
  // days later; showing an error here is what makes people buy twice.
  it('classifies a pending payment as pending, not an error', () => {
    const outcome = describePurchaseError(PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR, 'android');

    expect(outcome.kind).toBe('pending');
    expect(outcome).toHaveProperty('message', expect.stringContaining('being processed'));
  });

  it.each([
    PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    PURCHASES_ERROR_CODE.NETWORK_ERROR,
    PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR,
    PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR,
  ])('marks %s retryable', (code) => {
    expect(describePurchaseError(code, 'ios').kind).toBe('retryable');
  });

  it('names the platform store in the retryable message', () => {
    expect(describePurchaseError(PURCHASES_ERROR_CODE.NETWORK_ERROR, 'android')).toHaveProperty(
      'message',
      "Couldn't reach Google Play. Check your connection and try again.",
    );
  });

  // Retrying a device restriction or an unavailable region can never work, so
  // these must not be classified as retryable.
  it.each([
    PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR,
    PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR,
    PURCHASES_ERROR_CODE.INELIGIBLE_ERROR,
  ])('marks %s blocked rather than retryable', (code) => {
    expect(describePurchaseError(code, 'ios').kind).toBe('blocked');
  });

  it.each(LINKED_ELSEWHERE_CODES)('reports %s as linked to another account', (code) => {
    expect(describePurchaseError(code, 'ios')).toEqual({ kind: 'linkedElsewhere' });
  });

  it('sends an already-owned product to silent recovery', () => {
    expect(
      describePurchaseError(PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR, 'ios'),
    ).toEqual({ kind: 'alreadyOwned' });
  });

  // An invalid purchase is not an ownership conflict; running account recovery
  // on it re-aliases identities for nothing.
  it('does not treat an invalid purchase as a conflict', () => {
    expect(describePurchaseError(PURCHASES_ERROR_CODE.PURCHASE_INVALID_ERROR, 'ios')).toEqual({
      kind: 'unknown',
    });
  });

  // A wrong explanation is worse than the caller logging the real code.
  it.each([
    PURCHASES_ERROR_CODE.UNKNOWN_ERROR,
    PURCHASES_ERROR_CODE.CONFIGURATION_ERROR,
    undefined,
  ])('leaves %s unknown instead of inventing a message', (code) => {
    expect(describePurchaseError(code, 'ios')).toEqual({ kind: 'unknown' });
  });

  it('never returns a blank message alongside a message-bearing kind', () => {
    for (const code of Object.values(PURCHASES_ERROR_CODE)) {
      const outcome = describePurchaseError(code, 'ios');
      if (
        outcome.kind === 'pending' ||
        outcome.kind === 'retryable' ||
        outcome.kind === 'blocked'
      ) {
        expect(outcome.message.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('storeNameForPlatform', () => {
  it('names each store', () => {
    expect(storeNameForPlatform('android')).toBe('Google Play');
    expect(storeNameForPlatform('ios')).toBe('the App Store');
  });
});
