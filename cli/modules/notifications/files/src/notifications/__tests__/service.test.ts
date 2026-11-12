import { Platform } from 'react-native';
import notifee, { AuthorizationStatus } from 'react-native-notify-kit';
import {
  getToken,
  onTokenRefresh as onFcmTokenRefresh,
  registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';

import { getFcmToken, getPermissionState, onTokenRefresh, requestPermission } from '../service';

/**
 * The single file in the app that talks to Firebase and the OS notification
 * layer. Nothing above it can be trusted if this is wrong, and none of it can
 * be checked by hand without a real device and a real push.
 *
 * The token half matters most right now: the FCM token lifecycle is about to
 * change, and `getFcmToken` has a platform branch (iOS must register with APNs
 * before Firebase will mint a token) that is invisible on Android and silent
 * when it breaks — it returns null and no push ever arrives.
 */

jest.mock('../channels', () => ({
  createChannels: jest.fn().mockResolvedValue(undefined),
  isPrimaryChannelBlocked: jest.fn().mockResolvedValue(false),
}));

jest.mock('../log', () => ({
  logNotification: jest.fn(),
  describeRemoteMessage: jest.fn(),
}));

const mockGetToken = getToken as jest.Mock;
const mockRegisterForRemote = registerDeviceForRemoteMessages as jest.Mock;
const mockOnFcmTokenRefresh = onFcmTokenRefresh as jest.Mock;
const mockGetSettings = notifee.getNotificationSettings as jest.Mock;
const mockRequestPermission = notifee.requestPermission as jest.Mock;

describe('notification service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue('test-fcm-token');
    mockRegisterForRemote.mockResolvedValue(undefined);
  });

  describe('getFcmToken', () => {
    it('returns the registration token', async () => {
      Platform.OS = 'android';

      await expect(getFcmToken()).resolves.toBe('test-fcm-token');
    });

    /**
     * Firebase cannot mint a token on iOS until the device has registered with
     * APNs. Skipping it is why iOS silently never receives a push, with nothing
     * in the logs to say so.
     */
    it('registers with APNs before asking for a token on iOS', async () => {
      Platform.OS = 'ios';

      await getFcmToken();

      expect(mockRegisterForRemote).toHaveBeenCalled();
      const registerOrder = mockRegisterForRemote.mock.invocationCallOrder[0];
      const tokenOrder = mockGetToken.mock.invocationCallOrder[0];
      expect(registerOrder).toBeLessThan(tokenOrder);
    });

    it('does not register with APNs on Android', async () => {
      Platform.OS = 'android';

      await getFcmToken();

      expect(mockRegisterForRemote).not.toHaveBeenCalled();
    });

    /**
     * A simulator never completes APNs registration. Returning null rather than
     * throwing is what keeps the provider's effect from taking the screen down
     * with it.
     */
    it('answers null rather than throwing when the token cannot be minted', async () => {
      Platform.OS = 'ios';
      mockRegisterForRemote.mockRejectedValue(new Error('no APNs on simulator'));

      await expect(getFcmToken()).resolves.toBeNull();
    });

    it('answers null when Firebase rejects', async () => {
      Platform.OS = 'android';
      mockGetToken.mockRejectedValue(new Error('unavailable'));

      await expect(getFcmToken()).resolves.toBeNull();
    });
  });

  describe('onTokenRefresh', () => {
    /**
     * FCM rotates tokens on its own schedule. A rotation the backend is not
     * told about is a device that stops receiving pushes with no error anywhere.
     */
    it('subscribes to rotations and hands back the unsubscribe', () => {
      const unsubscribe = jest.fn();
      mockOnFcmTokenRefresh.mockReturnValue(unsubscribe);
      const handler = jest.fn();

      const returned = onTokenRefresh(handler);

      expect(mockOnFcmTokenRefresh).toHaveBeenCalledWith(expect.anything(), handler);
      expect(returned).toBe(unsubscribe);
    });
  });

  describe('permission', () => {
    it('reports granted when the OS has authorised', async () => {
      mockGetSettings.mockResolvedValue({
        authorizationStatus: AuthorizationStatus.AUTHORIZED,
      });

      await expect(getPermissionState()).resolves.toBe('granted');
    });

    it('reports blocked when the OS has denied', async () => {
      mockGetSettings.mockResolvedValue({
        authorizationStatus: AuthorizationStatus.DENIED,
      });

      await expect(getPermissionState(false)).resolves.toBe('blocked');
    });

    it('treats a provisional authorisation as granted at the prompt', async () => {
      mockRequestPermission.mockResolvedValue({
        authorizationStatus: AuthorizationStatus.PROVISIONAL,
      });

      await expect(requestPermission()).resolves.toMatchObject({ granted: true });
    });

    /**
     * A denial at the prompt is terminal on iOS. Reporting it as still askable
     * would leave the banner offering a button that can never do anything.
     */
    it('marks a denial at the prompt as not askable again', async () => {
      mockRequestPermission.mockResolvedValue({
        authorizationStatus: AuthorizationStatus.DENIED,
      });

      const { granted, state } = await requestPermission();

      expect(granted).toBe(false);
      expect(state).not.toBe('granted');
    });
  });
});
