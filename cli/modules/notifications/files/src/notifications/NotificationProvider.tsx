import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { DEFAULT_CHANNEL_ID } from './config';
import { logNotification } from './log';
import { canOpenRoute, resolveRoute } from './routing';
import {
  displayForegroundNotification,
  getFcmToken,
  getInitialPayload,
  getPermissionState,
  onForegroundMessage,
  onNotificationPress,
  onTokenRefresh,
  openNotificationSettings,
  requestPermission as requestPermissionFromOs,
} from './service';
import type { NotificationContextValue, NotificationPermissionState } from './types';
import { useNotificationSync } from './useNotificationSync';

export const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * How long a route stays deduplicated after being navigated to.
 *
 * Long enough to absorb the same tap arriving down two delivery paths, short
 * enough that a user who genuinely taps two notifications in a row still gets the
 * second one.
 */
const DUPLICATE_TAP_MS = 2000;

interface NotificationProviderProps {
  children: React.ReactNode;
  /** Gates token registration and route delivery. */
  isLoggedIn: boolean;
  /** See `navigation.ts`. Injected so the provider never imports the router. */
  onNavigate: (route: string) => void;
}

/**
 * Owns every notification listener in the app, and the cold-start queue.
 *
 * It deliberately NEVER calls `requestPermission`. It reads permission and
 * exposes a request function, but the only consumer of that function is
 * `useNotificationPermission`, which only a screen deliberately mounts. That
 * is what keeps "never ask on mount, only on a tap" a structural property
 * rather than a convention someone breaks in six months.
 */
