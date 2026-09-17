// frontend/src/admin/screens/AdminDashboardcontent.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import AdminMetricCard from '../components/AdminMetricCard';
import { AdminService } from '../services/admin.service';
import type {
  AdminDashboardMetrics,
  AdminMetricApiSource,
  AdminMetricAvailability,
  AdminUserMetricKey,
  AdminMetricValue,
} from '../types/admin.types';
import { ErrorState, Skeleton } from '../../components/ui';

type MetricStatus = 'loading' | 'success' | 'error' | 'empty';

const NO_AUTHORITATIVE_API_REASON = 'No existing authoritative API';

const USER_METRIC_KEYS: AdminUserMetricKey[] = [
  'totalUsers',
  'activeUsers24h',
  'newUsersToday',
  'newUsers7d',
  'newUsers30d',
  'suspendedUsers',
  'inactiveUsers',
  'tradingUsers',
];

const USER_METRIC_LABELS: Record<AdminUserMetricKey, string> = {
  totalUsers: 'Total Users',
  activeUsers24h: 'Active Users (24h)',
  newUsersToday: 'New Users (Today)',
  newUsers7d: 'New Users (7d)',
  newUsers30d: 'New Users (30d)',
  suspendedUsers: 'Suspended Users',
  inactiveUsers: 'Inactive Users',
  tradingUsers: 'Trading Users',
};

