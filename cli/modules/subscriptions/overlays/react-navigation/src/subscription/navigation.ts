import { navigationRef } from '@/navigation/navigationRef';
import { NAVIGATION } from '@/shared/constants';

/** Opens the paywall screen. The gate sheet's CTA calls this; so can any screen. */
export function openPaywall(): void {
  if (navigationRef.isReady()) navigationRef.navigate(NAVIGATION.subscription);
}

/** Leaves the paywall: back where the user came from, or home on a deep link. */
export function closePaywall(): void {
  if (!navigationRef.isReady()) return;
  if (navigationRef.canGoBack()) navigationRef.goBack();
  else navigationRef.navigate(NAVIGATION.main, { screen: NAVIGATION.home });
}
