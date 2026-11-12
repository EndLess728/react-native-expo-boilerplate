/**
 * subscription/components/PremiumGate.tsx
 *
 * Owns the gate sheet's open/closed state, and exists to keep that state OUT of
 * `SubscriptionProvider`.
 *
 * The provider is the root of the subscription context, so every re-render of
 * it re-renders every consumer. Holding the flag there meant raising the sheet
 * re-rendered the whole visible app on the sheet's first animation frames —
 * measurably, as dropped frames. Holding it here, opening the sheet re-renders
 * this component and the sheet, and nothing else.
 *
 * Imperative on purpose: `requirePremium` lives in the provider and raises a
 * sheet owned by a child, so the provider holds a ref and calls `open()`. A
 * `visible` prop would put the flag back in the provider's state.
 */

import React, { forwardRef, memo, useCallback, useImperativeHandle, useState } from 'react';

import type { PremiumGateCopy } from '../types';
import UnlockModal from './UnlockModal';

export interface PremiumGateHandle {
  open: (copy?: PremiumGateCopy | null) => void;
}

interface PremiumGateProps {
  /** The current offering's metadata — the source of the feature bullets. */
  metadata?: Record<string, unknown> | null;
  /** The CTA: opens the paywall screen. */
  onSubscribe: () => void;
}

const PremiumGate = memo(
  forwardRef<PremiumGateHandle, PremiumGateProps>(function PremiumGate(
    { metadata, onSubscribe },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const [copy, setCopy] = useState<PremiumGateCopy | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        open: (nextCopy) => {
          setCopy(nextCopy ?? null);
          setVisible(true);
        },
      }),
      [],
    );

    const handleClose = useCallback(() => {
      setVisible(false);
      setCopy(null);
    }, []);

    return (
      <UnlockModal
        buttonLabel={copy?.buttonLabel}
        description={copy?.description}
        metadata={metadata}
        title={copy?.title}
        visible={visible}
        onClose={handleClose}
        onSubscribe={onSubscribe}
      />
    );
  }),
);

PremiumGate.displayName = 'PremiumGate';

export default PremiumGate;
