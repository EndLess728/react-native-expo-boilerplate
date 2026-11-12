/**
 * subscription/screens/PaywallScreen.tsx
 *
 * The full paywall: every package in the current RevenueCat offering, the
 * offering's feature list, purchase / switch / resubscribe / manage, restore,
 * and the legal footer both stores require.
 *
 * Opened by the gate sheet's CTA or `openPaywall()` (see `navigation.ts`).
 * Everything it knows comes from `useSubscription()`; the decisions —
 * which plans to list, which banner wins, whether purchasing is safe — live in
 * the pure modules next to it, so this file is layout.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@react-native-vector-icons/ionicons';

import { useSelectedLanguage, useTranslate } from '@/localization/utils';
import Button from '@/shared/components/Button';
import ScreenWrapper from '@/shared/components/ScreenWrapper';
import { ms } from '@/shared/utils';
import { makeStyles, TextStyles, useAppTheme } from '@/theme';

import CrossPlatformNotice from '../components/CrossPlatformNotice';
import SubscriptionStatusNotice from '../components/SubscriptionStatusNotice';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { openSubscriptionManagement } from '../management';
import { closePaywall } from '../navigation';
import {
  buildPaywallPlans,
  FREE_PLAN_ID,
  type PaywallPlan,
  resolveFeatures,
} from '../offeringContent';
import { canPurchase, type NoticeKind } from '../statusNotice';
import { findActivePackage } from '../subscriptionState';
import { useSubscriptionContext } from '../SubscriptionProvider';

/** Shown under the CTA instead, beside the button it explains. */
const CROSS_STORE_ONLY: NoticeKind[] = ['crossStore'];

interface PlanCardProps {
  plan: PaywallPlan;
  selected: boolean;
  isActivePlan: boolean;
  onSelect: (id: string) => void;
}