export function NotificationProvider({
  children,
  isLoggedIn,
  onNavigate,
}: NotificationProviderProps): React.JSX.Element {
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const { registerToken } = useNotificationSync();

  /**
   * Whether the OS prompt is still reachable.
   *
   * No API reports this, so it is tracked here: once a request comes back
   * denied, the prompt is spent on iOS and the banner has to offer Settings
   * instead. A ref rather than state — it feeds the next permission read rather
   * than the render.
   */
  const canAskAgainRef = useRef(true);

  /**
   * A route resolved from a notification before the app could navigate.
   *
   * This queue is why cold start works. A tap on a killed app resolves its
   * payload during the first render pass, possibly before the navigator exists.
   * Pushing immediately either throws or lands on an auth-guarded route that
   * bounces the user straight back out.
   */
  const pendingRouteRef = useRef<string | null>(null);
  const [isNavigatorReady, setNavigatorReady] = useState(false);

  const refreshPermission = useCallback(async () => {
    const next = await getPermissionState(canAskAgainRef.current);
    setPermission((current) => {
      if (current !== next) logNotification('PERMISSION', next);
      return next;
    });
  }, []);

  const requestPermission = useCallback(async () => {
    const { state, granted } = await requestPermissionFromOs();
    if (!granted) canAskAgainRef.current = false;
    setPermission(state);
    return state;
  }, []);

  // ── Permission, re-read whenever the app comes back to the front ───────────
  //
  // The user can leave for system settings, flip the switch, and return. Only a
  // fresh read closes that loop — nothing notifies the app that it happened.
  useEffect(() => {
    void refreshPermission();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });

    return () => subscription.remove();
  }, [refreshPermission]);

  // ── Token, once permission actually allows delivery ───────────────────────
  //
  // Gated on BOTH login and granted permission. A token fetched before the user
  // agrees is one the backend will happily send to and the OS will silently
  // discard, which looks like a broken backend rather than a missing
  // permission.
  useEffect(() => {
    if (!isLoggedIn || permission !== 'granted') return;

    let cancelled = false;

    void (async () => {
      const token = await getFcmToken();
      if (cancelled || !token) return;
      setFcmToken(token);
      await registerToken(token);
    })();

    const unsubscribe = onTokenRefresh((token) => {
      setFcmToken(token);
      void registerToken(token);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isLoggedIn, permission, registerToken]);

  // ── Navigation, deferred until it can actually succeed ────────────────────

  /**
   * The last route actually navigated to, and when.
   *
   * One tap can now reach the app down two paths — Firebase's
   * `onNotificationOpenedApp` and NotifyKit's background-press queue — and
   * which one carries it depends on who owned the notification natively. Both
   * resolve to the same route, so a tap that arrives twice would push the same
   * screen twice and leave a duplicate on the back stack.
   *
   * Deduplicated on the route rather than a notification id because the id is
   * the one thing the two paths do NOT agree on: Firebase reports the FCM
   * `messageId`, NotifyKit reports its own notification id, and neither is
   * carried in the parsed payload. The window only has to outlast the gap
   * between two deliveries of one tap, which is milliseconds.
   */
  const lastNavigationRef = useRef<{ route: string; at: number } | null>(null);

  const navigateOnce = useCallback(
    (route: string) => {
      const previous = lastNavigationRef.current;

      if (previous && previous.route === route && Date.now() - previous.at < DUPLICATE_TAP_MS) {
        logNotification('ROUTE ignored — same route already delivered for this tap', route);
        return;
      }

      lastNavigationRef.current = { route, at: Date.now() };
      logNotification('ROUTE navigating', route);
      onNavigate(route);
    },
    [onNavigate],
  );

  const deliverRoute = useCallback(
    (route: string | null) => {
      // Every branch below is logged. A tap that appears to do nothing is the
      // hardest failure here to diagnose, and there are three distinct reasons
      // for it — no route mapped, navigator not ready, route gated — that are
      // indistinguishable from the outside.
      if (!route) {
        logNotification('ROUTE none — opening the app without navigating');
        return;
      }

      if (!isNavigatorReady) {
        logNotification('ROUTE queued until the navigator is ready', route);
        pendingRouteRef.current = route;
        return;
      }

      // Silently dropped rather than queued indefinitely: a gated route for a
      // logged-out user is not going to become deliverable during this launch,
      // and holding it would fire it the moment they signed in for an unrelated
      // reason.
      if (!canOpenRoute(route, isLoggedIn)) {
        logNotification('ROUTE dropped — requires sign-in', route);
        return;
      }

      navigateOnce(route);
    },
    [isLoggedIn, isNavigatorReady, navigateOnce],
  );

  // The navigator is mounted by the time an effect in a child of the router
  // runs, so a single frame's deferral is enough to make `push` safe.
  useEffect(() => {
    const handle = requestAnimationFrame(() => setNavigatorReady(true));
    return () => cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    if (!isNavigatorReady) return;

    const queued = pendingRouteRef.current;
    if (!queued) return;

    pendingRouteRef.current = null;

    if (!canOpenRoute(queued, isLoggedIn)) {
      logNotification('ROUTE dropped from queue — requires sign-in', queued);
      return;
    }

    logNotification('ROUTE navigating from queue', queued);
    navigateOnce(queued);
  }, [isLoggedIn, isNavigatorReady, navigateOnce]);

  // ── Cold start ────────────────────────────────────────────────────────────
  //
  // Guarded by a ref rather than an empty dependency array. `deliverRoute`
  // changes identity as auth and navigator readiness resolve, so an honest
  // dependency list re-runs this several times per launch and re-navigates on
  // each — but silencing the linter to force `[]` costs the whole component its
  // React Compiler optimisation. The ref gets both: real dependencies, and the
  // read happening exactly once.
  const hasHandledColdStartRef = useRef(false);

  useEffect(() => {
    if (hasHandledColdStartRef.current) return;
    hasHandledColdStartRef.current = true;

    void (async () => {
      const payload = await getInitialPayload();
      // Safe to run before the navigator exists — `deliverRoute` parks the
      // route in `pendingRouteRef` and the flush effect above delivers it.
      if (payload) deliverRoute(resolveRoute(payload));
    })();
  }, [deliverRoute]);

  // ── Taps while running ────────────────────────────────────────────────────
  useEffect(
    () => onNotificationPress((payload) => deliverRoute(resolveRoute(payload))),
    [deliverRoute],
  );

  // ── Foreground messages ───────────────────────────────────────────────────
  //
  // FCM draws nothing in the foreground on either platform, so without this the
  // notification is delivered and invisible.
  useEffect(
    () =>
      onForegroundMessage((title, body, payload) => {
        if (!title && !body) return;
        void displayForegroundNotification(title, body, payload, DEFAULT_CHANNEL_ID);
      }),
    [],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      permission,
      fcmToken,
      refreshPermission,
      requestPermission,
      openSettings: openNotificationSettings,
    }),
    [permission, fcmToken, refreshPermission, requestPermission],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext must be used within <NotificationProvider>');
  }
  return context;
}
