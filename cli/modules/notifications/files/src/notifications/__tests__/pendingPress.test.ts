import { __resetPendingPress, enqueuePress, subscribeToPendingPress } from '../pendingPress';
import type { NotificationPayload } from '../types';

const press: NotificationPayload = { type: 'account' };
const session: NotificationPayload = { type: 'session', id: '42' };

describe('pendingPress', () => {
  beforeEach(__resetPendingPress);

  it('delivers a press parked before anything subscribed', () => {
    const handler = jest.fn();

    enqueuePress(press);
    subscribeToPendingPress(handler);

    expect(handler).toHaveBeenCalledWith(press);
  });

  it('delivers straight through once a subscriber is live', () => {
    const handler = jest.fn();
    subscribeToPendingPress(handler);

    enqueuePress(press);

    expect(handler).toHaveBeenCalledWith(press);
  });

  it('drains the queue exactly once, so a remount does not re-navigate', () => {
    const first = jest.fn();
    const second = jest.fn();

    enqueuePress(press);
    subscribeToPendingPress(first)();
    subscribeToPendingPress(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps only the most recent press — the one the user actually chose', () => {
    const handler = jest.fn();

    enqueuePress(press);
    enqueuePress(session);
    subscribeToPendingPress(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(session);
  });

  it('parks again after unsubscribing, so a press during teardown is not lost', () => {
    const handler = jest.fn();
    const unsubscribe = subscribeToPendingPress(jest.fn());

    unsubscribe();
    enqueuePress(press);
    subscribeToPendingPress(handler);

    expect(handler).toHaveBeenCalledWith(press);
  });
});
