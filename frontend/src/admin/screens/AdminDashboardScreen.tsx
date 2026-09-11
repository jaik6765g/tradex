// frontend/src/admin/screens/AdminDashboardScreen.tsx

import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Bot,
  Droplets,
  Gauge,
  Home,
  LogOut,
  Menu,
  PieChart,
  Settings,
  Shield,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react';

import { useWalletContext } from '../../wallet/context/WalletContext';
import { Button, formatAddress } from '../../components/ui';

// ✅ Import all screens
import AdminOverviewScreen from './AdminOverviewScreen';
import AdminDashboardContent from './AdminDashboardContent';
import AdminUsersScreen from './AdminUsersScreen';
import AdminWithdrawalsScreen from './AdminWithdrawalsScreen';
import AdminDepositsScreen from './AdminDepositsScreen';
import AdminPulseTradeScreen from './AdminPulseTradeScreen';
import AdminLedgerScreen from './AdminLedgerScreen';
import AdminReferralsScreen from './AdminReferralsScreen';
import AdminLiquidityScreen from './AdminLiquidityScreen';
import AdminRiskSecurityScreen from './AdminRiskSecurityScreen';
import AdminAuditLogsScreen from './AdminAuditLogsScreen';
import AdminSettingsScreen from './AdminSettingsScreen';
import AdminBotSettingsScreen from './AdminBotSettingsScreen';
import AdminLottoManagerScreen from './AdminLottoManagerScreen';

interface AdminNavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  implemented?: boolean;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', path: '/admin', icon: Home, implemented: true },
  { label: 'Overview', path: '/admin/overview', icon: PieChart, implemented: true },
  { label: 'Users', path: '/admin/users', icon: Users, implemented: true },
  { label: 'Pulse Trade', path: '/admin/pulse-trade', icon: Gauge, implemented: true },
  { label: 'Deposits', path: '/admin/deposits', icon: Wallet, implemented: true },
  { label: 'Withdrawals', path: '/admin/withdrawals', icon: ArrowRight, implemented: true },
  { label: 'Liquidity', path: '/admin/liquidity', icon: Droplets, implemented: true },
  { label: 'Ledger', path: '/admin/ledger', icon: Bell, implemented: true },
  { label: 'Referrals', path: '/admin/referrals', icon: Users, implemented: true },
  { label: 'Bot Settings', path: '/admin/bot-settings', icon: Bot, implemented: true },
  { label: 'Lotto Manager', path: '/admin/lotto', icon: Trophy, implemented: true },
  { label: 'Risk & Security', path: '/admin/risk-security', icon: Shield, implemented: true },
  { label: 'Audit Logs', path: '/admin/audit-logs', icon: AlertCircle, implemented: true },
  { label: 'Settings', path: '/admin/settings', icon: Settings, implemented: true },
];