const PlanCard = React.memo(function PlanCard({
  plan,
  selected,
  isActivePlan,
  onSelect,
}: PlanCardProps) {
  const t = useTranslate();
  const styles = useStyles();
  const handlePress = useCallback(() => onSelect(plan.id), [onSelect, plan.id]);
  const activeLabel = t('subscription.plan_active_badge');

  return (
    <Pressable
      accessibilityLabel={`${plan.title}, ${plan.price}${plan.pricePeriod}${
        isActivePlan ? `, ${activeLabel}` : ''
      }`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.cardSelected]}
      onPress={handlePress}
    >
      {plan.popular && (
        <View style={styles.popularBadge}>
          <Text style={[TextStyles.overline, styles.onPrimary]}>
            {t('subscription.most_popular')}
          </Text>
        </View>
      )}
      <View style={styles.cardLeft}>
        <View style={styles.cardTitleRow}>
          <Text style={[TextStyles.bodySemiBold, styles.text]}>{plan.title}</Text>
          {isActivePlan && (
            <View style={styles.activeBadge}>
              <Text style={[TextStyles.overline, styles.onPrimary]}>{activeLabel}</Text>
            </View>
          )}
        </View>
        <View style={styles.priceRow}>
          <Text style={[TextStyles.h2, selected ? styles.primary : styles.text]}>{plan.price}</Text>
          {!!plan.pricePeriod && (
            <Text style={[TextStyles.bodySmall, styles.muted]}>{plan.pricePeriod}</Text>
          )}
        </View>
      </View>
      {!!plan.badge && (
        <View style={styles.cardRight}>
          <Text style={[TextStyles.bodySmallSemiBold, styles.primary]}>{plan.badge}</Text>
          {!!plan.subtitle && (
            <Text style={[TextStyles.caption, styles.muted]}>{plan.subtitle}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
});

export function PaywallScreen(): React.JSX.Element {
  // Full-screen with no navigator header, so it owns the status-bar inset.
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const styles = useStyles();
  const t = useTranslate();
  const { language } = useSelectedLanguage();

  const {
    offerings,
    availablePackages,
    isPurchasing,
    isLoading,
    purchase,
    restore,
    reloadOfferings,
    getPackagePrice,
    getTrialText,
    isPremium,
    isCrossPlatformSubscription,
    managementURL,
    customerInfo,
    subscriptionState,
  } = useSubscriptionContext();

  const purchasingAllowed = canPurchase({ state: subscriptionState, isCrossPlatformSubscription });
  const offeringsUnavailable = !isLoading && availablePackages.length === 0;

  const plans = useMemo(
    () =>
      buildPaywallPlans({
        packages: availablePackages,
        metadata: offerings?.metadata,
        locale: language,
        t,
        getPackagePrice,
        getTrialText,
        isPremium,
      }),
    [availablePackages, offerings?.metadata, language, t, getPackagePrice, getTrialText, isPremium],
  );

  const features = useMemo(
    () =>
      resolveFeatures({
        metadata: offerings?.metadata,
        locale: language,
        fallback: [
          t('subscription.feature_fallback_1'),
          t('subscription.feature_fallback_2'),
          t('subscription.feature_fallback_3'),
        ],
      }),
    [offerings?.metadata, language, t],
  );

  // The plan the user is on, matched by store identifier (Android base plans
  // need recombining — see `activeProductIdentifiers`).
  const activePlanId = useMemo(
    () => findActivePackage(customerInfo, availablePackages)?.identifier ?? null,
    [customerInfo, availablePackages],
  );

  const defaultPlanId =
    activePlanId ?? (isPremium && plans.length > 0 ? plans[0].id : FREE_PLAN_ID);
  const [planOverride, setPlanOverride] = useState<string | null>(null);
  const selectedPlan = planOverride ?? defaultPlanId;

  // A lifetime purchase has nothing to buy, switch or resubscribe to.
  const isSelectedPlanActive =
    subscriptionState.isLifetime ||
    (selectedPlan !== FREE_PLAN_ID &&
      selectedPlan === activePlanId &&
      !subscriptionState.isCancelled);

  const isResubscribing =
    subscriptionState.isCancelled && selectedPlan !== FREE_PLAN_ID && selectedPlan === activePlanId;

  const handleContinue = useCallback(async () => {
    if (selectedPlan === FREE_PLAN_ID) {
      closePaywall();
      return;
    }
    if (!purchasingAllowed) {
      await openSubscriptionManagement(managementURL);
      return;
    }
    if (isSelectedPlanActive) return;

    const pkg = plans.find((plan) => plan.id === selectedPlan)?.pkg;
    if (!pkg) return;

    if (await purchase(pkg)) closePaywall();
  }, [selectedPlan, plans, purchase, purchasingAllowed, managementURL, isSelectedPlanActive]);

  // Restoring talks to the store and can take seconds, so it has its own
  // spinner rather than borrowing the screen-wide loading flag.
  const [isRestoring, setIsRestoring] = useState(false);
  const handleRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      await restore();
    } finally {
      setIsRestoring(false);
    }
  }, [restore]);

  const ctaLabel = useMemo(() => {
    if (!purchasingAllowed) return t('subscription.cta_manage');
    if (isSelectedPlanActive) return t('subscription.cta_already_active');
    if (isResubscribing) return t('subscription.cta_resubscribe');
    if (selectedPlan === FREE_PLAN_ID) return t('subscription.cta_free');

    const planName = plans.find((plan) => plan.id === selectedPlan)?.title ?? '';
    return isPremium && activePlanId && selectedPlan !== activePlanId
      ? t('subscription.cta_switch', { plan: planName })
      : t('subscription.cta_continue', { plan: planName });
  }, [
    selectedPlan,
    plans,
    t,
    purchasingAllowed,
    isSelectedPlanActive,
    isResubscribing,
    isPremium,
    activePlanId,
  ]);

  const isCtaConfirmation = isSelectedPlanActive && purchasingAllowed;
  const isActionDisabled =
    isPurchasing ||
    isLoading ||
    isCtaConfirmation ||
    (offeringsUnavailable && selectedPlan !== FREE_PLAN_ID && purchasingAllowed);

  return (
    <ScreenWrapper scrollable style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + ms(8) }]}>
        <Pressable
          accessibilityLabel={t('subscription.back')}
          accessibilityRole="button"
          hitSlop={ms(10)}
          onPress={closePaywall}
        >
          <Ionicons color={theme.colors.typography} name="arrow-back" size={ms(24)} />
        </Pressable>
        <Text style={[TextStyles.h3, styles.text]}>{t('subscription.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <SubscriptionStatusNotice exclude={CROSS_STORE_ONLY} />

      {offeringsUnavailable && (
        <View style={styles.errorBanner}>
          <Text style={[TextStyles.bodySemiBold, styles.text]}>
            {t('subscription.offerings_error_title')}
          </Text>
          <Text style={[TextStyles.bodySmall, styles.muted]}>
            {t('subscription.offerings_error_body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            hitSlop={ms(8)}
            onPress={reloadOfferings}
          >
            <Text style={[TextStyles.bodySmallSemiBold, styles.danger]}>
              {t('subscription.offerings_error_retry')}
            </Text>
          </Pressable>
        </View>
      )}

      <View accessibilityRole="radiogroup" style={styles.planList}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            isActivePlan={plan.id === activePlanId}
            plan={plan}
            selected={selectedPlan === plan.id}
            onSelect={setPlanOverride}
          />
        ))}
      </View>

      <View style={styles.features}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons color={theme.colors.primary} name="checkmark-circle" size={ms(18)} />
            <Text style={[TextStyles.bodySmallSemiBold, styles.featureText]}>{feature}</Text>
          </View>
        ))}
      </View>

      <Button
        disabled={isActionDisabled}
        isLoading={isPurchasing}
        title={ctaLabel}
        type={isCtaConfirmation ? 'secondary' : 'primary'}
        onPress={handleContinue}
      />

      <CrossPlatformNotice />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: isRestoring, disabled: isPurchasing || isLoading }}
        disabled={isPurchasing || isLoading}
        hitSlop={ms(8)}
        style={[styles.restore, (isPurchasing || isLoading) && styles.disabled]}
        onPress={handleRestore}
      >
        {isRestoring && <ActivityIndicator color={theme.colors.typography} size="small" />}
        <Text style={[TextStyles.bodySmallSemiBold, styles.text]}>
          {t('subscription.restore_purchases')}
        </Text>
      </Pressable>

      {/* Both stores require the renewal terms and these two links on a paywall. */}
      <Text style={[TextStyles.caption, styles.legal]}>{t('subscription.legal_disclaimer')}</Text>
      <Text style={[TextStyles.caption, styles.legal]}>
        <Text
          accessibilityRole="link"
          style={styles.link}
          onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}
        >
          {t('subscription.legal_terms')}
        </Text>
        {` ${t('subscription.legal_and')} `}
        <Text
          accessibilityRole="link"
          style={styles.link}
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        >
          {t('subscription.legal_privacy')}
        </Text>
      </Text>
    </ScreenWrapper>
  );
}

