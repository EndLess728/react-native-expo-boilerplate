import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import * as config from '../config';
import { NotificationProvider, useNotificationContext } from '../NotificationProvider';
import * as service from '../service';
import type { NotificationPayload } from '../types';

/**
 * The provider owns every listener: permission re-reads, token registration,
 * cold-start routing, taps while running, foreground messages and the badge.
 * The SDK boundary (`service.ts`) is mocked whole, and each listener's handler
 * is captured so a test can play the OS's part.
 */

jest.mock('../log', () => ({ logNotification: jest.fn() }));

// Every function the provider imports from ./service must be here — a missing
// one is `undefined`, and the effect calling it fails silently.
jest.mock('../service', () => ({
  clearBadge: jest.fn().mockResolvedValue(undefined),
  displayForegroundNotification: jest.fn().mockResolvedValue(undefined),
  getFcmToken: jest.fn().mockResolvedValue('fcm-token'),
  getInitialPayload: jest.fn().mockResolvedValue(null),
  getPermissionState: jest.fn().mockResolvedValue('undetermined'),
  onForegroundMessage: jest.fn(),
  onNotificationPress: jest.fn(),
  onTokenRefresh: jest.fn(),
  openNotificationSettings: jest.fn().mockResolvedValue(undefined),
  requestPermission: jest.fn(),
}));

const mockRegisterToken = jest.fn().mockResolvedValue(undefined);
jest.mock('../useNotificationSync', () => ({
  useNotificationSync: () => ({ registerToken: mockRegisterToken }),
}));

const mocked = service as jest.Mocked<typeof service>;

// ── Captured handlers ───────────────────────────────────────────────────────
let pressHandler: ((payload: NotificationPayload) => void) | null;
let foregroundHandler: ((title: string, body: string, payload: NotificationPayload) => void) | null;
let tokenRefreshHandler: ((token: string) => void) | null;
let appStateHandlers: ((state: AppStateStatus) => void)[];