function AdminSidebar({ onItemClick }: { onItemClick?: () => void }) {
  const location = useLocation();

  return (
    <aside className="w-full md:h-[calc(100vh-80px)] md:overflow-y-auto md:pr-1">
      <nav className="space-y-1">
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.path === '/admin'
            ? location.pathname === '/admin'
            : location.pathname.startsWith(item.path);

          if (item.implemented) {
            return (
              <Link
                key={item.label}
                to={item.path}
                onClick={onItemClick}
                className={`group flex items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-sm font-bold transition-all duration-200 ${
                  isActive
                    ? 'border-[#1D2939] bg-[#111827] text-white shadow-sm'
                    : 'border-transparent text-[#344054] hover:border-[#E4E7EC] hover:bg-white hover:shadow-sm'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon
                    size={16}
                    className={`transition-colors ${
                      isActive ? 'text-white' : 'text-[#667085] group-hover:text-[#111827]'
                    }`}
                  />
                  {item.label}
                </span>
                {isActive && (
                  <span className="text-[10px] font-black uppercase tracking-wide text-[#F5B800]">
                    Active
                  </span>
                )}
              </Link>
            );
          }

          return (
            <div
              key={item.label}
              className="flex cursor-not-allowed items-center justify-between gap-2 rounded-[12px] border border-transparent px-3 py-2 text-sm text-[#667085] opacity-60"
            >
              <span className="inline-flex items-center gap-2 font-semibold">
                <Icon size={16} className="text-[#98A2B3]" />
                {item.label}
              </span>
              <span className="rounded-full border border-[#E4E7EC] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#667085]">
                Coming Soon
              </span>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#101828]/45 md:hidden">
      <div className="h-full w-[86%] max-w-[320px] overflow-y-auto border-r border-[#E4E7EC] bg-[#F8FAFC] p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-[#111827]">Admin Menu</p>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E4E7EC] bg-white text-[#475467] hover:bg-[#F9FAFB]"
          >
            <X size={16} />
          </button>
        </div>
        <AdminSidebar onItemClick={onClose} />
      </div>
    </div>
  );
}

export default function AdminDashboardScreen() {
  const location = useLocation();
  const { address, authUser, logout } = useWalletContext();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isOverviewRoute = location.pathname.startsWith('/admin/overview');
  const isUsersRoute = location.pathname.startsWith('/admin/users');
  const isWithdrawalsRoute = location.pathname.startsWith('/admin/withdrawals');
  const isDepositsRoute = location.pathname.startsWith('/admin/deposits');
  const isPulseTradeRoute = location.pathname.startsWith('/admin/pulse-trade');
  const isLedgerRoute = location.pathname.startsWith('/admin/ledger');
  const isLiquidityRoute = location.pathname.startsWith('/admin/liquidity');
  const isReferralsRoute = location.pathname.startsWith('/admin/referrals');
  const isBotSettingsRoute = location.pathname.startsWith('/admin/bot-settings');
  const isLottoRoute = location.pathname.startsWith('/admin/lotto');
  const isRiskSecurityRoute = location.pathname.startsWith('/admin/risk-security');
  const isAuditLogsRoute = location.pathname.startsWith('/admin/audit-logs');
  const isSettingsRoute = location.pathname.startsWith('/admin/settings');

  const isDashboardRoute = !isOverviewRoute && !isUsersRoute && !isWithdrawalsRoute &&
    !isDepositsRoute && !isPulseTradeRoute && !isLedgerRoute && !isLiquidityRoute &&
    !isReferralsRoute && !isBotSettingsRoute && !isLottoRoute && !isRiskSecurityRoute && !isAuditLogsRoute && !isSettingsRoute;

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  // ✅ Determine what to render
  let content;
  if (isOverviewRoute) content = <AdminOverviewScreen />;
  else if (isUsersRoute) content = <AdminUsersScreen />;
  else if (isWithdrawalsRoute) content = <AdminWithdrawalsScreen />;
  else if (isDepositsRoute) content = <AdminDepositsScreen />;
  else if (isPulseTradeRoute) content = <AdminPulseTradeScreen />;
  else if (isLedgerRoute) content = <AdminLedgerScreen />;
  else if (isLiquidityRoute) content = <AdminLiquidityScreen />;
  else if (isReferralsRoute) content = <AdminReferralsScreen />;
  else if (isBotSettingsRoute) content = <AdminBotSettingsScreen />;
  else if (isLottoRoute) content = <AdminLottoManagerScreen />;
  else if (isRiskSecurityRoute) content = <AdminRiskSecurityScreen />;
  else if (isAuditLogsRoute) content = <AdminAuditLogsScreen />;
  else if (isSettingsRoute) content = <AdminSettingsScreen />;
  else content = <AdminDashboardContent />;

  return (
    <div className="min-h-full bg-[#F8FAFC] text-[#111827]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-3 pb-4 pt-3 sm:px-4 lg:px-5">
        {/* Header */}
        <header className="sticky top-0 z-40 mb-3 rounded-[16px] border border-[#E5E7EB] bg-white/95 px-3 py-2.5 shadow-[0_6px_24px_rgba(16,24,40,0.06)] backdrop-blur sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#E4E7EC] text-[#475467] hover:bg-[#F9FAFB] md:hidden"
              >
                <Menu size={18} />
              </button>
              <div>
                <p className="text-sm font-black tracking-tight sm:text-lg">TradeX Admin</p>
                <p className="text-[11px] text-[#667085]">Operations control panel</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="flex max-w-[150px] items-center gap-2 rounded-[10px] border border-[#E4E7EC] bg-[#F8FAFC] px-2 py-1.5 sm:max-w-[190px] sm:px-2.5">
                <span className="relative h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#12B76A] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#12B76A]" />
                </span>
                <div className="min-w-0 text-right leading-tight">
                  <p className="text-[11px] font-black text-[#111827]">Admin</p>
                  <p className="truncate text-[10px] text-[#667085]">
                    {formatAddress(authUser?.walletAddress || address || '') || 'Unknown wallet'}
                  </p>
                </div>
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={handleLogout}
                loading={isLoggingOut}
              >
                <LogOut size={14} className="mr-1.5" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Mobile Menu */}
        <MobileMenu isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />

        {/* Main Layout */}
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
          {/* Sidebar */}
          <section className="sticky top-[84px] hidden self-start rounded-[16px] border border-[#E5E7EB] bg-white p-3 md:block">
            <AdminSidebar />
          </section>

          {/* Main Content */}
          <section className="min-w-0">{content}</section>
        </div>
      </div>
    </div>
  );
}