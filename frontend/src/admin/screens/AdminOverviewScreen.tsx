import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Wallet, Coins, TrendingUp, TrendingDown, Activity, DollarSign, PieChart,
  Shield, AlertCircle, CheckCircle, ArrowUpDown, BarChart3, Database, Plus, Minus,
} from 'lucide-react';
import { AdminService } from '../services/admin.service';
import type {
  AdminFinancialOverviewResponse,
  FinancialPoolStatus,
  AdminDashboardMetrics,
} from '../types/admin.types';
import { Badge, Button, Card, ErrorState, Skeleton } from '../../components/ui';

interface OverviewData {
  financial: AdminFinancialOverviewResponse | null;
  dashboard: AdminDashboardMetrics | null;
  financialError: string | null;
  dashboardError: string | null;
}

const STATUS_CONFIG: Record<FinancialPoolStatus, { label: string; className: string; icon: React.ReactNode }> = {
  ACTIVE: { label: 'Active', className: 'bg-[#ECFDF3] text-[#027A48] border border-[#D1FADF]', icon: <CheckCircle size={14} /> },
  LOW: { label: 'Low', className: 'bg-[#FFFBEB] text-[#B54708] border border-[#FEF0C7]', icon: <AlertCircle size={14} /> },
  WARNING: { label: 'Warning', className: 'bg-[#FFFBEB] text-[#B54708] border border-[#FEF0C7]', icon: <AlertCircle size={14} /> },
  EMPTY: { label: 'Empty', className: 'bg-[#F2F4F7] text-[#667085] border border-[#D0D5DD]', icon: <Activity size={14} /> },
  PAUSED: { label: 'Paused', className: 'bg-[#FEF2F2] text-[#B42318] border border-[#FECACA]', icon: <AlertCircle size={14} /> },
  ERROR: { label: 'Error', className: 'bg-[#FEF2F2] text-[#B42318] border border-[#FECACA]', icon: <AlertCircle size={14} /> },
};
type DiffValue = string | number | null | undefined;

function parseTdx(v: DiffValue): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function StatusBadge({ status }: { status: FinancialPoolStatus }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.ERROR;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.className}`}>
      {c.icon}{c.label}
    </span>
  );
}

function MetricRow({ label, value, icon, valueClassName }: { label: string; value: string; icon?: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#F2F4F7] last:border-0">
      <span className="text-sm text-[#667085]">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-semibold text-[#111827] ${valueClassName ?? ''}`}>{value}</span>
        {icon}
      </div>
    </div>
  );
}

function DiffRow({ label, value }: { label: string; value: number | null }) {
  // null = one of the reconciliation sources unavailable -> N/A, never 0.
  if (value === null) {
    return <MetricRow label={label} value="N/A" />;
  }
  return (
    <MetricRow
      label={label}
      value={`${diffPrefix(value)}${formatTdx(value).replace('TDX', '').trim()} TDX`}
      valueClassName={diffColor(value)}
      icon={value > 0 ? <TrendingUp size={16} className="text-[#027A48]" /> : value < 0 ? <TrendingDown size={16} className="text-[#B42318]" /> : <ArrowUpDown size={16} className="text-[#98A2B3]" />}
    />
  );
}

function SectionError({ source, error }: { source: string; error?: string }) {
  return (
    <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-center">
      <AlertCircle size={20} className="mx-auto text-[#B42318]" />
      <p className="mt-1 text-xs font-medium text-[#B42318]">Source unavailable</p>
      <p className="mt-0.5 text-[10px] text-[#98A2B3]">{source}</p>
      {error && <p className="mt-1 text-[10px] text-[#B42318]">{error}</p>}
    </div>
  );
}

