/**
 * subscription/components/SubscriptionStatusNotice.tsx
 *
 * One banner explaining where the subscription stands — grace period, account
 * hold, paused, cancelled-but-active, trial, family-shared, promotional,
 * lifetime, active — with the one action that applies. Which state wins is
 * decided in `statusNotice.ts`; this only renders it.
 *
 * Usable on any screen: reads everything from `useSubscription()`.
 */

import React, { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { type TxKeyPath, useSelectedLanguage, useTranslate } from '@/localization/utils';
import { ms } from '@/shared/utils';
import { TextStyles, useAppTheme } from '@/theme';

import { openSubscriptionManagement } from '../management';
import {
  formatNoticeDate,
  type NoticeKind,
  type NoticeTone,
  resolveStatusNotice,
} from '../statusNotice';
import type { PlanPeriod } from '../subscriptionState';
import { useSubscriptionContext } from '../SubscriptionProvider';

/** Copy per state; `datedKey` is used when the state carries a date. */
export const NOTICE_COPY: Record<NoticeKind, { key: TxKeyPath; datedKey?: TxKeyPath }> = {
  duplicate: { key: 'subscription.notice_duplicate' },
  grace: { key: 'subscription.notice_grace', datedKey: 'subscription.notice_grace_dated' },
  onHold: { key: 'subscription.notice_on_hold' },
  paused: { key: 'subscription.notice_paused', datedKey: 'subscription.notice_paused_dated' },
  familyShared: { key: 'subscription.notice_family_shared' },
  promotional: {
    key: 'subscription.notice_promotional',
    datedKey: 'subscription.notice_promotional_dated',
  },
  crossStore: { key: 'subscription.notice_cross_store' },
  pendingChange: {
    key: 'subscription.notice_pending_change',
    datedKey: 'subscription.notice_pending_change_dated',
  },
  cancelled: {
    key: 'subscription.notice_cancelled',
    datedKey: 'subscription.notice_cancelled_dated',
  },
  trial: { key: 'subscription.notice_trial', datedKey: 'subscription.notice_trial_dated' },
  lifetime: { key: 'subscription.notice_lifetime' },
  active: { key: 'subscription.notice_active', datedKey: 'subscription.notice_active_dated' },
};

const PLAN_COPY: Record<PlanPeriod, TxKeyPath> = {
  monthly: 'subscription.notice_plan_monthly',
  annual: 'subscription.notice_plan_annual',
};

/** No warning token in the theme; amber reads as "act soon" on light and dark. */
const WARNING = '#E0A100';

interface SubscriptionStatusNoticeProps {
  /** States to leave to another component, e.g. `crossStore` on the paywall. */
  exclude?: NoticeKind[];
}

export default function SubscriptionStatusNotice({
  exclude,
}: SubscriptionStatusNoticeProps): React.JSX.Element | null {
  const t = useTranslate();
  const theme = useAppTheme();
  const { language } = useSelectedLanguage();
  const {
    subscriptionState: state,
    isCrossPlatformSubscription,
    managementURL,
  } = useSubscriptionContext();

  const handleManage = useCallback(
    () => openSubscriptionManagement(managementURL),
    [managementURL],
  );

  const notice = resolveStatusNotice({
    state,
    isCrossPlatformSubscription,
    hasManagementURL: !!managementURL,
  });
  if (!notice || exclude?.includes(notice.kind)) return null;

  const { kind, tone, date, canManage } = notice;
  const { key, datedKey } = NOTICE_COPY[kind];
  const formatted = formatNoticeDate(date, language);
  const message = datedKey && formatted ? t(datedKey, { date: formatted }) : t(key);

  const planKey =
    state.planPeriod && kind !== 'familyShared' && kind !== 'promotional' && kind !== 'lifetime'
      ? PLAN_COPY[state.planPeriod]
      : null;

  const actionLabel =
    kind === 'grace' || kind === 'onHold'
      ? t('subscription.notice_fix_payment')
      : t('subscription.notice_manage');

  const accent: Record<NoticeTone, string> = {
    danger: theme.colors.danger,
    warning: WARNING,
    info: theme.colors.primary,
    success: theme.colors.green,
  };

  return (
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: accent[tone] }]}>
      <Text style={[TextStyles.bodySmall, styles.text]}>{message}</Text>
      {planKey && <Text style={[TextStyles.caption, styles.muted]}>{t(planKey)}</Text>}
      {canManage && (
        <Pressable
          accessibilityRole="button"
          hitSlop={ms(8)}
          style={styles.action}
          onPress={handleManage}
        >
          <Text style={[TextStyles.bodySmallSemiBold, { color: accent[tone] }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  banner: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: ms(12),
    padding: ms(12),
    marginBottom: ms(12),
    gap: ms(6),
    backgroundColor: theme.colors.surface,
  },
  text: {
    color: theme.colors.typography,
  },
  muted: {
    color: theme.colors.typography,
    opacity: 0.7,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: ms(2),
  },
}));
