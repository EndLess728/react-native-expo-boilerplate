import { type Href, router } from 'expo-router';

/** The paywall's route — `src/app/subscription.tsx`. */
export const PAYWALL_ROUTE = '/subscription' as Href;

/** Opens the paywall screen. The gate sheet's CTA calls this; so can any screen. */
export function openPaywall(): void {
  router.push(PAYWALL_ROUTE);
}

/** Leaves the paywall: back where the user came from, or home on a deep link. */
export function closePaywall(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
