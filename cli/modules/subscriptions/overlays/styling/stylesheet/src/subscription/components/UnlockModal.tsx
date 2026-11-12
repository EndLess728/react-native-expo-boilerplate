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
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelectedLanguage, useTranslate } from '@/localization/utils';
import Button from '@/shared/components/Button';
import { ms } from '@/shared/utils';
import { makeStyles, TextStyles } from '@/theme';

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
  const { language } = useSelectedLanguage();
  const sheetRef = useRef<BottomSheetModal>(null);
  const styles = useStyles();
  const insets = useSafeAreaInsets();

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
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismissed}
    >
      <BottomSheetView
        style={[styles.content, { paddingBottom: Math.max(insets.bottom, ms(16)) + ms(8) }]}
      >
        <Text style={[TextStyles.h2, styles.text]}>
          {title ?? t('subscription.gate_default_title')}
        </Text>
        <Text style={[TextStyles.body, styles.description]}>
          {description ?? t('subscription.gate_default_body')}
        </Text>

        <View style={styles.featureCard}>
          {features.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Text style={[TextStyles.bodySemiBold, styles.bullet]}>{'•'}</Text>
              <Text style={[TextStyles.bodySemiBold, styles.featureText]}>{feature}</Text>
            </View>
          ))}
        </View>

        <Button
          style={styles.cta}
          title={buttonLabel ?? t('subscription.gate_default_cta')}
          onPress={handleSubscribe}
        />
        <Pressable
          accessibilityRole="button"
          hitSlop={ms(10)}
          style={styles.dismiss}
          onPress={onClose}
        >
          <Text style={[TextStyles.bodySemiBold, styles.text]}>
            {t('subscription.gate_maybe_later')}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const useStyles = makeStyles((theme) => ({
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: ms(24),
    borderTopRightRadius: ms(24),
  },
  handleIndicator: {
    width: ms(44),
    backgroundColor: theme.colors.borderGray,
  },
  content: {
    paddingHorizontal: ms(24),
    paddingTop: ms(8),
  },
  text: {
    color: theme.colors.typography,
  },
  description: {
    color: theme.colors.typography,
    opacity: 0.7,
    marginTop: ms(8),
  },
  featureCard: {
    marginTop: ms(20),
    borderRadius: ms(16),
    borderWidth: 1,
    borderColor: theme.colors.borderGray,
    padding: ms(16),
    gap: ms(12),
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    color: theme.colors.primary,
    width: ms(18),
  },
  featureText: {
    flex: 1,
    color: theme.colors.typography,
  },
  cta: {
    marginTop: ms(24),
  },
  dismiss: {
    alignSelf: 'center',
    marginTop: ms(16),
    paddingVertical: ms(6),
    paddingHorizontal: ms(16),
  },
}));
