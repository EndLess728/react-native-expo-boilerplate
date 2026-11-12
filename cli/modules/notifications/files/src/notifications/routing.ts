import type { NotificationType } from './config';
import {
  AUTHENTICATED_ROUTES,
  ROUTE_BY_TYPE,
  TYPE_BY_PAYLOAD_VALUE,
  TYPES_WITH_ID,
} from './config';
import type { NotificationPayload } from './types';

/**
 * Where the discriminator lives, in priority order.
 *
 * `notification_type` is a common backend convention; `type` is the
 * conventional FCM field and is kept as a fallback so a payload from any other
 * sender — a Firebase console test message, a future service — still routes.
 */
const TYPE_KEYS = ['notification_type', 'type'] as const;

/**
 * A raw FCM `data` block → a typed payload.
 *
 * Every value on the wire is a string, and the block is entirely
 * backend-controlled, so nothing here trusts its input: an unknown or missing
 * `type` degrades to `general` rather than throwing. A malformed payload should
 * open the app, not crash the notification handler on a background thread where
 * the error is invisible.
 */
/**
 * Reads the discriminator, whichever key and casing it arrived under.
 *
 * Normalised to upper case before lookup because the backend sends
 * `ACCOUNT_ALERT` while nothing stops a future sender using `account_alert`.
 * An unrecognised value degrades to `general` — which opens the app and
 * navigates nowhere — rather than throwing on a background thread where the
 * error would be invisible.
 */
function readType(data: Record<string, unknown> | undefined | null): NotificationType {
  for (const key of TYPE_KEYS) {
    const raw = data?.[key];
    if (typeof raw !== 'string') continue;

    const mapped = TYPE_BY_PAYLOAD_VALUE[raw.trim().toUpperCase()];
    if (mapped) return mapped;
  }

  return 'general';
}

export function parsePayload(
  data: Record<string, unknown> | undefined | null,
): NotificationPayload {
  const payload: NotificationPayload = { type: readType(data) };

  // Every other string field is carried through untouched — `notification_type`
  // and `sender_id` included. They are not used for routing, but they are what
  // makes a `[notifications]` log line enough to diagnose a bad payload without
  // reaching for the backend.
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key !== 'type' && typeof value === 'string') payload[key] = value;
  }

  return payload;
}

/**
 * A payload → the route to open, or null for "just bring the app to the front".
 *
 * The route comes from the client's own `ROUTE_BY_TYPE` allowlist, never from a
 * URL in the payload. A server-supplied destination would make every push a
 * potential deep link into any screen in the app, which is a bad trade for
 * saving one map entry — so a `route` field in `data` is deliberately ignored.
 *
 * `id` is appended as a query param only for types listed in `TYPES_WITH_ID`,
 * and only after being URI-encoded.
 */
export function resolveRoute(payload: NotificationPayload): string | null {
  const base = ROUTE_BY_TYPE[payload.type];
  if (!base) return null;

  if (payload.id && TYPES_WITH_ID.includes(payload.type)) {
    return `${base}?id=${encodeURIComponent(payload.id)}`;
  }

  return base;
}

/**
 * Whether a route can be opened right now.
 *
 * A cold start from a notification resolves long before auth does, and pushing
 * a gated route while logged out lands the user on a screen `Stack.Protected`
 * immediately bounces them off. Dropping it is better than that flash.
 */
export function canOpenRoute(route: string, isLoggedIn: boolean): boolean {
  if (isLoggedIn) return true;

  const path = route.split('?')[0];
  return !AUTHENTICATED_ROUTES.includes(path);
}
