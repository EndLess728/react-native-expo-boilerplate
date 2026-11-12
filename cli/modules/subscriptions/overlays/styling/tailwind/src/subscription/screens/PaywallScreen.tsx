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
import { useAppTheme } from '@/theme';

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
  const handlePress = useCallback(() => onSelect(plan.id), [onSelect, plan.id]);
  const activeLabel = t('subscription.plan_active_badge');

  return (
    <Pressable
      accessibilityLabel={`${plan.title}, ${plan.price}${plan.pricePeriod}${
        isActivePlan ? `, ${activeLabel}` : ''
      }`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`flex-row items-center rounded-xl bg-surface p-4 ${
        selected ? 'border-2 border-primary' : 'border border-border-gray'
      }`}
      onPress={handlePress}
    >
      {plan.popular && (
        <View className="absolute -top-2.5 right-4 rounded-lg bg-primary px-2 py-0.5">
          <Text className="text-caption font-opensans-bold text-on-primary">
            {t('subscription.most_popular')}
          </Text>
        </View>
      )}
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-body font-opensans-semibold text-typography">{plan.title}</Text>
          {isActivePlan && (
            <View className="rounded-md bg-green px-1.5 py-px">
              <Text className="text-caption font-opensans-bold text-on-primary">{activeLabel}</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-baseline gap-1">
          <Text
            className={`text-h2 font-opensans-bold ${selected ? 'text-primary' : 'text-typography'}`}
          >
            {plan.price}
          </Text>
          {!!plan.pricePeriod && (
            <Text className="text-body-sm font-opensans text-typography opacity-70">
              {plan.pricePeriod}
            </Text>
          )}
        </View>
      </View>
      {!!plan.badge && (
        <View className="items-end">
          <Text className="text-body-sm font-opensans-semibold text-primary">{plan.badge}</Text>
          {!!plan.subtitle && (
            <Text className="text-caption font-opensans text-typography opacity-70">
              {plan.subtitle}
            </Text>
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
    <ScreenWrapper scrollable className="px-5 pb-8">
      <View
        className="mb-6 flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          accessibilityLabel={t('subscription.back')}
          accessibilityRole="button"
          hitSlop={10}
          onPress={closePaywall}
        >
          <Ionicons color={theme.colors.typography} name="arrow-back" size={24} />
        </Pressable>
        <Text className="text-h3 font-opensans-bold text-typography">
          {t('subscription.title')}
        </Text>
        <View className="w-6" />
      </View>

      <SubscriptionStatusNotice exclude={CROSS_STORE_ONLY} />

      {offeringsUnavailable && (
        <View className="mb-3 gap-1.5 rounded-xl border border-danger p-3">
          <Text className="text-body font-opensans-semibold text-typography">
            {t('subscription.offerings_error_title')}
          </Text>
          <Text className="text-body-sm font-opensans text-typography opacity-70">
            {t('subscription.offerings_error_body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            hitSlop={8}
            onPress={reloadOfferings}
          >
            <Text className="text-body-sm font-opensans-semibold text-danger">
              {t('subscription.offerings_error_retry')}
            </Text>
          </Pressable>
        </View>
      )}

      <View accessibilityRole="radiogroup" className="mt-2 gap-3.5">
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

      <View className="my-6 gap-3">
        {features.map((feature) => (
          <View key={feature} className="flex-row items-center gap-2.5">
            <Ionicons color={theme.colors.primary} name="checkmark-circle" size={18} />
            <Text className="flex-1 text-body-sm font-opensans-semibold text-typography">
              {feature}
            </Text>
          </View>
        ))}
      </View>

      <Button
        className="mb-0"
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
        className={`mt-4 flex-row items-center justify-center gap-2 py-2 ${
          isPurchasing || isLoading ? 'opacity-50' : ''
        }`}
        disabled={isPurchasing || isLoading}
        hitSlop={8}
        onPress={handleRestore}
      >
        {isRestoring && <ActivityIndicator color={theme.colors.typography} size="small" />}
        <Text className="text-body-sm font-opensans-semibold text-typography">
          {t('subscription.restore_purchases')}
        </Text>
      </Pressable>

      {/* Both stores require the renewal terms and these two links on a paywall. */}
      <Text className="mt-3 text-center text-caption font-opensans text-typography opacity-60">
        {t('subscription.legal_disclaimer')}
      </Text>
      <Text className="mt-3 text-center text-caption font-opensans text-typography opacity-60">
        <Text
          accessibilityRole="link"
          className="underline"
          onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}
        >
          {t('subscription.legal_terms')}
        </Text>
        {` ${t('subscription.legal_and')} `}
        <Text
          accessibilityRole="link"
          className="underline"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        >
          {t('subscription.legal_privacy')}
        </Text>
      </Text>
    </ScreenWrapper>
  );
}
