/**
 * subscription/purchaseErrors.ts
 *
 * Maps a RevenueCat purchase error to what the user should be told — pure, no
 * SDK calls, no React.
 *
 * Purchases fail far more often than they succeed, and each failure wants a
 * different response. Before this, everything that was not a cancellation or a
 * receipt conflict hit a bare `throw`, so a pending cash payment, a dropped
 * connection, and a Screen Time restriction all surfaced as the same
 * crash-shaped error — and the two of those three that are recoverable looked
 * like bugs.
 *
 * The distinctions that matter:
 *  • pending    — the purchase has not failed at all and may settle later.
 *                 Android cash / slow-card payments (common in India and
 *                 Brazil) and iOS Ask to Buy land here. The customerInfo
 *                 listener grants the entitlement when it clears, so the only
 *                 job is to stop calling it an error.
 *  • retryable  — transient. Offer the retry.
 *  • blocked    — retrying can never work, so do not invite it.
 *  • alreadyOwned / linkedElsewhere — not failures of the purchase but of
 *                 identity: the store account already owns it, here or on
 *                 another app account.
 */

import { PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { translate } from '@/localization/utils';

export type PurchaseOutcome =
  /** The user dismissed the sheet. Not an error — say nothing. */
  | { kind: 'cancelled' }
  /** Accepted but not settled. Access arrives on its own if it clears. */
  | { kind: 'pending'; message: string }
  /** Transient — the same tap may well work next time. */
  | { kind: 'retryable'; message: string }
  /** Refused for a reason a retry cannot change. */
  | { kind: 'blocked'; message: string }
  /** The store receipt belongs to a different app account. A restore can't fix it. */
  | { kind: 'linkedElsewhere' }
  /** This store account already owns the product — sync and re-check, silently. */
  | { kind: 'alreadyOwned' }
  /** A second tap while a purchase is already running. Nothing to tell the user. */
  | { kind: 'inProgress' }
  /** Not recognised; the caller should rethrow rather than invent a message. */
  | { kind: 'unknown' };

/** Codes meaning the receipt is attached to a different RevenueCat profile. */
export const LINKED_ELSEWHERE_CODES: readonly PURCHASES_ERROR_CODE[] = [
  PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR,
  PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR,
];

/**
 * Classify a purchase error code. Messages come back translated.
 *
 * `unknown` is returned rather than a catch-all message on purpose: a wrong
 * explanation is worse than the caller rethrowing and logging the real code.
 *
 * `PURCHASE_INVALID_ERROR` is deliberately NOT treated as an ownership conflict:
 * it means the purchase parameters were invalid, and running account recovery
 * on it (logIn + restore) re-aliases identities for no reason.
 */
export function describePurchaseError(
  code: PURCHASES_ERROR_CODE | string | undefined,
  os: string,
): PurchaseOutcome {
  switch (code) {
    case PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR:
      return { kind: 'cancelled' };

    case PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR:
      return { kind: 'inProgress' };

    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      // Android cash / slow-card methods and iOS Ask to Buy settle later; the
      // customer-info listener grants access when they do.
      return { kind: 'pending', message: translate('subscription.error_pending') };

    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
    case PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR:
      return {
        kind: 'retryable',
        message: translate('subscription.error_store_unreachable', {
          store: storeNameForPlatform(os),
        }),
      };

    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      // Screen Time restrictions on iOS, MDM or a supervised child account on
      // Android. Nothing the app can do, and retrying will not help.
      return { kind: 'blocked', message: translate('subscription.error_not_allowed') };

    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return { kind: 'blocked', message: translate('subscription.error_not_available') };

    case PURCHASES_ERROR_CODE.INELIGIBLE_ERROR:
      return { kind: 'blocked', message: translate('subscription.error_ineligible') };

    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return { kind: 'alreadyOwned' };

    default:
      if (code !== undefined && LINKED_ELSEWHERE_CODES.includes(code as PURCHASES_ERROR_CODE)) {
        return { kind: 'linkedElsewhere' };
      }
      return { kind: 'unknown' };
  }
}

/** "the App Store" / "the Play Store", translated. */
export const storeNameForPlatform = (os: string): string =>
  translate(os === 'android' ? 'subscription.store_play' : 'subscription.store_app');

/**
 * The store account that owns a subscription, named as the user knows it
 * ("Apple ID", "Google Play account") — the account billed, not the storefront.
 */
export const storeAccountForPlatform = (os: string): string =>
  translate(os === 'android' ? 'subscription.account_play' : 'subscription.account_apple');

/**
 * Why a plan change was refused when the app account and the store account
 * disagree.
 *
 * One app login can be used on two devices signed into two different store
 * accounts. The subscription belongs to whichever store account paid for it, and
 * only that account can change it — the store will not let a second one replace
 * a subscription it does not own. The app cannot fix this for the user, so the
 * message names the cause and the one place the change can actually be made,
 * rather than inviting a retry that will fail identically.
 */
export const planChangeBlockedMessage = (os: string): string =>
  translate('subscription.plan_change_blocked_body', {
    account: storeAccountForPlatform(os),
    store: storeNameForPlatform(os),
  });