function PoolCard({
  title, icon, status, rows, source, error, available,
}: {
  title: string; icon: React.ReactNode; status: FinancialPoolStatus;
  rows: Array<{ label: string; value: string; valueClassName?: string }>;
  source: string; error?: string; available: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">{icon}<h3 className="text-sm font-bold text-[#111827]">{title}</h3></div>
        <StatusBadge status={status} />
      </div>
      {!available ? <SectionError source={source} error={error} /> : (
        <div className="space-y-0">
          {rows.map((r) => <MetricRow key={r.label} label={r.label} value={r.value} valueClassName={r.valueClassName} />)}
        </div>
      )}
    </Card>
  );
}
function formatTdx(v: DiffValue): string {
  // null/undefined means "source unavailable" - NEVER render a fake 0.
  // Real zeros from the DB arrive as numeric strings ("0", "0.000...").
  if (v === null || v === undefined) return 'N/A';
  const num = parseTdx(v);
  if (!Number.isFinite(num)) return 'N/A';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B TDX`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M TDX`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K TDX`;
  return `${sign}${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TDX`;
}

function formatUsdt(v: DiffValue): string {
  if (v === null || v === undefined) return 'N/A';
  const n = parseTdx(v);
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : 'N/A';
}

function formatCount(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'N/A';
  if (!Number.isFinite(v)) return 'N/A';
  return Math.trunc(v).toLocaleString();
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const p = new Date(v);
  return Number.isNaN(p.getTime()) ? '—' : p.toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return `${v.toFixed(2)}%`;
}

function diffColor(v: number): string {
  return v > 0 ? 'text-[#027A48]' : v < 0 ? 'text-[#B42318]' : 'text-[#667085]';
}

function diffPrefix(v: number): string {
  return v > 0 ? '+' : '';
}

function vaultBal(vault: { balance: string | null; available: boolean } | undefined): DiffValue {
  // null = vault source unavailable -> renders N/A, never a fake 0.
  if (!vault?.available) return null;
  return vault.balance;
}

function vaultStatus(vault: { balance: string | null; available: boolean; error?: string } | undefined): FinancialPoolStatus {
  if (!vault?.available) return 'ERROR';
  if (vault.error) return 'WARNING';
  return parseTdx(vault.balance) <= 0 ? 'EMPTY' : 'ACTIVE';
}

function actIcon(type: 'ADD' | 'REMOVE') {
  return type === 'ADD' ? <Plus size={14} className="text-[#027A48]" /> : <Minus size={14} className="text-[#B42318]" />;
}

function actBadge(status: 'SUCCESS' | 'FAILED'): 'success' | 'error' {
  return status === 'SUCCESS' ? 'success' : 'error';
}
function RecentActivityTable({ items }: { items: AdminFinancialOverviewResponse['recentLiquidityActivity'] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center">
        <Activity size={24} className="mx-auto text-[#98A2B3]" />
        <p className="mt-2 text-sm text-[#667085]">No recent liquidity activity</p>
        <p className="text-xs text-[#98A2B3]">Admin ADD/REMOVE adjustments will appear here</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
      <table className="min-w-full divide-y divide-[#E5E7EB]">
        <thead className="bg-[#F9FAFB]">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Date</th>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Type</th>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Amount</th>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Source</th>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Status</th>
            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#667085]">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F2F4F7]">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-[#F9FAFB]">
              <td className="px-4 py-3 text-xs text-[#111827] font-mono">{fmtDateTime(item.date)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {actIcon(item.type)}
                  <span className="text-xs font-semibold text-[#111827]">{item.type}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-[#111827]">{formatTdx(item.amountTdx)}</td>
              <td className="px-4 py-3 text-xs text-[#667085]">{item.source}</td>
              <td className="px-4 py-3"><Badge variant={actBadge(item.status)}>{item.status}</Badge></td>
              <td className="px-4 py-3 text-xs text-[#667085] max-w-[200px] truncate">{item.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function AdminOverviewScreen() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const [financialResult, dashboardResult] = await Promise.allSettled([
      AdminService.getFinancialOverview(),
      AdminService.getDashboardMetrics(),
    ]);

    const financial = financialResult.status === 'fulfilled' ? financialResult.value : null;
    const financialError = financialResult.status === 'rejected'
      ? (financialResult.reason instanceof Error ? financialResult.reason.message : 'Financial overview unavailable')
      : null;

    const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
    const dashboardError = dashboardResult.status === 'rejected'
      ? (dashboardResult.reason instanceof Error ? dashboardResult.reason.message : 'Dashboard metrics unavailable')
      : null;

    if (!financial && !dashboard) {
      setError(financialError || dashboardError || 'Failed to load data');
      setData(null);
    } else {
      setData({ financial, dashboard, financialError, dashboardError });
      setError(null);
    }

    if (withLoader) setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => { void fetchData({ withLoader: true }); }, [fetchData]);

  const fin = data?.financial;
  const dash = data?.dashboard;
  const usersTdx = fin?.usersTdx;
  const userLedger = fin?.userLedger;
  const platformPool = fin?.platformPool;
  const adminLiquidity = fin?.adminLiquidity;
  const botLiquidity = fin?.botLiquidity;
  const lottoFeePool = fin?.lottoFeePool;
  const totals = fin?.totals;

  const platformLiquidityTdx = parseTdx(totals?.platformLiquidityTdx);
  const allUsersTdx = parseTdx(totals?.allUsersTdx);
  const totalTrackedTdx = parseTdx(totals?.totalTrackedTdx);
  // Null-safe reconciliation inputs: null source => N/A, never a fake 0 diff.
  const adminAddedTdxRaw = adminLiquidity?.available ? adminLiquidity.data?.addedTdx : null;
  const reconciliationDiff =
    totals?.platformLiquidityTdx != null && adminAddedTdxRaw != null
      ? parseTdx(totals.platformLiquidityTdx) - parseTdx(adminAddedTdxRaw)
      : null;
  // Pool Used = current pool liquidity - available, only when BOTH are real.
  const poolUsedTdx =
    totals?.platformLiquidityTdx != null && platformPool?.data?.availableTdx != null
      ? parseTdx(totals.platformLiquidityTdx) - parseTdx(platformPool.data.availableTdx)
      : null;
  const depositVaultUsdt = vaultBal(dash?.deposits?.depositVaultMeta);
  const withdrawalVaultUsdt = vaultBal(dash?.withdrawals?.withdrawalVaultMeta);
  const depositVaultStatus = vaultStatus(dash?.deposits?.depositVaultMeta);
  const withdrawalVaultStatus = vaultStatus(dash?.withdrawals?.withdrawalVaultMeta);
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={`primary-${i}`} className="h-32 w-full" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={`pool-${i}`} className="h-48 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState title="Unable to load financial overview" description={error} onRetry={() => void fetchData({ withLoader: true })} />;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#111827]">TradeX Financial Overview</h1>
          <p className="text-sm text-[#667085]">
            Complete TDX financial &amp; liquidity picture &middot; Last updated:{' '}
            {data?.financial?.fetchedAt ? new Date(data.financial.fetchedAt).toLocaleString() : 'N/A'}
          </p>
          {(data?.financialError || data?.dashboardError) && (
            <p className="mt-1 text-xs text-[#B42318]">Partial data: {data?.financialError || data?.dashboardError}</p>
          )}
        </div>
        <Button variant="secondary" size="sm" loading={refreshing} disabled={refreshing} onClick={() => void fetchData({ withLoader: false })}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {/* PRIMARY METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-full bg-[#D1FADF] flex items-center justify-center">
              <Wallet size={20} className="text-[#027A48]" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#027A48]">All Users TDX</p>
              <p className="text-[10px] text-[#667085]">Source: balances table (user balance aggregation)</p>
            </div>
          </div>
          <p className="text-3xl font-black text-[#027A48]">{formatTdx(totals?.allUsersTdx)}</p>
          {usersTdx?.available && usersTdx.data ? (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Available</p>
                <p className="text-sm font-bold text-[#111827]">{formatTdx(usersTdx.data.availableTdx)}</p>
              </div>
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Locked</p>
                <p className="text-sm font-bold text-[#111827]">{formatTdx(usersTdx.data.lockedTdx)}</p>
              </div>
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Accounts</p>
                <p className="text-sm font-bold text-[#111827]">{formatCount(usersTdx.data.accountsCount)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#B42318]">{usersTdx?.error || 'User TDX data unavailable'}</p>
          )}
        </Card>

        <Card className="p-6 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-full bg-[#D1FADF] flex items-center justify-center">
              <Coins size={20} className="text-[#027A48]" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#027A48]">Platform All Liquidity</p>
              <p className="text-[10px] text-[#667085]">Source: balances + admin_settings + bot_wallets + admin_pool</p>
            </div>
          </div>
          <p className="text-3xl font-black text-[#027A48]">{formatTdx(totals?.platformLiquidityTdx)}</p>
          {totals?.platformLiquidityTdx !== null ? (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Platform Owned</p>
                <p className="text-sm font-bold text-[#111827]">{formatTdx(totals?.platformOwnedTdx)}</p>
              </div>
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Admin Added</p>
                <p className="text-sm font-bold text-[#111827]">{formatTdx(adminLiquidity?.data?.addedTdx)}</p>
              </div>
              <div className="rounded-lg bg-white/70 p-2">
                <p className="text-[10px] text-[#667085]">Total Tracked</p>
                <p className="text-sm font-bold text-[#111827]">{formatTdx(totals?.totalTrackedTdx)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#B42318]">Totals unavailable</p>
          )}
        </Card>
      </div>

      {/* SECONDARY METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-[#027A48]" />
            <p className="text-xs font-semibold uppercase tracking-wider text-[#027A48]">Avail. User TDX</p>
          </div>
          <p className="text-xl font-black text-[#027A48]">{formatTdx(usersTdx?.data?.availableTdx)}</p>
        </Card>
        <Card className="p-5 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-[#B54708]" />
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B54708]">Current Platform Liquidity</p>
          </div>
          <p className="text-xl font-black text-[#B54708]">{formatTdx(totals?.platformLiquidityTdx)}</p>
        </Card>
        <Card className="p-5 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-2">
            <PieChart size={16} className="text-[#B42318]" />
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B42318]">Locked User TDX</p>
          </div>
          <p className="text-xl font-black text-[#B42318]">{formatTdx(usersTdx?.data?.lockedTdx)}</p>
        </Card>
        <Card className="p-5 border border-[#D1FADF] bg-[#ECFDF3]/30">
          <div className="flex items-center gap-2 mb-2">
            <Coins size={16} className="text-[#027A48]" />
            <p className="text-xs font-semibold uppercase tracking-wider text-[#027A48]">Reserved Liquidity</p>
          </div>
          <p className="text-xl font-black text-[#027A48]">{formatTdx(platformPool?.data?.reservedTdx)}</p>
        </Card>
      </div>

      {/* LIQUIDITY BREAKDOWN */}
      <div>
        <h2 className="text-lg font-bold text-[#111827] mb-4">Liquidity Breakdown</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            {platformPool?.available && platformPool.data ? (
              <PoolCard
                title="Pulse Trade (Shared Pool)"
                icon={<Activity size={18} className="text-[#175CD3]" />}
                status={platformPool.data.status ?? 'ERROR'}
                                source="admin_settings PULSE_LIQUIDITY_POOL_BALANCE"
                available={true}
                rows={[
                  { label: 'Current Liquidity', value: formatTdx(platformPool.data.currentTdx) },
                  { label: 'Reserved (open exposure)', value: formatTdx(platformPool.data.reservedTdx) },
                  { label: 'Available', value: formatTdx(platformPool.data.availableTdx) },
                  { label: 'Utilization', value: fmtPct(platformPool.data.utilizationPercent) },
                  { label: 'Pool Used (TDX)', value: poolUsedTdx === null ? 'N/A' : formatTdx(poolUsedTdx) },
                ]}
              />
            ) : (
              <PoolCard
                title="Pulse Trade (Shared Pool)"
                icon={<Activity size={18} className="text-[#175CD3]" />}
                status="ERROR"
                source="admin_settings PULSE_LIQUIDITY_POOL_BALANCE"
                error={platformPool?.error}
                available={false}
                rows={[]}
              />
            )}
            {lottoFeePool?.available && lottoFeePool.data ? (
              <PoolCard
                title="Lotto Fee Pool"
                icon={<PieChart size={18} className="text-[#754708]" />}
                status={lottoFeePool.data.status ?? 'ERROR'}
                                source="admin_pool (lotto module)"
                available={true}
                rows={[
                  { label: 'Total Balance', value: formatTdx(lottoFeePool.data.totalTdx) },
                  { label: 'Available', value: formatTdx(lottoFeePool.data.availableTdx) },
                  { label: 'Locked', value: formatTdx(lottoFeePool.data.lockedTdx) },
                  { label: 'Collected (fees)', value: formatTdx(lottoFeePool.data.collectedTdx) },
                  { label: 'Withdrawn', value: formatTdx(lottoFeePool.data.withdrawnTdx) },
                ]}
              />
            ) : (
              <PoolCard
                title="Lotto Fee Pool"
                icon={<PieChart size={18} className="text-[#754708]" />}
                status="ERROR"
                source="admin_pool (lotto module)"
                error={lottoFeePool?.error}
                available={false}
                rows={[]}
              />
            )}
          </div>
          <div className="space-y-4">
            {botLiquidity?.available && botLiquidity.data ? (
              <PoolCard
                title="Bot Trade Liquidity"
                icon={<DollarSign size={18} className="text-[#175CD3]" />}
                status={botLiquidity.data.status ?? 'ERROR'}
                                source="bot_wallets / bot_activations"
                available={true}
                rows={[
                  { label: 'Total (TDX)', value: formatTdx(botLiquidity.data.totalTdx) },
                  { label: 'Available', value: formatTdx(botLiquidity.data.availableTdx) },
                  { label: 'Locked', value: formatTdx(botLiquidity.data.lockedTdx) },
                  { label: 'Inflow (lifetime)', value: formatTdx(botLiquidity.data.inflowTdx) },
                  { label: 'Deployed', value: formatTdx(botLiquidity.data.deployedTdx) },
                  { label: 'Active Activations', value: formatCount(botLiquidity.data.activeActivations) },
                ]}
              />
            ) : (
              <PoolCard
                title="Bot Trade Liquidity"
                icon={<DollarSign size={18} className="text-[#175CD3]" />}
                status="ERROR"
                source="bot_wallets / bot_activations"
                error={botLiquidity?.error}
                available={false}
                rows={[]}
              />
            )}
            {adminLiquidity?.available && adminLiquidity.data ? (
              <PoolCard
                title="Admin Liquidity Ledger"
                icon={<Activity size={18} className="text-[#754708]" />}
                status={adminLiquidity.data.status ?? 'ERROR'}
                                source="admin_audit_logs (PULSE_LIQUIDITY_ADJUSTMENT)"
                available={true}
                rows={[
                  { label: 'Added', value: formatTdx(adminLiquidity.data.addedTdx) },
                  { label: 'Removed', value: formatTdx(adminLiquidity.data.removedTdx) },
                  { label: 'Net Added', value: formatTdx(adminLiquidity.data.netAddedTdx), valueClassName: diffColor(parseTdx(adminLiquidity.data.netAddedTdx)) },
                  { label: 'Adjustments', value: formatCount(adminLiquidity.data.adjustmentsCount) },
                  { label: 'Last', value: fmtDateTime(adminLiquidity.data.lastAdjustmentAt) },
                ]}
              />
            ) : (
              <PoolCard
                title="Admin Liquidity Ledger"
                icon={<Activity size={18} className="text-[#754708]" />}
                status="ERROR"
                source="admin_audit_logs (PULSE_LIQUIDITY_ADJUSTMENT)"
                error={adminLiquidity?.error}
                available={false}
                rows={[]}
              />
            )}
          </div>
        </div>
      </div>

      {/* USER FUNDS */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={18} className="text-[#175CD3]" />
          <h3 className="text-base font-bold text-[#111827]">User Funds</h3>
        </div>
        <p className="text-xs text-[#667085] mb-4">Source: balances table + ledger_entries. User TDX is separate from platform liquidity and is never mixed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <p className="text-xs font-medium text-[#667085]">Total User TDX</p>
            <p className="text-lg font-black text-[#111827]">{formatTdx(totals?.allUsersTdx)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <p className="text-xs font-medium text-[#667085]">Available</p>
            <p className="text-lg font-black text-[#111827]">{formatTdx(usersTdx?.data?.availableTdx)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <p className="text-xs font-medium text-[#667085]">Locked</p>
            <p className="text-lg font-black text-[#111827]">{formatTdx(usersTdx?.data?.lockedTdx)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <p className="text-xs font-medium text-[#667085]">Accounts</p>
            <p className="text-lg font-black text-[#111827]">{formatCount(usersTdx?.data?.accountsCount)}</p>
          </div>
        </div>
        {userLedger?.available && userLedger.data ? (
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <p className="text-[10px] font-semibold text-[#667085] mb-2">USER LEDGER (lifetime)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div><p className="text-xs text-[#667085]">Deposited</p><p className="font-bold text-[#027A48]">{formatTdx(userLedger.data.lifetimeDepositedTdx)}</p></div>
              <div><p className="text-xs text-[#667085]">Withdrawn</p><p className="font-bold text-[#B42318]">{formatTdx(userLedger.data.lifetimeWithdrawnTdx)}</p></div>
              <div><p className="text-xs text-[#667085]">Deposits</p><p className="font-bold text-[#111827]">{formatCount(userLedger.data.depositCount)}</p></div>
              <div><p className="text-xs text-[#667085]">Withdrawals</p><p className="font-bold text-[#111827]">{formatCount(userLedger.data.withdrawalCount)}</p></div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#B42318]">{userLedger?.error || 'Ledger data unavailable'}</p>
        )}
      </Card>

      {/* PLATFORM RECONCILIATION */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={18} className="text-[#175CD3]" />
          <h3 className="text-base font-bold text-[#111827]">Platform Liquidity Reconciliation</h3>
        </div>
        <p className="text-xs text-[#667085] mb-4">
          Reconciliation of all platform-owned TDX across Pulse Trade pool, bot wallets, and the Lotto fee pool.
          User TDX is excluded from this total (tracked separately).
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-[#667085] uppercase">PLATFORM OWNED TDX (by source)</p>
            <MetricRow label="Pulse Trade Pool" value={formatTdx(platformPool?.data?.currentTdx)} />
            <MetricRow label="Bot Wallets Total" value={formatTdx(botLiquidity?.data?.totalTdx)} />
            <MetricRow label="Lotto Fee Pool" value={formatTdx(lottoFeePool?.data?.totalTdx)} />
            <div className="border-t border-[#E5E7EB] pt-2 mt-2">
              <MetricRow label="Platform Owned Total" value={formatTdx(totals?.platformOwnedTdx)} icon={<Database size={14} className="text-[#175CD3]" />} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-[#667085] uppercase">PLATFORM ALL LIQUIDITY</p>
            <MetricRow label="Current Liquidity" value={formatTdx(totals?.platformLiquidityTdx)} icon={<Coins size={14} className="text-[#027A48]" />} />
            <MetricRow label="Admin Added" value={formatTdx(adminLiquidity?.data?.addedTdx)} />
            <MetricRow label="Bot Wallets Total" value={formatTdx(botLiquidity?.data?.totalTdx)} />
            <MetricRow label="Lotto Fee Pool" value={formatTdx(lottoFeePool?.data?.totalTdx)} />
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-[#667085] uppercase">RECONCILIATION</p>
            <MetricRow label="Total Added Liquidity" value={formatTdx(adminLiquidity?.data?.addedTdx)} />
            <MetricRow label="Current Liquidity" value={formatTdx(totals?.platformLiquidityTdx)} />
            <DiffRow label="Difference" value={reconciliationDiff} />
            <div className="border-t border-[#E5E7EB] pt-2 mt-2">
              <MetricRow label="Total Tracked TDX" value={formatTdx(totals?.totalTrackedTdx)} icon={<Database size={14} className="text-[#027A48]" />} />
            </div>
          </div>
        </div>
      </Card>

      {/* VAULT / ON-CHAIN */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={18} className="text-[#175CD3]" />
          <h3 className="text-base font-bold text-[#111827]">Vault &amp; On-chain Balances (USDT)</h3>
        </div>
        <p className="text-xs text-[#667085] mb-4">
          On-chain TDX is not available (TDX is internal accounting; no TDX token is deployed).
                    Vault balances are read on-chain in USDT.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-[#667085]">Deposit Vault (on-chain USDT)</p>
              <StatusBadge status={depositVaultStatus} />
            </div>
            <p className="text-lg font-black text-[#111827]">{formatUsdt(depositVaultUsdt)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-[#667085]">Withdrawal Vault (on-chain USDT)</p>
              <StatusBadge status={withdrawalVaultStatus} />
            </div>
            <p className="text-lg font-black text-[#111827]">{formatUsdt(withdrawalVaultUsdt)}</p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[#667085]">Database Tracked TDX</p>
              <CheckCircle size={14} className="text-[#027A48]" />
            </div>
            <p className="text-lg font-black text-[#111827]">{formatTdx(totals?.totalTrackedTdx)}</p>
            <p className="text-[10px] text-[#667085] mt-1">users + pool + bots + lotto</p>
          </div>
        </div>
      </Card>

      {/* RECENT LIQUIDITY ACTIVITY */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={20} className="text-[#175CD3]" />
          <h2 className="text-lg font-bold text-[#111827]">Recent Liquidity Activity</h2>
        </div>
        <p className="text-xs text-[#667085] mb-3">
          Source: admin_audit_logs (PULSE_LIQUIDITY_ADJUSTMENT) — admin ADD / REMOVE operations on the platform pool.
        </p>
        <RecentActivityTable items={fin?.recentLiquidityActivity ?? []} />
      </div>

      {/* Footer: data sources */}
      <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
        <p className="text-[10px] font-semibold text-[#667085] mb-1">DATA SOURCES</p>
        <p className="text-[10px] text-[#98A2B3]">
          {totals?.sources?.join(' | ') || 'No sources available'} · User TDX and platform funds are never mixed · Pulse Trade + Lotto share one pool
        </p>
      </div>
    </div>
  );
}
