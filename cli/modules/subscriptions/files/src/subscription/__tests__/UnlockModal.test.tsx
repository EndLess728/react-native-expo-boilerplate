import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/localization/i18n';

import UnlockModal from '../components/UnlockModal';

/**
 * The gate sheet is the app's only upsell, so what matters here is that the
 * words it shows are the ones it was given — the caller's, the offering's, or
 * the translated fallback — and that both ways out of it do what they say.
 */
describe('UnlockModal', () => {
  const onClose = jest.fn();
  const onSubscribe = jest.fn();

  // Without this `t()` answers with the key, and every assertion on the
  // sheet's own fallback copy would pass against the key, not the sentence.
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    onClose.mockClear();
    onSubscribe.mockClear();
  });

  const renderSheet = (props: Partial<React.ComponentProps<typeof UnlockModal>> = {}) =>
    render(<UnlockModal visible onClose={onClose} onSubscribe={onSubscribe} {...props} />);

  it('shows the copy the gate supplied', () => {
    renderSheet({ title: 'Unlock exports', description: 'Export to PDF with Premium.' });

    expect(screen.getByText('Unlock exports')).toBeTruthy();
    expect(screen.getByText('Export to PDF with Premium.')).toBeTruthy();
  });

  it('falls back to the generic copy when the gate names nothing', () => {
    renderSheet();

    expect(screen.getByText('Unlock Premium')).toBeTruthy();
    expect(screen.getByText('Try Premium')).toBeTruthy();
    expect(screen.getByText('Maybe later')).toBeTruthy();
  });

  // The bullets belong to the offering. A hardcoded list here is what would let
  // the gate and the paywall describe different products.
  it('lists the features from the offering metadata', () => {
    renderSheet({ metadata: { features: ['Cloud sync', 'Unlimited projects'] } });

    expect(screen.getByText('Cloud sync')).toBeTruthy();
    expect(screen.getByText('Unlimited projects')).toBeTruthy();
    expect(screen.queryByText('Cancel anytime')).toBeNull();
  });

  it('falls back to translated features without metadata', () => {
    renderSheet();

    expect(screen.getByText('Cancel anytime')).toBeTruthy();
  });

  it('closes and opens the paywall from the CTA', () => {
    renderSheet();

    fireEvent.press(screen.getByText('Try Premium'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });

  it('only closes on "Maybe later"', () => {
    renderSheet();

    fireEvent.press(screen.getByText('Maybe later'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubscribe).not.toHaveBeenCalled();
  });
});