function formatTokenAmount(amount: string | number, symbol: 'TDX' | 'USDT'): string {
  const numericValue = Number(amount);
  if (!Number.isFinite(numericValue)) {
    return `0.00 ${symbol}`;
  }
  return `${numericValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} ${symbol}`;
}

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await AdminService.getDashboardMetrics();
      setMetrics(data);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setMetrics(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const isMetricEmpty = useCallback((value: AdminMetricValue) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '' || value.trim().toUpperCase() === 'N/A';
    return false;
  }, []);

  const getMetricStatus = useCallback(
    (value: AdminMetricValue, source?: AdminMetricApiSource): MetricStatus => {
      if (isLoading && !metrics) return 'loading';
      if (source && metrics?.errors[source]) return 'error';
      if (isMetricEmpty(value)) return 'empty';
      return 'success';
    },
    [isLoading, isMetricEmpty, metrics],
  );

  const getUserMetricAvailability = useCallback(
    (metric: AdminUserMetricKey): AdminMetricAvailability | undefined => {
      return metrics?.users.availability?.[metric];
    },
    [metrics],
  );

  const getUserMetricStatus = useCallback(
    (metric: AdminUserMetricKey, value: AdminMetricValue): MetricStatus => {
      if (isLoading && !metrics) return 'loading';
      if (metrics?.errors.users) return 'error';

      const availability = getUserMetricAvailability(metric);
      if (availability && availability.available === false) {
        return 'empty';
      }

      if (isMetricEmpty(value)) return 'empty';
      return 'success';
    },
    [getUserMetricAvailability, isLoading, isMetricEmpty, metrics],
  );

  const getUserMetricSubtitle = useCallback(
    (metric: AdminUserMetricKey): string | undefined => {
      if (metrics?.errors.users) return metrics.errors.users;

      const availability = getUserMetricAvailability(metric);
      if (availability && availability.available === false) {
        return availability.reason ?? NO_AUTHORITATIVE_API_REASON;
      }

      return undefined;
    },
    [getUserMetricAvailability, metrics],
  );

  const getMetricSubtitle = useCallback(
    (source?: AdminMetricApiSource, options?: { noAuthoritativeApi?: boolean }): string | undefined => {
      if (source && metrics?.errors[source]) return metrics.errors[source];
      if (options?.noAuthoritativeApi) return NO_AUTHORITATIVE_API_REASON;
      return undefined;
    },
    [metrics],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Dashboard</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">Platform overview and operational status</p>
          </div>
          <button
            onClick={() => void loadMetrics()}
            className="flex h-9 items-center gap-1.5 rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-xs font-bold text-[#E4E5E8] transition-colors hover:bg-[#15161C]"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </section>

      {/* Loading State */}
      {isLoading && !metrics && (
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`metric-skeleton-${i}`} className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-3 h-7 w-24" />
                <Skeleton className="mt-2 h-3 w-36" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <ErrorState
          title="Unable to load admin metrics"
          description={error}
          onRetry={loadMetrics}
        />
      )}

      {/* Metrics */}
      {!error && metrics && (
        <>
          {/* Platform Metrics */}
          <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
            <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Platform</h2>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {USER_METRIC_KEYS.map((key) => (
                <AdminMetricCard
                  key={key}
                  title={USER_METRIC_LABELS[key]}
                  value={metrics.users[key] ?? null}
                  status={getUserMetricStatus(key, metrics.users[key] ?? null)}
                  subtitle={getUserMetricSubtitle(key)}
                />
              ))}
              <AdminMetricCard
                title="Available Liquidity"
                value={metrics.liquidity.availableLiquidity ?? null}
                status={getMetricStatus(metrics.liquidity.availableLiquidity ?? null, 'pulseLiquidity')}
                subtitle={getMetricSubtitle('pulseLiquidity')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Reserved Liquidity"
                value={metrics.liquidity.reservedLiquidity ?? null}
                status={getMetricStatus(metrics.liquidity.reservedLiquidity ?? null, 'pulseLiquidity')}
                subtitle={getMetricSubtitle('pulseLiquidity')}
                onRetry={loadMetrics}
              />
            </div>
          </section>

          {/* Pulse Trade Metrics */}
          <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
            <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Pulse Trade</h2>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AdminMetricCard
                title="Platform TDX Balance"
                value={metrics.liquidity.platformTdxBalance ?? null}
                status={getMetricStatus(metrics.liquidity.platformTdxBalance ?? null, 'pulseLiquidity')}
                subtitle={getMetricSubtitle('pulseLiquidity')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Open Exposure"
                value={metrics.liquidity.openTradeExposure ?? null}
                status={getMetricStatus(metrics.liquidity.openTradeExposure ?? null, 'pulseLiquidity')}
                subtitle={getMetricSubtitle('pulseLiquidity')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Open Trades"
                value={metrics.trades.openTrades ?? null}
                status={getMetricStatus(metrics.trades.openTrades ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Settled Trades"
                value={metrics.trades.settledTrades ?? null}
                status={getMetricStatus(metrics.trades.settledTrades ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Settlement Delayed"
                value={metrics.trades.settlementDelayed ?? null}
                status={getMetricStatus(metrics.trades.settlementDelayed ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
                tone="warning"
              />
              <AdminMetricCard
                title="Settlement Failed"
                value={metrics.trades.settlementFailed ?? null}
                status={getMetricStatus(metrics.trades.settlementFailed ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
                tone="warning"
              />
              <AdminMetricCard
                title="Total Stake"
                value={metrics.trades.totalStake ?? null}
                status={getMetricStatus(metrics.trades.totalStake ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Total Payout"
                value={metrics.trades.totalPayout ?? null}
                status={getMetricStatus(metrics.trades.totalPayout ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Total Profit"
                value={metrics.trades.totalProfit ?? null}
                status={getMetricStatus(metrics.trades.totalProfit ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Today Volume"
                value={metrics.trades.todaysTradeVolume ?? null}
                status={getMetricStatus(metrics.trades.todaysTradeVolume ?? null, 'pulseTrades')}
                subtitle={getMetricSubtitle('pulseTrades')}
                onRetry={loadMetrics}
              />
            </div>
          </section>

          {/* Operations Metrics */}
          <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
            <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Operations</h2>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AdminMetricCard
                title="Total Withdrawals"
                value={metrics.withdrawals.totalWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.totalWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Today's Withdrawals"
                value={metrics.withdrawals.todaysWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.todaysWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Today's Withdrawal Volume"
                value={metrics.withdrawals.todaysWithdrawalsVolume ?? null}
                status={getMetricStatus(metrics.withdrawals.todaysWithdrawalsVolume ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Completed Withdrawals"
                value={metrics.withdrawals.completedWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.completedWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Failed Withdrawals"
                value={metrics.withdrawals.failedWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.failedWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                tone="warning"
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Rejected Withdrawals"
                value={metrics.withdrawals.rejectedWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.rejectedWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                tone="warning"
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Cancelled Withdrawals"
                value={metrics.withdrawals.cancelledWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.cancelledWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Withdrawal Vault Fund"
                value={metrics.withdrawals.withdrawalVaultFund ?? null}
                status={getMetricStatus(metrics.withdrawals.withdrawalVaultFund ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Pending Withdrawals"
                value={metrics.withdrawals.pendingWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.pendingWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                tone="warning"
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Processing Withdrawals"
                value={metrics.withdrawals.processingWithdrawals ?? null}
                status={getMetricStatus(metrics.withdrawals.processingWithdrawals ?? null, 'withdrawals')}
                subtitle={getMetricSubtitle('withdrawals')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Pending Deposits"
                value={metrics.deposits.pendingDeposits ?? null}
                status={getMetricStatus(metrics.deposits.pendingDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                tone="warning"
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Total Deposits"
                value={metrics.deposits.totalDeposits ?? null}
                status={getMetricStatus(metrics.deposits.totalDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Today's Deposits"
                value={metrics.deposits.todaysDeposits ?? null}
                status={getMetricStatus(metrics.deposits.todaysDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Today's Deposit Volume"
                value={metrics.deposits.todaysDepositsVolume ?? null}
                status={getMetricStatus(metrics.deposits.todaysDepositsVolume ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Confirming Deposits"
                value={metrics.deposits.confirmingDeposits ?? null}
                status={getMetricStatus(metrics.deposits.confirmingDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Completed Deposits"
                value={metrics.deposits.completedDeposits ?? null}
                status={getMetricStatus(metrics.deposits.completedDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Failed Deposits"
                value={metrics.deposits.failedDeposits ?? null}
                status={getMetricStatus(metrics.deposits.failedDeposits ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                tone="warning"
                onRetry={loadMetrics}
              />
              <AdminMetricCard
                title="Deposit Vault Fund"
                value={metrics.deposits.depositVaultFund ?? null}
                status={getMetricStatus(metrics.deposits.depositVaultFund ?? null, 'deposits')}
                subtitle={getMetricSubtitle('deposits')}
                onRetry={loadMetrics}
              />
            </div>
          </section>

          {/* Source Info */}
          <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] px-4 py-3 text-xs text-[#A1A4AE]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p>
                Source: <span className="font-bold text-[#F5F5F7]">{metrics.source ?? 'N/A'}</span>
              </p>
              <p>
                Fetched at:{' '}
                <span className="font-bold text-[#F5F5F7]">
                  {metrics.fetchedAt ? new Date(metrics.fetchedAt).toLocaleString() : 'N/A'}
                </span>
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}