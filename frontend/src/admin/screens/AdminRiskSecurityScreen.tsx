// frontend/src/admin/screens/AdminRiskSecurityScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminAuditLogEntry } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

type RiskSecurityData = Awaited<ReturnType<typeof AdminService.getAdminRiskSecurity>>;

function formatTokenAmount(value: string | number | null | undefined, symbol: 'TDX' | 'USDT' = 'TDX'): string {
  if (value === null || value === undefined) return '—';
  const input = String(value).trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(input)) return '—';
  const normalized = input.startsWith('+') ? input.slice(1) : input;
  const negative = normalized.startsWith('-');
  const absValue = negative ? normalized.slice(1) : normalized;
  const [rawIntPart, rawDecimalPart = ''] = absValue.split('.');
  const intPart = rawIntPart.replace(/^0+(?=\d)/, '') || '0';
  const decimalPart = (rawDecimalPart + '00').slice(0, 2);
  const groupedIntPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = negative ? '-' : '';
  return `${sign}${groupedIntPart}.${decimalPart} ${symbol}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function formatRiskState(value?: string | null): string {
  if (!value) return 'Unknown';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRiskVariant(state?: string | null): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = state?.trim().toUpperCase() ?? '';
  if (!normalized) return 'neutral';
  if (normalized === 'NORMAL') return 'success';
  if (normalized.includes('WARN') || normalized.includes('CAUTION')) return 'warning';
  if (normalized.includes('RESTRICT') || normalized.includes('BLOCK') || normalized.includes('STOP')) return 'error';
  return 'info';
}

function getAuditLogResult(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const explicitResult = metadata.result;
  const explicitStatus = metadata.status;
  const explicitOutcome = metadata.outcome;

  if (typeof explicitResult === 'string' && explicitResult.trim()) return explicitResult.trim();
  if (typeof explicitStatus === 'string' && explicitStatus.trim()) return explicitStatus.trim();
  if (typeof explicitOutcome === 'string' && explicitOutcome.trim()) return explicitOutcome.trim();
  if (typeof metadata.success === 'boolean') return metadata.success ? 'SUCCESS' : 'FAILED';
  if (log.action.toUpperCase().includes('FAILED')) return 'FAILED';
  return 'UNKNOWN';
}

function isRiskSecurityAlert(log: AdminAuditLogEntry): boolean {
  const content = `${log.action} ${log.targetType}`.toLowerCase();
  return content.includes('risk') || content.includes('security') || content.includes('settlement');
}

export default function AdminRiskSecurityScreen() {
  const [data, setData] = useState<RiskSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadRiskSecurity = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const response = await AdminService.getAdminRiskSecurity();
      setData(response);
    } catch (loadError) {
      setError(AdminService.getErrorMessage(loadError));
      setData(null);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRiskSecurity({ withLoader: true });
  }, [loadRiskSecurity]);

  const settlementIssues = useMemo(() => {
    if (!data) return 0;
    return data.alerts.filter((alert) => {
      const combined = `${alert.action} ${alert.targetType}`.toLowerCase();
      return combined.includes('settlement') || getAuditLogResult(alert).toUpperCase().includes('FAIL');
    }).length;
  }, [data]);

  const riskAlerts = useMemo(() => {
    if (!data) return [];
    return data.alerts.filter((entry) => isRiskSecurityAlert(entry)).slice(0, 25);
  }, [data]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Risk & Security</h1>
            <p className="mt-0.5 text-xs text-[#667085]">
              Monitor real-time risk posture, risk controls, and security-related operational events.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadRiskSecurity({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {loading && !data ? (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
            <Skeleton className="h-5 w-40" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={`risk-overview-skeleton-${index}`} className="h-6 w-full" />
              ))}
            </div>
          </div>
          <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
            <Skeleton className="h-5 w-40" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={`risk-control-skeleton-${index}`} className="h-6 w-full" />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {!loading && error && (
        <ErrorState
          title="Unable to load risk and security data"
          description={error}
          onRetry={() => void loadRiskSecurity({ withLoader: true })}
          retryLabel="Retry"
        />
      )}

      {!loading && !error && data && (
        <>
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <article className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Risk Overview</h2>
                <Badge variant={getRiskVariant(data.risk.state)}>
                  {formatRiskState(data.risk.state)}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 text-xs text-[#344054]">
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Overall Risk State</span>
                  <span className="font-bold text-[#111827]">{formatRiskState(data.risk.state)}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Open Trade Exposure</span>
                  <span className="font-bold text-[#111827]">{formatTokenAmount(data.liquidity.openExposure, 'TDX')}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Reserved Liquidity</span>
                  <span className="font-bold text-[#111827]">{formatTokenAmount(data.liquidity.reservedAmount, 'TDX')}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Available Liquidity</span>
                  <span className="font-bold text-[#111827]">{formatTokenAmount(data.liquidity.availableLiquidity, 'TDX')}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Maximum Allowed Trade</span>
                  <span className="font-bold text-[#111827]">{formatTokenAmount(data.risk.maxAllowedTrade, 'TDX')}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Settlement Issues</span>
                  <Badge variant={settlementIssues > 0 ? 'warning' : 'success'}>
                    {settlementIssues}
                  </Badge>
                </p>
              </div>
            </article>

            <article className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Risk Control</h2>
                <Badge variant={getRiskVariant(data.risk.state)}>
                  {formatRiskState(data.risk.state)}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 text-xs text-[#344054]">
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Accepting Trades</span>
                  <Badge variant={data.risk.acceptingTrades ? 'success' : 'error'}>
                    {data.risk.acceptingTrades ? 'Yes' : 'No'}
                  </Badge>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Maximum Allowed Trade</span>
                  <span className="font-bold text-[#111827]">{formatTokenAmount(data.risk.maxAllowedTrade, 'TDX')}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-[#667085]">Risk State</span>
                  <span className="font-bold text-[#111827]">{formatRiskState(data.risk.state)}</span>
                </p>
                <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[#667085]">Reason</p>
                  <p className="mt-1 text-xs font-semibold text-[#111827]">{data.risk.reason || 'No restrictions'}</p>
                </div>
                <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[#667085]">Exposure Information</p>
                  <p className="mt-1 text-xs text-[#344054]">
                    Pool Balance: <span className="font-semibold text-[#111827]">{formatTokenAmount(data.liquidity.poolBalance, 'TDX')}</span>
                  </p>
                  <p className="mt-1 text-xs text-[#344054]">
                    Open Exposure: <span className="font-semibold text-[#111827]">{formatTokenAmount(data.liquidity.openExposure, 'TDX')}</span>
                  </p>
                  <p className="mt-1 text-xs text-[#344054]">
                    Last refresh: <span className="font-semibold text-[#111827]">{formatDateTime(data.fetchedAt)}</span>
                  </p>
                </div>
              </div>
            </article>
          </section>

          <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Security / Risk Alerts</h2>
              <Badge variant={riskAlerts.length > 0 ? 'warning' : 'neutral'}>
                {riskAlerts.length} event{riskAlerts.length === 1 ? '' : 's'}
              </Badge>
            </div>

            {riskAlerts.length === 0 ? (
              <div className="mt-4 rounded-[12px] border border-dashed border-[#D0D5DD] bg-[#F9FAFB] p-6 text-center">
                <ShieldAlert className="mx-auto h-8 w-8 text-[#98A2B3]" />
                <p className="mt-2 text-sm font-bold text-[#344054]">No current risk/security alerts</p>
                <p className="mt-1 text-xs text-[#667085]">
                  No authoritative risk/security audit events were returned.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 h-8 px-3 text-xs"
                  onClick={() => void loadRiskSecurity({ withLoader: false })}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[940px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Time</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Admin</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Resource</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {riskAlerts.map((alert) => {
                      const result = getAuditLogResult(alert);
                      return (
                        <tr key={alert.id} className="align-top hover:bg-[#F8FAFC]">
                          <td className="px-3 py-2 text-xs text-[#111827]">{formatDateTime(alert.createdAt)}</td>
                          <td className="px-3 py-2 text-xs text-[#111827] font-mono">{alert.adminId}</td>
                          <td className="px-3 py-2 text-xs text-[#111827] font-semibold">{alert.action}</td>
                          <td className="px-3 py-2 text-xs text-[#111827]">
                            {alert.targetType}
                            {alert.targetId && (
                              <p className="mt-1 text-[10px] text-[#667085] font-mono">{alert.targetId}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <Badge variant={result.toUpperCase().includes('FAIL') ? 'error' : 'info'}>
                              {result}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}