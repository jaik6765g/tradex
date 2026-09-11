import React from 'react';

import { useBalance } from '../../wallet/hooks/useWallet';

import PromoCarousel from '../components/PromoCarousel';
import QuickActions from '../components/QuickActions';
import BalanceOverview from '../components/BalanceOverview';
import TdxWalletCard from '../components/TdxWalletCard';
import RecentActivity from '../components/RecentActivity';

export default function Home() {
  const {
    balance,
    loading,
    error,
    refresh,
  } = useBalance();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">

      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4">
        <div className="space-y-4">
          <BalanceOverview
            balance={balance}
            balanceLoading={loading}
            onRefreshBalance={refresh}
          />

          <PromoCarousel />

          <QuickActions />

          <TdxWalletCard
            balance={balance}
            loading={loading}
            error={error}
          />

          <RecentActivity />
        </div>
      </main>

    </div>
  );
}
