/**
 * notifications/components/NotificationPermissionBanner.tsx
 *
 * Tells the user when notifications will not actually arrive, and gives them
 * the one action that fixes it.
 *
 * The states are not cosmetic variations on "turn on notifications". Two of
 * them are silent failures the OS reports as success — see
 * `NotificationPermissionState` — and each needs a different CTA, because a
 * button calling `requestPermission()` does nothing once iOS has recorded a
 * denial. Which message and which action is decided in `permissionState.ts`;
 * this component only renders the winner.
 */

import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@react-native-vector-icons/ionicons';

import { type TxKeyPath, useTranslate } from '@/localization/utils';
import { ms } from '@/shared/utils';
import { TextStyles, useAppTheme } from '@/theme';

import type { NotificationPermissionState } from '../types';
import { useNotificationPermission } from '../useNotificationPermission';

/** Copy and CTA per state. `granted` is absent — it renders nothing. */
const COPY: Record<
  Exclude<NotificationPermissionState, 'granted'>,
  { title: TxKeyPath; action: TxKeyPath; tone: 'warn' | 'critical' }
> = {
  undetermined: {
    title: 'notifications.permission.undetermined',
    action: 'notifications.permission.turn_on',
    tone: 'warn',
  },
  denied: {
    title: 'notifications.permission.denied',
    action: 'notifications.permission.turn_on',
    tone: 'warn',
  },
  blocked: {
    title: 'notifications.permission.blocked',
    action: 'notifications.permission.open_settings',
    tone: 'critical',
  },
  'channel-blocked': {
    title: 'notifications.permission.channel_blocked',
    action: 'notifications.permission.open_settings',
    tone: 'critical',
  },
};

export default function NotificationPermissionBanner(): React.JSX.Element | null {
  const theme = useAppTheme();
  const t = useTranslate();
  const { state, requestOrOpenSettings } = useNotificationPermission();
  const [isBusy, setBusy] = React.useState(false);

  // Nothing to warn about — the whole point is that this disappears once
  // notifications will actually be delivered.
  if (state === 'granted') return null;

  const copy = COPY[state];

  const handlePress = async () => {
    setBusy(true);
    try {
      await requestOrOpenSettings();
    } finally {
      setBusy(false);
    }
  };

  const accent = copy.tone === 'critical' ? theme.colors.danger : theme.colors.primary;

  return (
    // `alert` so a screen reader announces it on arrival rather than only when
    // the user reaches it in reading order.
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: accent }]}>
      <Ionicons color={accent} name="notifications-off-outline" size={ms(20)} style={styles.icon} />
      <View style={styles.content}>
        <Text style={[TextStyles.bodySmall, styles.text]}>{t(copy.title)}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          hitSlop={ms(8)}
          style={[styles.actionButton, { borderColor: accent }]}
          onPress={handlePress}
        >
          {isBusy ? (
            <ActivityIndicator color={accent} size="small" />
          ) : (
            <Text style={[TextStyles.bodySmallSemiBold, { color: accent }]}>{t(copy.action)}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    padding: ms(14),
    borderRadius: ms(12),
    borderWidth: 1,
    marginBottom: ms(16),
    backgroundColor: theme.colors.surface,
  },
  icon: {
    marginRight: ms(12),
    marginTop: ms(1),
  },
  content: {
    flex: 1,
    alignItems: 'flex-start',
  },
  text: {
    color: theme.colors.typography,
  },
  /** Outlined rather than underlined text — the fix needs to look pressable. */
  actionButton: {
    marginTop: ms(10),
    paddingHorizontal: ms(12),
    paddingVertical: ms(6),
    borderRadius: ms(20),
    borderWidth: 1,
    minHeight: ms(32),
    justifyContent: 'center',
  },
}));
