// src/App.tsx

import React from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
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
import MyProfileScreen from './profile/screens/MyProfileScreen';
import DepositGatewayScreen from './wallet/deposit/gateway/DepositGatewayScreen';
import Withdrawal from './wallet/withdrawal/screens/WithdrawalScreen';
import Transactions from './wallet/transactions/screens/TransactionsScreen';
import AdminDashboardScreen from './admin/screens/AdminDashboardScreen';
import { useWalletContext } from './wallet/context/WalletContext';
import { Loader } from './components/ui';
import AboutScreen from './profile/screens/AboutScreen';
import { AuthProvider, useAppAuth } from './auth/authContext';
import LoginScreen from './auth/screens/LoginScreen';
import SignupScreen from './auth/screens/SignupScreen';
import ForgotPasswordScreen from './auth/screens/ForgotPasswordScreen';
import AdminLoginScreen from './auth/screens/AdminLoginScreen';
import AdminMfaSetupScreen from './auth/screens/AdminMfaSetupScreen';
import AdminMfaVerifyScreen from './auth/screens/AdminMfaVerifyScreen';
import { AdminSecurityProvider, useAdminSecurity } from './admin/context/AdminSecurityContext';

const queryClient = new QueryClient();

function AdminOnlyRoute({
  children,
}: {
  children: React.ReactElement;
}) {
  const location = useLocation();
  const {
    isAdmin,
    isAuthenticated,
    isAuthenticating,
  } = useWalletContext();

  if (isAuthenticating) {
    return (
      <div className="min-h-[60vh] bg-[#111217] px-4 py-8">
        <div className="mx-auto w-full max-w-[1100px] rounded-[20px] border border-[#292B33] bg-[#15161C] p-8">
          <Loader label="Checking admin access..." />
        </div>
      </div>
    );
  }

  // UX-only gates. The backend JwtAuthGuard + AdminGuard re-verifies every
  // admin API call server-side (role + Supabase AAL2), so forged frontend
  // state can never grant access.
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] bg-[#111217] px-4 py-8">
        <div className="mx-auto w-full max-w-[640px] rounded-[20px] border border-[#4A2323] bg-[#15161C] p-8 text-center">
          <p className="text-base font-black text-[#F5F5F7]">Admin access denied</p>
          <p className="mt-2 text-sm text-[#A1A4AE]">
            This account is not authorized for the admin panel. Server verification is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Context comes from the single <AdminSecurityProvider> mounted by
    // AdminArea above this route (App.tsx). This gate only consumes it —
    // it must never mount a second provider.
    <AdminMfaGate>{children}</AdminMfaGate>
  );
}

/**
 * Backend-verified MFA routing (UX only). The security STAGE comes from
 * GET /admin/auth/verify — computed server-side from users.role/status and the
 * Supabase-verified AAL claim. No localStorage / query / header MFA flag can
 * change it; every admin API still independently requires AAL2.
 */
function AdminMfaGate({
  children,
  requireReady = true,
}: {
  children: React.ReactElement;
  requireReady?: boolean;
}) {
  const location = useLocation();
  const { loading, stage } = useAdminSecurity();

  if (loading || stage === 'UNKNOWN') {
    return (
      <div className="min-h-[60vh] bg-[#111217] px-4 py-8">
        <div className="mx-auto w-full max-w-[1100px] rounded-[20px] border border-[#292B33] bg-[#15161C] p-8">
          <Loader label="Verifying admin two-factor authentication..." />
        </div>
      </div>
    );
  }

  if (stage === 'NOT_ADMIN') {
    return (
      <div className="min-h-[60vh] bg-[#111217] px-4 py-8">
        <div className="mx-auto w-full max-w-[640px] rounded-[20px] border border-[#4A2323] bg-[#15161C] p-8 text-center">
          <p className="text-base font-black text-[#F5F5F7]">Admin access denied</p>
          <p className="mt-2 text-sm text-[#A1A4AE]">
            This account is not authorized for the admin panel. Server verification is required.
          </p>
        </div>
      </div>
    );
  }

  if (!requireReady) {
    // MFA bootstrap routes render UNDER the provider but must never be
    // bounced back to themselves by the READY gate — they ARE the MFA flow.
    return children;
  }

  if (stage === 'MFA_SETUP') {
    return <Navigate to="/admin/mfa/setup" replace state={{ from: location.pathname }} />;
  }

  if (stage === 'MFA_VERIFY') {
    return <Navigate to="/admin/mfa/verify" replace state={{ from: location.pathname }} />;
  }

  return children;
}