const unsubscribePress = jest.fn();
const unsubscribeForeground = jest.fn();
const unsubscribeTokenRefresh = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  pressHandler = null;
  foregroundHandler = null;
  tokenRefreshHandler = null;
  appStateHandlers = [];

  mocked.getPermissionState.mockResolvedValue('undetermined');
  mocked.getInitialPayload.mockResolvedValue(null);
  mocked.getFcmToken.mockResolvedValue('fcm-token');
  mocked.onNotificationPress.mockImplementation((handler) => {
    pressHandler = handler;
    return unsubscribePress;
  });
  mocked.onForegroundMessage.mockImplementation((handler) => {
    foregroundHandler = handler;
    return unsubscribeForeground;
  });
  mocked.onTokenRefresh.mockImplementation((handler) => {
    tokenRefreshHandler = handler;
    return unsubscribeTokenRefresh;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandlers.push(handler as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => jest.restoreAllMocks());

const foreground = async () => {
  await act(async () => {
    appStateHandlers.forEach((handler) => handler('active'));
  });
};

/**
 * Renders the provider. The wrapper reads `session` on every render (wrapper
 * props aren't updated by `rerender`), so a test signs out by flipping it and
 * calling `rerender`.
 */
const render = ({
  isLoggedIn = true,
  onNavigate = jest.fn(),
}: { isLoggedIn?: boolean; onNavigate?: (route: string) => void } = {}) => {
  const session = { isLoggedIn };
  const utils = renderHook(() => useNotificationContext(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <NotificationProvider isLoggedIn={session.isLoggedIn} onNavigate={onNavigate}>
        {children}
      </NotificationProvider>
    ),
  });
  return { ...utils, onNavigate, session };
};

// ── Permission ───────────────────────────────────────────────────────────────

describe('permission', () => {
  it('reads the real state on mount', async () => {
    mocked.getPermissionState.mockResolvedValue('blocked');

    const { result } = render();

    await waitFor(() => expect(result.current.permission).toBe('blocked'));
  });

  // The structural guarantee: a prompt the user didn't ask for is the one they
  // deny, and on iOS a denial is permanent.
  it('never prompts on its own', async () => {
    const { result } = render();
    await waitFor(() => expect(mocked.getPermissionState).toHaveBeenCalled());

    await foreground();

    expect(mocked.requestPermission).not.toHaveBeenCalled();
    expect(result.current.permission).toBe('undetermined');
  });

  // The user can leave for system settings, flip the switch and come back;
  // nothing notifies the app, so only a fresh read closes the loop.
  it('re-reads permission when the app returns to the foreground', async () => {
    const { result } = render();
    await waitFor(() => expect(mocked.getPermissionState).toHaveBeenCalledTimes(1));

    mocked.getPermissionState.mockResolvedValue('granted');
    await foreground();

    await waitFor(() => expect(result.current.permission).toBe('granted'));
  });

  it('requests through the context and adopts the answer', async () => {
    mocked.requestPermission.mockResolvedValue({ state: 'granted', granted: true });
    const { result } = render();

    await act(async () => {
      await expect(result.current.requestPermission()).resolves.toBe('granted');
    });

    expect(result.current.permission).toBe('granted');
  });

  // Once refused, iOS never shows the prompt again — the next read must say so,
  // so the banner offers Settings instead of a button that does nothing.
  it('remembers that the prompt was spent after a denial', async () => {
    mocked.requestPermission.mockResolvedValue({ state: 'denied', granted: false });
    const { result } = render();

    await act(async () => {
      await result.current.requestPermission();
    });
    await act(async () => {
      await result.current.refreshPermission();
    });

    expect(mocked.getPermissionState).toHaveBeenLastCalledWith(false);
  });
});

// ── Token ────────────────────────────────────────────────────────────────────

describe('token registration', () => {
  it('registers the token once signed in AND granted', async () => {
    mocked.getPermissionState.mockResolvedValue('granted');

    const { result } = render();

    await waitFor(() => expect(mockRegisterToken).toHaveBeenCalledWith('fcm-token'));
    expect(result.current.fcmToken).toBe('fcm-token');
  });

  // A token fetched before the user agrees is one the backend will send to and
  // the OS will silently discard.
  it('does not fetch a token without permission', async () => {
    render();
    await waitFor(() => expect(mocked.getPermissionState).toHaveBeenCalled());

    expect(mocked.getFcmToken).not.toHaveBeenCalled();
    expect(mockRegisterToken).not.toHaveBeenCalled();
  });

  it('does not register a token while signed out', async () => {
    mocked.getPermissionState.mockResolvedValue('granted');

    render({ isLoggedIn: false });
    await waitFor(() => expect(mocked.getPermissionState).toHaveBeenCalled());

    expect(mockRegisterToken).not.toHaveBeenCalled();
  });

  it('registers a refreshed token', async () => {
    mocked.getPermissionState.mockResolvedValue('granted');
    render();
    await waitFor(() => expect(tokenRefreshHandler).not.toBeNull());

    act(() => tokenRefreshHandler?.('rotated-token'));

    expect(mockRegisterToken).toHaveBeenCalledWith('rotated-token');
  });

  it('stops listening for refreshes after sign-out', async () => {
    mocked.getPermissionState.mockResolvedValue('granted');
    const { rerender, session } = render();
    await waitFor(() => expect(tokenRefreshHandler).not.toBeNull());

    session.isLoggedIn = false;
    rerender({});

    expect(unsubscribeTokenRefresh).toHaveBeenCalled();
  });
});

// ── Routing ──────────────────────────────────────────────────────────────────

describe('routing', () => {
  // A tap on a killed app resolves before the navigator exists; it must be
  // parked and delivered, not pushed into nothing.
  it('delivers a cold-start notification once the navigator is ready', async () => {
    mocked.getInitialPayload.mockResolvedValue({ type: 'account' });

    const { onNavigate } = render();

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/settings'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('routes a tap while the app is running', async () => {
    const { onNavigate } = render();
    await waitFor(() => expect(pressHandler).not.toBeNull());
    // Let the navigator-ready frame pass.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    act(() => pressHandler?.({ type: 'account' }));

    expect(onNavigate).toHaveBeenCalledWith('/settings');
  });

  it('opens the app without navigating for a type with no route', async () => {
    const { onNavigate } = render();
    await waitFor(() => expect(pressHandler).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    act(() => pressHandler?.({ type: 'general' }));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  // Pushing a gated route while signed out lands on a screen the auth guard
  // bounces straight off.
  it('drops a signed-in-only route while signed out', async () => {
    const { onNavigate } = render({ isLoggedIn: false });
    await waitFor(() => expect(pressHandler).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    act(() => pressHandler?.({ type: 'account' }));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  // One tap can arrive down two paths (Firebase and NotifyKit); it must not
  // push the same screen twice.
  it('navigates once when the same tap arrives twice', async () => {
    const { onNavigate } = render();
    await waitFor(() => expect(pressHandler).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    act(() => {
      pressHandler?.({ type: 'account' });
      pressHandler?.({ type: 'account' });
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('stops listening for taps on unmount', async () => {
    const { unmount } = render();
    await waitFor(() => expect(pressHandler).not.toBeNull());

    unmount();

    expect(unsubscribePress).toHaveBeenCalled();
    expect(unsubscribeForeground).toHaveBeenCalled();
  });
});

// ── Foreground messages ──────────────────────────────────────────────────────

describe('foreground messages', () => {
  // FCM draws nothing while the app is open; without this the push is
  // delivered and invisible.
  it('draws a remote message that arrives in the foreground', async () => {
    render();
    await waitFor(() => expect(foregroundHandler).not.toBeNull());

    act(() => foregroundHandler?.('Hello', 'World', { type: 'general' }));

    expect(mocked.displayForegroundNotification).toHaveBeenCalledWith(
      'Hello',
      'World',
      { type: 'general' },
      expect.any(String),
    );
  });

  it('ignores a data-only message with nothing to show', async () => {
    render();
    await waitFor(() => expect(foregroundHandler).not.toBeNull());

    act(() => foregroundHandler?.('', '', { type: 'general' }));

    expect(mocked.displayForegroundNotification).not.toHaveBeenCalled();
  });
});

// ── Badge ────────────────────────────────────────────────────────────────────

describe('badge', () => {
  it('clears the badge when the app opens and each time it returns', async () => {
    render();
    await waitFor(() => expect(mocked.clearBadge).toHaveBeenCalledTimes(1));

    await foreground();

    expect(mocked.clearBadge).toHaveBeenCalledTimes(2);
  });

  it('leaves the badge alone when CLEAR_BADGE_ON_OPEN is off', async () => {
    // Restored by `restoreAllMocks` after each test.
    jest.replaceProperty(config, 'CLEAR_BADGE_ON_OPEN', false);

    render();
    await waitFor(() => expect(mocked.getPermissionState).toHaveBeenCalled());
    await foreground();

    expect(mocked.clearBadge).not.toHaveBeenCalled();
  });
});

describe('useNotificationContext', () => {
  it('fails loudly outside the provider', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useNotificationContext())).toThrow(
      'useNotificationContext must be used within <NotificationProvider>',
    );
    error.mockRestore();
  });
});
