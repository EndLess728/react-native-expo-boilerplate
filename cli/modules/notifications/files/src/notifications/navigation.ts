import { type Href, router } from 'expo-router';

/**
 * Opens a route resolved from a notification.
 *
 * Routes come from the allowlist in `config.ts`, never from the payload, so the
 * cast only reconciles plain strings with Expo Router's typed hrefs.
 */
export function navigateFromNotification(route: string): void {
  router.push(route as Href);
}
