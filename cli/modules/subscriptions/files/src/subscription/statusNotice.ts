/**
 * subscription/statusNotice.ts
 *
 * Decides which ONE thing to tell the user about their subscription — pure, no
 * React, no SDK calls.
 *
 * `subscriptionState` can report several things at once: a family-shared
 * subscription can also be in a grace period, a cancelled one can also be
 * cross-store. Rendering every applicable banner produces a wall of notices and
 * buries the one that matters, so this picks a single winner by severity.
 *
 * The order is about what the user can do next, not about what is most unusual:
 *
 *   1. duplicate    — being billed twice. Costs real money, needs a human.
 *   2. grace        — payment failed, access still on. The one moment where a tap
 *                     saves the subscription; a few days later it is gone.
 *   3. onHold       — payment failed and access is gone, but the subscription is
 *                     not: the card can still be fixed. Ranks here because the
 *                     alternative is a full paywall, and a user who buys from it
 *                     ends up paying twice.
 *   4. paused       — access is off but returns by itself. Must not read as churn.
 *   5. familyShared — fully entitled, cannot manage. Offering controls dead-end.
 *   6. promotional  — comped access, no store subscription to manage.
 *   7. crossStore   — active, but only manageable on the other platform.
 *   8. pendingChange— a plan change already made, taking effect later. Says so
 *                     before the paywall can imply it failed.
 *   9. cancelled    — still paid up, and re-subscribing is allowed. Recoverable.
 *  10. trial        — say when the charge lands, before it lands.
 *  11. active       — the ordinary confirmation.
 *
 * Anything above `cancelled` outranks it deliberately: telling someone their
 * card failed matters more than telling them when their plan ends.
 */

import type { SubscriptionState } from './subscriptionState';

export type NoticeKind =
  | 'duplicate'
  | 'grace'
  | 'onHold'
  | 'paused'
  | 'familyShared'
  | 'promotional'
  | 'crossStore'
  | 'pendingChange'
  | 'cancelled'
  | 'trial'
  | 'lifetime'
  | 'active';

/** How the banner should read — drives colour, not wording. */
export type NoticeTone = 'danger' | 'warning' | 'info' | 'success';

export interface StatusNotice {
  kind: NoticeKind;
  tone: NoticeTone;
  /** ISO date the copy refers to, when the message has one. */
  date: string | null;
  /**
   * True when the user can usefully be sent to the store's subscription
   * settings. False for family-shared and promotional access, where the store
   * page shows nothing they can change.
   */
  canManage: boolean;
}

const TONES: Record<NoticeKind, NoticeTone> = {
  duplicate: 'danger',
  grace: 'danger',
  onHold: 'danger',
  paused: 'warning',
  familyShared: 'info',
  promotional: 'info',
  crossStore: 'warning',
  pendingChange: 'info',
  cancelled: 'warning',
  trial: 'info',
  lifetime: 'success',
  active: 'success',
};

export interface StatusNoticeInput {
  state: SubscriptionState;
  /** From the provider — the active subscription belongs to the other store. */
  isCrossPlatformSubscription: boolean;
  /** Whether RevenueCat gave us a management URL to open at all. */
  hasManagementURL: boolean;
}

/**
 * The single notice to render, or null when there is nothing worth saying —
 * which is the common case for a user who has never subscribed.
 */
export function resolveStatusNotice({
  state,
  isCrossPlatformSubscription,
  hasManagementURL,
}: StatusNoticeInput): StatusNotice | null {
  const notice = (kind: NoticeKind, date: string | null, canManage: boolean): StatusNotice => ({
    kind,
    tone: TONES[kind],
    date,
    canManage: canManage && hasManagementURL,
  });

  if (state.hasMultipleActiveSubscriptions) return notice('duplicate', null, true);
  if (state.inGracePeriod) return notice('grace', state.gracePeriodExpiresAt, true);

  // Deliberately above the `!state.isActive` return below: an account hold is
  // precisely the case where the entitlement is gone and saying nothing would
  // leave a full paywall as the whole answer. No date — neither store reports
  // when the hold runs out, and inventing a deadline is worse than omitting one.
  if (state.isOnHold) return notice('onHold', null, true);

  if (state.isPaused) return notice('paused', state.resumesAt, true);

  // Entitled through someone else's purchase, or comped from the RevenueCat
  // dashboard. Both are real access with nothing to manage and nothing to sell.
  if (state.isFamilyShared) return notice('familyShared', null, false);
  if (state.store === 'PROMOTIONAL') return notice('promotional', state.expiresAt, false);

  if (isCrossPlatformSubscription) return notice('crossStore', null, true);

  if (!state.isActive) return null;

  // Before `cancelled` and `active`: both would describe the plan the user has
  // just switched away from, which is exactly the reading — "nothing happened" —
  // that sends them back to change it a second time.
  if (state.pendingPlanType) return notice('pendingChange', state.expiresAt, true);

  // Nothing renews and nothing can be managed in the store.
  if (state.isLifetime) return notice('lifetime', null, false);

  if (state.isCancelled) return notice('cancelled', state.expiresAt, true);
  if (state.isInTrial) return notice('trial', state.trialEndsAt, true);
  return notice('active', state.expiresAt, true);
}

/**
 * Whether buying or switching plans should be offered at all.
 *
 * Family-shared and promotional access cannot be changed by a purchase, and a
 * subscription owned by the other store cannot be replaced from this device —
 * attempting it is what starts a second, concurrently billed subscription.
 */
export function canPurchase({
  state,
  isCrossPlatformSubscription,
}: Pick<StatusNoticeInput, 'state' | 'isCrossPlatformSubscription'>): boolean {
  return !state.isFamilyShared && state.store !== 'PROMOTIONAL' && !isCrossPlatformSubscription;
}

/**
 * A short absolute date and time ("17 Sep 2026, 4:31 pm"). Empty string for a
 * missing or unparseable value, so callers can fall back to date-free copy
 * rather than rendering "Invalid Date" at a user.
 *
 * The time is part of the answer, not a debug detail. Every date this formats is
 * a deadline the user acts on — when the card must be fixed, when access ends,
 * when the trial converts, when the next charge lands — and all of them fall at
 * a specific moment, not at midnight. "Update it before 19 Sep" is ambiguous on
 * the 19th; "before 19 Sep, 4:31 pm" is not. It also makes sandbox and Play test
 * subscriptions legible, where a renewal is minutes rather than months away and
 * a bare date makes every state read as "today".
 *
 * Minute precision, not seconds: enough to order events even on a 5-minute test
 * renewal, without reading like a log line in the release build.
 */
export function formatNoticeDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';

  const value = new Date(time);

  try {
    return value.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    // Intl can be absent or reject an odd locale tag on older Hermes builds.
    const isoText = value.toISOString();
    return `${isoText.slice(0, 10)} ${isoText.slice(11, 16)} UTC`;
  }
}
