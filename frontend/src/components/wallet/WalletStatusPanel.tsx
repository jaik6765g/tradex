import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, Wallet } from 'lucide-react';

import {
  AddressBadge,
  Button,
  CopyButton,
  NetworkBadge,
  cx,
} from '../ui';

type WalletStatusPanelProps = {
  isConnected: boolean;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  address: string | null;
  chainId: number | null;
  requiredNetworkName: string;
  authError?: string | null;
  className?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchNetwork: () => void;
  onClearAuthError?: () => void;
  onRetryAuth?: () => void;
};

export default function WalletStatusPanel({
  isConnected,
  isConnecting,
  isWrongNetwork,
  address,
  chainId,
  requiredNetworkName,
  authError,
  className,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  onClearAuthError,
  onRetryAuth,
}: WalletStatusPanelProps) {
  const [dismissedAuthError, setDismissedAuthError] = useState(false);

  useEffect(() => {
    setDismissedAuthError(false);
  }, [authError]);

  const visibleAuthError = useMemo(() => {
    if (!authError || dismissedAuthError) {
      return null;
    }

    return authError;
  }, [authError, dismissedAuthError]);

  if (visibleAuthError) {
    return (
      <div
        className={cx(
          'rounded-[12px] border border-[#FECDCA] bg-[#FEF3F2] p-4',
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <ShieldAlert size={18} className="mt-0.5 text-[#B42318]" />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-[#991B1B]">Authentication Error</p>
            <p className="mt-1 text-xs text-[#7F1D1D]">{visibleAuthError}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="h-9 text-xs"
                onClick={() => {
                  setDismissedAuthError(true);
                  onClearAuthError?.();
                }}
              >
                Clear error state
              </Button>

              <Button
                className="h-9 text-xs"
                onClick={onRetryAuth}
                disabled={!onRetryAuth}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className={cx('rounded-[12px] border border-[#E4E7EC] bg-[#F8FAFC] p-4', className)}>
        <p className="text-sm font-extrabold text-[#111827]">Wallet Disconnected</p>
        <p className="mt-1 text-xs text-[#667085]">Connect your wallet to continue.</p>

        <div className="mt-3">
          <Button
            onClick={onConnect}
            loading={isConnecting}
            className="h-10 text-xs"
          >
            <Wallet size={15} />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </Button>
        </div>
      </div>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className={cx('rounded-[12px] border border-[#FEDF89] bg-[#FFFAEB] p-4', className)}>
        <p className="text-sm font-extrabold text-[#7A2E0E]">Wrong Network</p>
        <p className="mt-1 text-xs text-[#9A3412]">Please switch to {requiredNetworkName}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="warning"
            className="h-9 text-xs"
            onClick={onSwitchNetwork}
            loading={isConnecting}
          >
            Switch Network
          </Button>

          <Button
            variant="secondary"
            className="h-9 text-xs"
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('rounded-[12px] border border-[#E4E7EC] bg-[#F8FAFC] p-4', className)}>
      <p className="text-sm font-extrabold text-[#111827]">Wallet Connected</p>

      {address ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AddressBadge address={address} />
          <NetworkBadge chainId={chainId} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {address ? (
          <CopyButton
            text={address}
            className="h-9 px-3 text-xs"
            defaultLabel="Copy Address"
            copiedLabel="Copied"
          />
        ) : null}

        <Button
          variant="danger"
          className="h-9 min-w-[110px] text-xs"
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}