/**
 * Single application-level admin security scope.
 *
 * INVARIANT (the crash fix): exactly ONE <AdminSecurityProvider> mount exists
 * in the tree, and EVERY route whose element calls `useAdminSecurity()`
 * renders underneath it:
 *   - /admin/mfa/setup  -> provider -> gate(requireReady=false) -> screen
 *   - /admin/mfa/verify -> provider -> gate(requireReady=false) -> screen
 *   - /admin/*          -> AdminOnlyRoute -> provider -> gate -> dashboard
 *     (incl. /admin/settings/security via AdminDashboardScreen)
 *
 * /admin/login stays OUTSIDE the provider on purpose: AdminLoginScreen no
 * longer consumes the context (it drives post-login routing from the direct
 * verifyAdminAccess() response), so an unauthenticated operator can always
 * reach the login page and a context failure can never lock them out.
 *
 * Security note (unchanged): the provider only exposes backend-verified state
 * for UX routing; every admin API is independently gated server-side by
 * JwtAuthGuard + AdminGuard (+ the AAL2 MFA layer).
 */
function AdminArea({ requireReady = true }: { requireReady?: boolean }) {
  return (
    <AdminSecurityProvider>
      <AdminMfaGate requireReady={requireReady}>
        <Outlet />
      </AdminMfaGate>
    </AdminSecurityProvider>
  );
}

export default function App() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isAuthPath =
    location.pathname === '/login' ||
    location.pathname === '/signup' ||
    location.pathname === '/forgot-password' ||
    location.pathname === '/admin/login';
  const hideChrome = isAdminRoute || isAuthPath;

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppKitProvider {...webWalletConfig} networks={webWalletConfig.networks as any}>
          <AuthProvider>
            <WalletProvider>
              <div className={`tradex-app ${isAdminRoute ? 'tradex-app--admin' : ''}`}>
                {!hideChrome ? <Header /> : null}
                <main className={`tradex-main ${isAdminRoute ? 'tradex-main--admin' : ''}`}>
                  <AuthGate>
                    <Routes>
                      <Route path="/login" element={<LoginScreen />} />
                      <Route path="/signup" element={<SignupScreen />} />
                      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
                      <Route path="/admin/login" element={<AdminLoginScreen />} />
                      {/* MFA bootstrap screens: rendered UNDER the single
                          AdminSecurityProvider via AdminArea so
                          useAdminSecurity() can never throw. requireReady is
                          off here because these screens ARE the MFA flow. */}
                      <Route element={<AdminArea requireReady={false} />}>
                        <Route path="/admin/mfa/setup" element={<AdminMfaSetupScreen />} />
                        <Route path="/admin/mfa/verify" element={<AdminMfaVerifyScreen />} />
                      </Route>
                      {/* Every other /admin/* path: single provider via
                          AdminArea, then the auth/role gate, then the READY
                          gate — exactly ONE provider mount on this path. */}
                      <Route element={<AdminArea requireReady={true} />}>
                        <Route
                          path="/admin/*"
                          element={(
                            <AdminOnlyRoute>
                              <AdminDashboardScreen />
                            </AdminOnlyRoute>
                          )}
                        />
                      </Route>

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
                      <Route path="/my-profile" element={<MyProfileScreen />} />
                      <Route path="/about" element={<AboutScreen />} />
                      {/* Every other /admin/* path: single provider via
                          AdminArea, then the auth/role gate, then the READY
                          gate — exactly ONE provider mount on this path. */}
                      <Route element={<AdminArea requireReady={true} />}>
                        <Route
                          path="/admin/*"
                          element={(
                            <AdminOnlyRoute>
                              <AdminDashboardScreen />
                            </AdminOnlyRoute>
                          )}
                        />
                      </Route>
                      <Route path="/deposit" element={<DepositGatewayScreen />} />
                      <Route path="/withdraw" element={<Withdrawal />} />
                      <Route path="/transactions" element={<Transactions />} />
                    </Routes>
                  </AuthGate>
                </main>
                {!hideChrome ? <BottomNav /> : null}
              </div>
            </WalletProvider>
          </AuthProvider>
        </AppKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AuthGate({ children }: { children: React.ReactElement }) {
  const location = useLocation();
  const { isAuthenticated, isAuthenticating } = useAppAuth();

  const isAdminLogin = location.pathname === '/admin/login';
  const isAdminRoute = location.pathname.startsWith('/admin');
  // /admin/login + the MFA bootstrap screens render without a verified session.
  const isAdminMfaFlow =
    location.pathname === '/admin/mfa/setup' || location.pathname === '/admin/mfa/verify';
  const isAuthPath =
    location.pathname === '/login' ||
    location.pathname === '/signup' ||
    location.pathname === '/forgot-password' ||
    isAdminLogin ||
    isAdminMfaFlow;

  if (isAuthPath) {
    return children;
  }

  if (isAuthenticating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111217]">
        <Loader label="Loading…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Unauthenticated /admin/* deep links land on the admin login page.
    if (isAdminRoute) {
      return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
    }
    return <Navigate to="/login" replace />;
  }

  return children;
}