const useStyles = makeStyles((theme) => ({
  container: {
    paddingHorizontal: ms(20),
    paddingBottom: ms(32),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: ms(24),
  },
  headerSpacer: {
    width: ms(24),
  },
  text: {
    color: theme.colors.typography,
  },
  muted: {
    color: theme.colors.typography,
    opacity: 0.7,
  },
  primary: {
    color: theme.colors.primary,
  },
  danger: {
    color: theme.colors.danger,
  },
  onPrimary: {
    color: theme.colors.onPrimary,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: ms(12),
    padding: ms(12),
    gap: ms(6),
    marginBottom: ms(12),
  },
  planList: {
    gap: ms(14),
    marginTop: ms(8),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ms(16),
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: theme.colors.borderGray,
    backgroundColor: theme.colors.surface,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  popularBadge: {
    position: 'absolute',
    top: -ms(10),
    right: ms(16),
    paddingHorizontal: ms(8),
    paddingVertical: ms(2),
    borderRadius: ms(8),
    backgroundColor: theme.colors.primary,
  },
  cardLeft: {
    flex: 1,
    gap: ms(4),
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ms(8),
  },
  activeBadge: {
    paddingHorizontal: ms(6),
    paddingVertical: ms(1),
    borderRadius: ms(6),
    backgroundColor: theme.colors.green,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: ms(4),
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  features: {
    gap: ms(12),
    marginVertical: ms(24),
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ms(10),
  },
  featureText: {
    flex: 1,
    color: theme.colors.typography,
  },
  restore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ms(8),
    marginTop: ms(16),
    paddingVertical: ms(8),
  },
  disabled: {
    opacity: 0.5,
  },
  legal: {
    color: theme.colors.typography,
    opacity: 0.6,
    textAlign: 'center',
    marginTop: ms(12),
  },
  link: {
    textDecorationLine: 'underline',
  },
}));
