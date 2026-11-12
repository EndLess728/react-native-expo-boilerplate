import { AuthorizationStatus } from 'react-native-notify-kit';

import { canPrompt, derivePermissionState, isDelivering } from '../permissionState';

describe('derivePermissionState', () => {
  it('maps the plain authorized and undetermined cases', () => {
    expect(derivePermissionState({ authorizationStatus: AuthorizationStatus.AUTHORIZED })).toBe(
      'granted',
    );
    expect(derivePermissionState({ authorizationStatus: AuthorizationStatus.NOT_DETERMINED })).toBe(
      'undetermined',
    );
  });

  // iOS delivers provisional notifications quietly without ever prompting.
  // That is a real authorization, just a less prominent one.
  it('treats provisional as granted', () => {
    expect(derivePermissionState({ authorizationStatus: AuthorizationStatus.PROVISIONAL })).toBe(
      'granted',
    );
  });

  // The distinction the whole union exists for: a `blocked` banner must offer
  // Settings, because requestPermission() is a no-op once iOS has recorded a
  // denial and a CTA calling it looks like the app is broken.
  it('splits denied on whether the prompt is still reachable', () => {
    expect(
      derivePermissionState({
        authorizationStatus: AuthorizationStatus.DENIED,
        canAskAgain: true,
      }),
    ).toBe('denied');

    expect(
      derivePermissionState({
        authorizationStatus: AuthorizationStatus.DENIED,
        canAskAgain: false,
      }),
    ).toBe('blocked');
  });

  // The silent failure: app permission granted, every API reports success, and
  // Android drops every notification because the channel itself is muted.
  it('reports a muted channel even while authorized', () => {
    expect(
      derivePermissionState({
        authorizationStatus: AuthorizationStatus.AUTHORIZED,
        isChannelBlocked: true,
      }),
    ).toBe('channel-blocked');
  });

  // Ordering guard: a channel check that ran after the authorization check
  // would be unreachable, and the bug above would return silently.
  it('checks the channel before returning granted', () => {
    const blocked = derivePermissionState({
      authorizationStatus: AuthorizationStatus.PROVISIONAL,
      isChannelBlocked: true,
    });
    expect(blocked).toBe('channel-blocked');
  });

  it('ignores a muted channel when permission was never granted', () => {
    expect(
      derivePermissionState({
        authorizationStatus: AuthorizationStatus.DENIED,
        isChannelBlocked: true,
        canAskAgain: false,
      }),
    ).toBe('blocked');
  });
});

describe('isDelivering', () => {
  it('is true only when notifications actually arrive', () => {
    expect(isDelivering('granted')).toBe(true);
    expect(isDelivering('channel-blocked')).toBe(false);
    expect(isDelivering('blocked')).toBe(false);
    expect(isDelivering('denied')).toBe(false);
    expect(isDelivering('undetermined')).toBe(false);
  });
});

describe('canPrompt', () => {
  it('is false for the states that need a trip to Settings', () => {
    expect(canPrompt('undetermined')).toBe(true);
    expect(canPrompt('denied')).toBe(true);
    expect(canPrompt('blocked')).toBe(false);
    expect(canPrompt('channel-blocked')).toBe(false);
    expect(canPrompt('granted')).toBe(false);
  });
});
