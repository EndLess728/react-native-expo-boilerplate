/**
 * subscription/components/UnlockModal.tsx
 *
 * The premium gate — the bottom sheet shown when a non-premium account tries
 * something Premium owns. Raised by `requirePremium`, and by nothing else:
 * `SubscriptionProvider` renders exactly one, so this IS the upsell everywhere.
 *
 * A real `@gorhom/bottom-sheet` sheet rather than an RN `<Modal>`: the drag
 * tracks the finger through release, the backdrop fades with the gesture, and
 * Android's back button closes it. It needs `<BottomSheetModalProvider>` above
 * it, which `AppProviders` mounts.
 *
 * What it says:
 *  • title / description — from the gate, via `PremiumGateCopy`: a user stopped
 *    on one feature is answering a different question from one stopped on
 *    another. Omitted, a generic translated pair.
 *  • the bullets — the RevenueCat offering's `metadata.features`, the same list
 *    the paywall screen reads, so the two can't describe different products.
 *    Falls back to translated copy.
 *  • the CTA opens the paywall; it does not buy. Choosing a plan, reading the
 *    price and renewal terms, and restoring belong on that screen — and neither
 *    store would pass a one-tap purchase from a sheet that shows no price.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';

import { useSelectedLanguage, useTranslate } from '@/localization/utils';
import Button from '@/shared/components/Button';
import { useAppTheme } from '@/theme';

import { resolveFeatures } from '../offeringContent';

/**
 * The bullets come from the offering, so their number isn't the app's to know.
 * Capped rather than scrolled: a scrollable inside a dynamically sized sheet is
 * wired into the sheet's own pan gesture and costs frames on every open.
 */
const MAX_FEATURES = 5;

interface UnlockModalProps {
  visible: boolean;
  onClose: () => void;
  onSubscribe: () => void;
  title?: string;
  description?: string;
  buttonLabel?: string;
  metadata?: Record<string, unknown> | null;
}

export default function UnlockModal({
  visible,
  onClose,
  onSubscribe,
  title,
  description,
  buttonLabel,
  metadata,
}: UnlockModalProps): React.JSX.Element {
  const t = useTranslate();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language } = useSelectedLanguage();
  const sheetRef = useRef<BottomSheetModal>(null);

  const features = useMemo(
    () =>
      resolveFeatures({
        metadata,
        locale: language,
        fallback: [
          t('subscription.feature_fallback_1'),
          t('subscription.feature_fallback_2'),
          t('subscription.feature_fallback_3'),
        ],
      }).slice(0, MAX_FEATURES),
    [metadata, language, t],
  );

  // `visible` drives the sheet imperatively. Every way out — the buttons, the
  // backdrop, a drag down, Android back — converges on `onClose` (the last
  // three via `onDismiss`), or the next gate would find the flag already set
  // and raise nothing.
  const isOpen = useRef(false);
  useEffect(() => {
    if (visible && !isOpen.current) {
      isOpen.current = true;
      sheetRef.current?.present();
    } else if (!visible && isOpen.current) {
      isOpen.current = false;
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleDismissed = useCallback(() => {
    isOpen.current = false;
    onClose();
  }, [onClose]);

  const handleSubscribe = useCallback(() => {
    onClose();
    onSubscribe();
  }, [onClose, onSubscribe]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      // The sheet's own surfaces take styles, not classes.
      backgroundStyle={{
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{ width: 44, backgroundColor: theme.colors.borderGray }}
      onDismiss={handleDismissed}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <View className="px-6 pt-2">
          <Text className="text-h2 font-opensans-bold text-typography">
            {title ?? t('subscription.gate_default_title')}
          </Text>
          <Text className="mt-2 text-body font-opensans text-typography opacity-70">
            {description ?? t('subscription.gate_default_body')}
          </Text>

          <View className="mt-5 gap-3 rounded-2xl border border-border-gray p-4">
            {features.map((feature) => (
              <View key={feature} className="flex-row items-start">
                <Text className="w-[18px] text-body font-opensans-semibold text-primary">
                  {'•'}
                </Text>
                <Text className="flex-1 text-body font-opensans-semibold text-typography">
                  {feature}
                </Text>
              </View>
            ))}
          </View>

          <Button
            className="mt-6 mb-0"
            title={buttonLabel ?? t('subscription.gate_default_cta')}
            onPress={handleSubscribe}
          />
          <Pressable
            accessibilityRole="button"
            className="mt-4 self-center px-4 py-1.5"
            hitSlop={10}
            onPress={onClose}
          >
            <Text className="text-body font-opensans-semibold text-typography">
              {t('subscription.gate_maybe_later')}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
