import React, { useCallback } from 'react';
import { Eye, Loader2 } from 'lucide-react';

import WalletConnectionCard from '../../components/wallet/WalletConnectionCard';
import { useWallet } from '../../wallet/context/WalletContext';
import {
  formatBalanceAmount,
  type BalanceResponse,
} from '../../wallet/services/wallet.service';

type BalanceOverviewProps = {
  balance?: BalanceResponse;
  balanceLoading: boolean;
  onRefreshBalance: () => Promise<void>;
};

export default function BalanceOverview({
  balance,
  balanceLoading,
}: BalanceOverviewProps) {
  const {
    isConnected,
    isConnecting,
    isWrongNetwork,
    requiredNetworkName,
    address,
    chainId,
    authError,
    openWallet,
    disconnectWallet,
    switchToRequiredNetwork,
    clearAuthError,
    retryAuth,
  } = useWallet();

  const tdxAvailable = formatBalanceAmount(balance?.availableBalance, 2);

  const handleDisconnectWallet = useCallback(async () => {
    try {
      await disconnectWallet();
    } catch (error) {
      console.error('TradeX disconnect error:', error);
    }
  }, [disconnectWallet]);

  const handleSwitchNetwork = useCallback(async () => {
    try {
      await switchToRequiredNetwork();
    } catch (error) {
      console.error('TradeX switch network error:', error);
    }
  }, [switchToRequiredNetwork]);

  return (
    <section className="w-full space-y-3">
      <div className="rounded-[18px] border border-[#E7E9EE] bg-white px-4 py-3">
        <div className="flex items-center gap-1 text-[11px] text-[#667085]">
          <span>TDX Balance</span>
          <Eye size={14} className="text-[#98A2B3]" />
        </div>

        <div className="mt-1 truncate text-[22px] font-black leading-tight text-[#111827]">
          {balanceLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            `${tdxAvailable} TDX`
          )}
        </div>
      </div>

      <WalletConnectionCard
        title="Wallet Connection"
        description="Connect your wallet to view network-aware status and actions."
        isConnected={isConnected}
        isConnecting={isConnecting}
        isWrongNetwork={isWrongNetwork}
        address={address}
        chainId={chainId}
        requiredNetworkName={requiredNetworkName}
        authError={authError}
        onConnect={openWallet}
        onDisconnect={() => {
          void handleDisconnectWallet();
        }}
        onSwitchNetwork={() => {
          void handleSwitchNetwork();
        }}
        onClearAuthError={clearAuthError}
        onRetryAuth={() => {
          void retryAuth();
        }}
      />
    </section>
  );
}