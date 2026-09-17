import React from 'react';
import {
  LockKeyhole,
  Loader2,
  Timer,
  Wallet,
} from 'lucide-react';

import {
  formatBalanceAmount,
  type BalanceResponse,
} from '../../wallet/services/wallet.service';

type TdxWalletCardProps = {
  balance?: BalanceResponse;
  loading?: boolean;
  error?: string;
};

export default function TdxWalletCard({
  balance,
  loading = false,
  error,
}: TdxWalletCardProps) {
  const available =
    formatBalanceAmount(
      balance?.availableBalance,
      2
    );

  const locked =
    formatBalanceAmount(
      balance?.lockedBalance,
      2
    );

  const pending =
    formatBalanceAmount(
      balance?.withdrawalLocked,
      2
    );

  return (
    <div className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-[18px]">
      <div className="flex justify-between items-center mb-[14px]">
        <h2 className="text-[19px] font-black text-[#F5F5F7]">
          TDX Wallet
        </h2>

        <button className="text-[#FF7A18] text-[15px] font-extrabold">
          View Details ›
        </button>
      </div>

      <div className="flex gap-2.5">
        <WalletItem
          title="Available"
          value={`${available} TDX`}
          icon={<Wallet size={25} />}
          iconColor="#22C55E"
          loading={loading}
        />

        <WalletItem
          title="Locked"
          value={`${locked} TDX`}
          icon={<LockKeyhole size={25} />}
          iconColor="#FF7A18"
          loading={loading}
        />

        <WalletItem
          title="Pending"
          value={`${pending} TDX`}
          icon={<Timer size={25} />}
          iconColor="#C99752"
          loading={loading}
        />
      </div>

      {error ? (
        <div className="mt-3 text-xs font-semibold text-[#F87171]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function WalletItem({
  title,
  value,
  icon,
  iconColor,
  loading,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconColor: string;
  loading?: boolean;
}) {
  return (
    <div className="flex-1 min-h-[92px] rounded-[14px] border border-[#292B33] p-[13px] flex justify-between">
      <div>
        <div className="text-sm text-[#A1A4AE]">
          {title}
        </div>

        <div className="mt-2 text-sm font-extrabold text-[#F5F5F7]">
          {loading ? (
            <Loader2
              size={14}
              className="animate-spin"
            />
          ) : (
            value
          )}
        </div>
      </div>

      <div style={{ color: iconColor }}>
        {icon}
      </div>
    </div>
  );
}
