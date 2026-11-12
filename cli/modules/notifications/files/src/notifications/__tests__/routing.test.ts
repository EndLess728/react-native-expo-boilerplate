import { canOpenRoute, parsePayload, resolveRoute } from '../routing';

// Opt `account` into id passthrough so the encoding path is exercised. The
// shipped config lists no such types.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  TYPES_WITH_ID: ['account'],
}));

/**
 * A `data` block in the shape real backends send: the discriminator under
 * `notification_type`, a redundant nested `data` string and an empty
 * `sender_id`. The parser has to survive what actually arrives, not a tidied
 * version of it.
 */
const BACKEND_ACCOUNT_ALERT = {
  data: '{"type":"ACCOUNT_ALERT"}',
  notification_type: 'ACCOUNT_ALERT',
  sender_id: '',
};

describe('parsePayload', () => {
  it('reads a well-formed payload', () => {
    expect(parsePayload({ type: 'account', id: '482' })).toEqual({ type: 'account', id: '482' });
  });

  it('maps a backend payload value to the internal type', () => {
    const payload = parsePayload(BACKEND_ACCOUNT_ALERT);

    expect(payload.type).toBe('account');
    // Everything else survives, which is what makes a log line diagnosable.
    expect(payload.notification_type).toBe('ACCOUNT_ALERT');
    expect(payload.sender_id).toBe('');
  });

  it('prefers notification_type over type', () => {
    expect(parsePayload({ notification_type: 'ACCOUNT_ALERT', type: 'general' }).type).toBe(
      'account',
    );
  });

  it('still reads a plain `type` when notification_type is absent', () => {
    // A Firebase console test message, or any other sender.
    expect(parsePayload({ type: 'ACCOUNT' }).type).toBe('account');
  });

  it('matches the discriminator regardless of case or padding', () => {
    expect(parsePayload({ notification_type: 'account_alert' }).type).toBe('account');
    expect(parsePayload({ notification_type: '  ACCOUNT_ALERT  ' }).type).toBe('account');
  });

  // The block is entirely backend-controlled and reaches a background thread
  // where a throw would be invisible, so nothing here trusts its input.
  it('degrades unknown or missing types to general', () => {
    expect(parsePayload({ type: 'wat' }).type).toBe('general');
    expect(parsePayload({}).type).toBe('general');
    expect(parsePayload(undefined).type).toBe('general');
    expect(parsePayload(null).type).toBe('general');
  });

  it('drops non-string values rather than passing them through', () => {
    const payload = parsePayload({ type: 'general', nested: { a: 1 }, id: '7' });
    expect(payload.id).toBe('7');
    expect(payload.nested).toBeUndefined();
  });
});

describe('resolveRoute', () => {
  it('maps a type to its allowlisted route', () => {
    expect(resolveRoute({ type: 'account' })).toBe('/settings');
  });

  it('takes a backend payload all the way to its screen', () => {
    expect(resolveRoute(parsePayload(BACKEND_ACCOUNT_ALERT))).toBe('/settings');
  });

  it('appends and encodes an id for types listed in TYPES_WITH_ID', () => {
    expect(resolveRoute({ type: 'account', id: '482' })).toBe('/settings?id=482');
    expect(resolveRoute({ type: 'account', id: 'a b&c' })).toBe('/settings?id=a%20b%26c');
  });

  it('returns null for types that just open the app', () => {
    expect(resolveRoute({ type: 'general' })).toBeNull();
  });

  // A server-supplied destination would make every push a deep link into any
  // screen in the app. The allowlist is the whole point.
  it('ignores a route supplied in the payload', () => {
    expect(resolveRoute({ type: 'general', route: '/settings' })).toBeNull();
    expect(resolveRoute({ type: 'account', route: '/login' })).toBe('/settings');
  });
});

describe('canOpenRoute', () => {
  it('allows anything for a signed-in user', () => {
    expect(canOpenRoute('/settings', true)).toBe(true);
  });

  // Pushing a gated route while logged out lands on a screen the auth guard
  // bounces straight off — worse than not navigating at all.
  it('blocks gated routes when logged out', () => {
    expect(canOpenRoute('/settings', false)).toBe(false);
    expect(canOpenRoute('/settings?id=1', false)).toBe(false);
  });

  it('allows ungated routes when logged out', () => {
    expect(canOpenRoute('/help', false)).toBe(true);
  });
});
