/**
 * Axios HTTP Client
 *
 * A production-ready API client with the following features:
 *
 * - Automatic auth token injection from MMKV secure storage
 * - Network connectivity check before every request (via NetInfo)
 * - Graceful session expiry handling with user-facing alerts
 * - Optional token refresh with concurrent request queuing
 * - Auto-detection of FormData for file uploads
 * - Structured error parsing with toast notifications
 * - Dev-mode request/response logging
 */

import { Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import Env from '@env';
import { signOut } from '@/features/auth';
import { translate } from '@/localization/utils';
import { showErrorToast } from '@/shared/utils/toast';
import { getAccessToken, getRefreshToken, setTokens } from '@/storage/token';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/**
 * Standard error shape returned by most REST APIs.
 * Supports both `error` (single array) and `errors` (multiple arrays)
 * to handle different backend conventions.
 */
interface ErrorResponse {
  error?: string[];
  errors?: string[];
  message?: string;
  statusCode?: number;
}

/**
 * Represents a request waiting in the refresh queue.
 * Each item holds resolve/reject callbacks that are called
 * once the token refresh completes (or fails).
 */
interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

/**
 * Extends the Axios request config with:
 *
 * - `silent` — skip the error toasts for this request. For background calls
 *   the user didn't trigger and can't act on (e.g. registering a push token).
 *   Errors still reject, and 401 handling still applies.
 * - `_retryCount` — how many times a request has been retried after a 401
 *   response. This prevents infinite retry loops.
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    silent?: boolean;
  }
  interface InternalAxiosRequestConfig {
    _retryCount?: number;
  }
}

// ─────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────

/**
 * Toggle automatic token refresh on 401 responses.
 *
 * - `false` (default): A 401 clears tokens and shows a
 *   "Session Expired" alert, then logs the user out.
 *   Use this when your API does NOT support refresh tokens.
 *
 * - `true`: Attempts to silently refresh the access token
 *   using the stored refresh token. Failed requests are queued
 *   and retried automatically after a successful refresh.
 *   Use this when your API provides a `/auth/refresh` endpoint.
 */
const ENABLE_TOKEN_REFRESH = false;

/**
 * Maximum number of times a single request can be retried
 * after receiving a 401. Prevents infinite loops if the
 * refresh token itself is invalid/expired.
 */
const MAX_RETRIES = 1;

// ─────────────────────────────────────────────────────────────
//  Axios Instance
// ─────────────────────────────────────────────────────────────

export const client = axios.create({
  baseURL: Env.EXPO_PUBLIC_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ─────────────────────────────────────────────────────────────
//  Session Expiry
// ─────────────────────────────────────────────────────────────

/**
 * Guards against concurrent 401 responses. When N requests fail at once we
 * only want one alert, one logout, and one token-clear — not N of each.
 */
let isLoggingOut = false;

/**
 * Gracefully handles session expiry by:
 * 1. Logging the user out immediately so screens stop firing more requests
 *    with the now-invalid token.
 * 2. Showing a native alert so the user knows what happened.
 *
 * Idempotent across concurrent 401s — the `isLoggingOut` guard ensures only
 * the first call does the work; subsequent calls are no-ops until the alert
 * is acknowledged.
 */
const forceLogout = () => {
  if (isLoggingOut) return;
  isLoggingOut = true;

  // Flip auth state synchronously — `signOut()` clears tokens via the store —
  // so any in-flight screens stop issuing requests with the stale token
  // before the user has even tapped OK on the alert.
  signOut();

  Alert.alert(
    translate('errors.session_expired'),
    translate('errors.session_expired_message'),
    [
      {
        text: translate('common.ok'),
        onPress: () => {
          isLoggingOut = false;
        },
      },
    ],
    { cancelable: false },
  );
};

// ─────────────────────────────────────────────────────────────
//  Token Refresh Queue
// ─────────────────────────────────────────────────────────────
//
//  Handles the case where multiple requests fail with 401
//  simultaneously (e.g. a screen fires 3 API calls at once).
//
//  Only ONE refresh call is made. All other failed requests
//  are held in a queue and retried once the new token arrives.
//
//  Flow diagram:
//
//  ┌─ Request A ──▶ 401 ──▶ starts refreshToken() ──────────▶ retry A ✅
//  ├─ Request B ──▶ 401 ──▶ queued (isRefreshing=true) ─────▶ retry B ✅
//  └─ Request C ──▶ 401 ──▶ queued (isRefreshing=true) ─────▶ retry C ✅
//                           │                             │
//                           └── POST /auth/refresh ──────▶│
//                               ⬇                         │
//                           setTokens() → MMKV            │
//                           processQueue() ───────────────┘
//

/** Flag to prevent multiple simultaneous refresh calls. */
let isRefreshing = false;

/** Requests waiting for the token refresh to complete. */
let failedQueue: QueueItem[] = [];

/**
 * Resolves or rejects all queued requests after a refresh attempt.
 *
 * @param error - If non-null, all queued requests are rejected with this error.
 * @param token - The new access token (used when the refresh succeeds).
 */
const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((item) => {
    if (error) {
      item.reject(error);
    } else {
      item.resolve(token!);
    }
  });

  failedQueue = [];
};

/**
 * Calls the refresh-token endpoint to obtain a new access token.
 *
 * Important: This uses a PLAIN `axios` instance instead of `client`
 * to avoid triggering our interceptors, which would cause an
 * infinite loop (401 → refresh → interceptor → 401 → refresh...).
 *
 * Steps:
 * 1. Read the current refresh token from MMKV
 * 2. POST it to the /auth/refresh endpoint
 * 3. Store the new token pair (access + refresh) in MMKV
 * 4. Return the new access token for immediate use
 *
 * @throws Error if no refresh token is stored or the API call fails.
 */
const refreshToken = async (): Promise<string> => {
  const currentRefreshToken = getRefreshToken();

  if (!currentRefreshToken) {
    throw new Error('No refresh token available');
  }

  // NOTE: Using plain `axios.post` here, NOT `client.post`
  const { data } = await axios.post(`${Env.EXPO_PUBLIC_API_URL}/auth/refresh`, {
    refreshToken: currentRefreshToken,
  });

  // Persist the new token pair in encrypted MMKV storage
  setTokens(data.accessToken, data.refreshToken);

  return data.accessToken;
};

// ─────────────────────────────────────────────────────────────
//  Request Interceptor
// ─────────────────────────────────────────────────────────────
//
//  Runs before every outgoing request to:
//  1. Verify network connectivity
//  2. Attach the auth token from MMKV
//  3. Auto-detect content type for FormData uploads
//

client.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // Check network connectivity before making the request.
    // This gives users an immediate "No internet" message instead
    // of waiting for the request to time out after 30 seconds.
    const netState = await NetInfo.fetch();

    if (!netState.isConnected) {
      if (!config.silent) showErrorToast({ title: translate('errors.no_internet') });
      return Promise.reject(new axios.Cancel('No internet connection'));
    }

    // Read the access token from encrypted MMKV storage
    // and attach it as a Bearer token in the Authorization header.
    const token = getAccessToken();

    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

    // When the request body is FormData (file uploads),
    // override the Content-Type so axios sets the correct
    // multipart boundary automatically.
    if (config.data instanceof FormData) {
      config.headers.set('Content-Type', 'multipart/form-data');
    }

    // Dev-only logging for easy debugging during development
    if (__DEV__) {
      console.log(`➡️ [${config.method?.toUpperCase()}] ${config.url}`, config.params ?? '');
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ─────────────────────────────────────────────────────────────
//  Response Interceptor
// ─────────────────────────────────────────────────────────────
//
//  Runs after every response to:
//  1. Log successful responses in dev mode
//  2. Handle 401 (unauthorized) with optional token refresh
//  3. Parse and display user-friendly error messages
//

client.interceptors.response.use(
  (response: AxiosResponse) => {
    // Dev-only success logging
    if (__DEV__) {
      console.log(
        `✅ [${response.config.method?.toUpperCase()}] ${response.config.url} — ${response.status}`,
      );
    }

    return response;
  },

  async (error: AxiosError<ErrorResponse>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig;

    // Dev-only error logging with response body for debugging
    if (__DEV__) {
      console.log(
        `❌ [${originalRequest?.method?.toUpperCase()}] ${originalRequest?.url} — ${error.response?.status}`,
        error.response?.data,
      );
    }

    const status = error.response?.status;

    // ── 401 Unauthorized ──────────────────────────────────
    //
    // The server rejected our token. Either the session expired
    // or the token is invalid. Two possible paths:
    //
    // Path A (ENABLE_TOKEN_REFRESH = false):
    //   → Show alert → Logout
    //
    // Path B (ENABLE_TOKEN_REFRESH = true):
    //   → Attempt refresh → Retry request → Logout on failure
    //
    if (status === 401 && originalRequest) {
      // Path A: No refresh token support — logout gracefully
      if (!ENABLE_TOKEN_REFRESH) {
        forceLogout();
        return Promise.reject(error);
      }

      // Path B: Attempt token refresh with request queuing
      const retryCount = originalRequest._retryCount ?? 0;

      // Safety check: if we've already retried the maximum number
      // of times, the refresh token itself is likely invalid.
      // Stop retrying and force logout.
      if (retryCount >= MAX_RETRIES) {
        forceLogout();
        return Promise.reject(error);
      }

      // If a refresh is already in progress (triggered by another
      // request), don't start a second one. Instead, queue this
      // request and wait for the ongoing refresh to finish.
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((newToken) => {
            originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
            originalRequest._retryCount = retryCount + 1;
            return client(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      // This is the first 401 — start the refresh process
      isRefreshing = true;

      try {
        const newToken = await refreshToken();

        // Refresh succeeded — resolve all queued requests
        processQueue(null, newToken);

        // Retry the original request with the new token
        originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
        originalRequest._retryCount = retryCount + 1;
        return client(originalRequest);
      } catch (refreshError) {
        // Refresh failed — reject all queued requests and logout
        processQueue(refreshError as Error);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // ── Other Errors ──────────────────────────────────────
    //
    // Parse the error response and show a user-friendly toast.
    // Supports two common API error formats:
    //   - { error: ["msg1", "msg2"] }  or  { errors: ["msg1"] }
    //   - { message: "Something went wrong" }
    //
    if (originalRequest?.silent) {
      // The caller handles (or deliberately ignores) the failure.
    } else if (error.response?.data) {
      const { error: apiError, errors, message } = error.response.data;
      const errorList = apiError ?? errors;
      const errorMessage = errorList
        ? errorList.join(', ')
        : message || translate('errors.something_went_wrong');

      showErrorToast({ title: errorMessage });
    } else if (!error.response) {
      // No response at all — likely a network timeout or DNS failure
      showErrorToast({ title: translate('errors.network_error') });
    }

    return Promise.reject(error);
  },
);
