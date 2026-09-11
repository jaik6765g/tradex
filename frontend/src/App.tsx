// src/App.tsx

import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppKitProvider } from '@reown/appkit/react';

import { wagmiConfig, webWalletConfig } from './wallet/config/webWallet';
import { WalletProvider } from './wallet/context/WalletContext';

import Header from './shared/components/layout/Header';
import BottomNav from './shared/components/layout/BottomNav';

import Home from './home/screens/HomeScreen';
import Marketplace from './marketplace/screens/MarketplaceScreen';
import LottoPage from './marketplace/games/lotto/LottoPage';

// ✅ Import TradeScreen
import TradeScreen from './trade/screens/TradeScreen';
import PulseTradeScreen from './trade/pulse/screens/PulseTradeScreen';
import BotTradeScreen from './trade/bot/BotTradeScreen';

import Referral from './referral/screens/ReferralScreen';
import Profile from './profile/screens/ProfileScreen';
import Deposit from './wallet/deposit/screens/DepositScreen';
import Withdrawal from './wallet/withdrawal/screens/WithdrawalScreen';
import Transactions from './wallet/transactions/screens/TransactionsScreen';
import AdminDashboardScreen from './admin/screens/AdminDashboardScreen';
import { useWalletContext } from './wallet/context/WalletContext';
import { Loader } from './components/ui';
import AboutScreen from './profile/screens/AboutScreen';

const queryClient = new QueryClient();

function AdminOnlyRoute({
  children,
}: {
  children: React.ReactElement;
}) {
  const {
    isAdmin,
    isAuthenticated,
    isAuthenticating,
  } = useWalletContext();

  if (isAuthenticating) {
    return (
      <div className="min-h-[60vh] bg-[#F8FAFC] px-4 py-8">
        <div className="mx-auto w-full max-w-[1100px] rounded-[20px] border border-[#E5E7EB] bg-white p-8">
          <Loader label="Checking admin access..." />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppKitProvider {...webWalletConfig} networks={webWalletConfig.networks as any}>
          <WalletProvider>
            <div className={`tradex-app ${isAdminRoute ? 'tradex-app--admin' : ''}`}>
              {!isAdminRoute ? <Header /> : null}
              <main className={`tradex-main ${isAdminRoute ? 'tradex-main--admin' : ''}`}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/marketplace" element={<Marketplace />} />

                  {/* Lotto game — full page (Header + BottomNav visible like other screens) */}
                  <Route path="/lotto" element={<LottoPage />} />

                  {/* ✅ Trade route */}
                  <Route path="/trade" element={<TradeScreen />} />
                  <Route path="/pulse-trade" element={<PulseTradeScreen />} />
                  <Route path="/bot-trade" element={<BotTradeScreen />} />
                  
                  <Route path="/referral" element={<Referral />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/about" element={<AboutScreen />} />
                  <Route
                    path="/admin/*"
                    element={(
                      <AdminOnlyRoute>
                        <AdminDashboardScreen />
                      </AdminOnlyRoute>
                    )}
                  />
                  <Route path="/deposit" element={<Deposit />} />
                  <Route path="/withdraw" element={<Withdrawal />} />
                  <Route path="/transactions" element={<Transactions />} />
                </Routes>
              </main>
              {!isAdminRoute ? <BottomNav /> : null}
            </div>
          </WalletProvider>
        </AppKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}