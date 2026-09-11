// frontend/src/admin/screens/AdminLiquidityScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Minus,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { PulseLiquidityResponse, PulseRiskResponse } from '../../trade/pulse/types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

type LiquidityAction = 'ADD' | 'REMOVE';

interface ActivityItem {
  id: string;
  adminId: string;
  action: LiquidityAction;
  amount: string;
  result: 'SUCCESS' | 'FAILED';
  reason: string;
  reference?: string | null;
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

function formatPulseRiskState(state?: string): string {
  if (!state) return 'Unknown';
  return state
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getPulseRiskStateBadgeVariant(
  state?: string,
): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = state?.trim().toUpperCase();
  if (!normalized) return 'neutral';
  if (normalized === 'NORMAL') return 'success';
  if (normalized.includes('WARN') || normalized.includes('CAUTION')) return 'warning';
  if (normalized.includes('RESTRICT') || normalized.includes('BLOCK') || normalized.includes('STOP') || normalized === 'CRITICAL') {
    return 'error';
  }
  return 'info';
}

function formatTokenAmount(
  value: string | number | null | undefined,
  symbol: 'TDX' | 'USDT' = 'TDX',
): string {
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

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${value.toFixed(2)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export default function AdminLiquidityScreen() {
  const [liquidity, setLiquidity] = useState<PulseLiquidityResponse | null>(null);
  const [risk, setRisk] = useState<PulseRiskResponse | null>(null);

  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [riskLoading, setRiskLoading] = useState(true);
  const [liquidityError, setLiquidityError] = useState<string | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);

  const [liquidityFetchedAt, setLiquidityFetchedAt] = useState<string | null>(null);
  const [riskFetchedAt, setRiskFetchedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [modalAction, setModalAction] = useState<LiquidityAction | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityAction, setActivityAction] = useState<'ALL' | LiquidityAction>('ALL');
  const [activityResult, setActivityResult] = useState<'ALL' | 'SUCCESS' | 'FAILED'>('ALL');

  const fetchLiquidity = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLiquidityLoading(true);
    setLiquidityError(null);
    try {
      const response = await AdminService.getAdminLiquidity();
      setLiquidity(response);
      setLiquidityFetchedAt(new Date().toISOString());
    } catch (error) {
      setLiquidityError(AdminService.getErrorMessage(error));
      setLiquidity(null);
    } finally {
      if (withLoader) setLiquidityLoading(false);
    }
  }, []);

  const fetchRisk = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setRiskLoading(true);
    setRiskError(null);
    try {
      const response = await AdminService.getAdminRisk();
      setRisk(response);
      setRiskFetchedAt(new Date().toISOString());
    } catch (error) {
      setRiskError(AdminService.getErrorMessage(error));
      setRisk(null);
    } finally {
      if (withLoader) setRiskLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const response = await AdminService.getPulseAdminLiquidityActivity({
        limit: 50,
        offset: 0,
        action: activityAction,
        result: activityResult,
      });
      setActivities(response.items as ActivityItem[]);
    } catch (error) {
      setActivityError(AdminService.getErrorMessage(error));
      setActivities([]);
    } finally {
      setActivityLoading(false);
    }
  }, [activityAction, activityResult]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        fetchLiquidity({ withLoader: false }),
        fetchRisk({ withLoader: false }),
        fetchActivity(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchActivity, fetchLiquidity, fetchRisk]);

  useEffect(() => {
    void Promise.all([
      fetchLiquidity({ withLoader: true }),
      fetchRisk({ withLoader: true }),
      fetchActivity(),
    ]);
  }, [fetchActivity, fetchLiquidity, fetchRisk]);

  const liquidityUtilization = useMemo(() => {
    const reserved = toFiniteNumber(liquidity?.reservedAmount);
    const poolBalance = toFiniteNumber(liquidity?.poolBalance);
    if (reserved === null || poolBalance === null || poolBalance <= 0) return null;
    return (reserved / poolBalance) * 100;
  }, [liquidity?.poolBalance, liquidity?.reservedAmount]);

  const exposureRatio = useMemo(() => {
    const openExposure = toFiniteNumber(liquidity?.openExposure);
    const poolBalance = toFiniteNumber(liquidity?.poolBalance);
    if (openExposure === null || poolBalance === null || poolBalance <= 0) return null;
    return (openExposure / poolBalance) * 100;
  }, [liquidity?.openExposure, liquidity?.poolBalance]);

  const openModal = (action: LiquidityAction) => {
    setModalAction(action);
    setAmount('');
    setReason('');
    setReference('');
    setNote('');
    setSubmitError(null);
    setSubmitSuccess(null);
  };

  const closeModal = () => {
    if (submitLoading) return;
    setModalAction(null);
    setSubmitError(null);
  };

  const submitLiquidityAdjustment = async () => {
    if (!modalAction) return;

    const normalizedAmount = amount.trim();
    const numericAmount = Number(normalizedAmount);

    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalizedAmount) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setSubmitError('Enter a valid amount greater than 0.');
      return;
    }

    const available = toFiniteNumber(liquidity?.availableLiquidity);
    if (modalAction === 'REMOVE' && available !== null && numericAmount > available) {
      setSubmitError(`Cannot remove more than available liquidity (${formatTokenAmount(liquidity?.availableLiquidity)}).`);
      return;
    }

    if (!reason.trim()) {
      setSubmitError('Reason is required.');
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      await AdminService.adjustPulseAdminLiquidity({
        action: modalAction,
        amount: normalizedAmount,
        reason: reason.trim(),
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });

      setSubmitSuccess(`${modalAction === 'ADD' ? 'Added' : 'Removed'} ${formatTokenAmount(normalizedAmount)} successfully.`);
      setModalAction(null);

      await Promise.allSettled([
        fetchLiquidity({ withLoader: false }),
        fetchRisk({ withLoader: false }),
        fetchActivity(),
      ]);
    } catch (error) {
      setSubmitError(AdminService.getErrorMessage(error));
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Liquidity & Risk Control</h1>
            <p className="mt-0.5 text-xs text-[#667085]">
              Real-time Pulse Trade liquidity pool capacity and risk controls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => openModal('REMOVE')}
              disabled={liquidityLoading || !liquidity}
            >
              <Minus size={14} className="mr-1.5" />
              Remove Liquidity
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => openModal('ADD')}
            >
              <Plus size={14} className="mr-1.5" />
              Add Liquidity
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => void refreshAll()}
              loading={isRefreshing}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {submitSuccess && (
        <div className="flex items-center gap-2 rounded-[12px] border border-[#A7F3D0] bg-[#ECFDF3] px-3 py-2 text-xs font-semibold text-[#047857]">
          <CheckCircle2 size={15} />
          {submitSuccess}
          <button type="button" className="ml-auto" onClick={() => setSubmitSuccess(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Liquidity & Risk Cards */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <article className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Liquidity</h2>
            <Badge variant={getPulseRiskStateBadgeVariant(liquidity?.riskState)}>
              {formatPulseRiskState(liquidity?.riskState)}
            </Badge>
          </div>

          {liquidityLoading && !liquidity ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={`liquidity-skeleton-${index}`} className="h-6 w-full" />
              ))}
            </div>
          ) : liquidityError ? (
            <ErrorState
              className="mt-3"
              title="Unable to load liquidity data"
              description={liquidityError}
              onRetry={() => void fetchLiquidity({ withLoader: true })}
            />
          ) : (
            <div className="mt-3 space-y-2 text-xs text-[#344054]">
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Pool Balance</span>
                <span className="font-bold text-[#111827]">{formatTokenAmount(liquidity?.poolBalance)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Available Liquidity</span>
                <span className="font-bold text-[#111827]">{formatTokenAmount(liquidity?.availableLiquidity)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Reserved Amount</span>
                <span className="font-bold text-[#111827]">{formatTokenAmount(liquidity?.reservedAmount)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Open Exposure</span>
                <span className="font-bold text-[#111827]">{formatTokenAmount(liquidity?.openExposure)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Reserved / Pool</span>
                <span className="font-bold text-[#111827]">{formatPercent(liquidityUtilization)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Exposure / Pool</span>
                <span className="font-bold text-[#111827]">{formatPercent(exposureRatio)}</span>
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] text-[#667085]">
            Last updated: <span className="font-semibold text-[#111827]">{formatDateTime(liquidityFetchedAt)}</span>
          </p>
        </article>

        <article className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Risk Control</h2>
            <Badge variant={getPulseRiskStateBadgeVariant(risk?.state)}>
              {formatPulseRiskState(risk?.state)}
            </Badge>
          </div>

          {riskLoading && !risk ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={`risk-skeleton-${index}`} className="h-6 w-full" />
              ))}
            </div>
          ) : riskError ? (
            <ErrorState
              className="mt-3"
              title="Unable to load risk data"
              description={riskError}
              onRetry={() => void fetchRisk({ withLoader: true })}
            />
          ) : (
            <div className="mt-3 space-y-2 text-xs text-[#344054]">
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Accepting Trades</span>
                <Badge variant={risk?.acceptingTrades ? 'success' : 'error'}>
                  {risk?.acceptingTrades ? 'Yes' : 'No'}
                </Badge>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[#667085]">Max Allowed Trade</span>
                <span className="font-bold text-[#111827]">{formatTokenAmount(risk?.maxAllowedTrade)}</span>
              </p>
              <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                <p className="text-[11px] uppercase tracking-[0.06em] text-[#667085]">Reason</p>
                <p className="mt-1 text-xs font-semibold text-[#111827]">{risk?.reason || 'No restrictions'}</p>
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] text-[#667085]">
            Last updated: <span className="font-semibold text-[#111827]">{formatDateTime(riskFetchedAt)}</span>
          </p>
        </article>
      </section>

      {/* Activity Log */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History size={17} />
            <div>
              <h2 className="text-sm font-black">Liquidity Activity</h2>
              <p className="text-[11px] text-[#667085]">Admin ADD/REMOVE history and failed attempts.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={activityAction}
              onChange={(e) => setActivityAction(e.target.value as 'ALL' | LiquidityAction)}
              className="h-9 rounded-[9px] border border-[#D0D5DD] bg-white px-2 text-xs outline-none"
            >
              <option value="ALL">All Actions</option>
              <option value="ADD">ADD</option>
              <option value="REMOVE">REMOVE</option>
            </select>
            <select
              value={activityResult}
              onChange={(e) => setActivityResult(e.target.value as 'ALL' | 'SUCCESS' | 'FAILED')}
              className="h-9 rounded-[9px] border border-[#D0D5DD] bg-white px-2 text-xs outline-none"
            >
              <option value="ALL">All Results</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
        </div>

        {activityLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`activity-skeleton-${index}`} className="h-10 w-full" />
            ))}
          </div>
        ) : activityError ? (
          <div className="mt-4 flex items-center gap-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B42318]">
            <AlertCircle size={15} />
            {activityError}
          </div>
        ) : activities.length === 0 ? (
          <div className="mt-4 rounded-[10px] border border-dashed border-[#D0D5DD] p-8 text-center text-xs text-[#667085]">
            No liquidity activity found.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[850px] w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#EAECF0] text-[11px] uppercase tracking-[0.05em] text-[#667085]">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((item) => (
                  <tr key={item.id} className="border-b border-[#F2F4F7] last:border-0">
                    <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(item.createdAt)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={item.action === 'ADD' ? 'success' : 'warning'}>
                        {item.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-bold">{formatTokenAmount(item.amount)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={item.result === 'SUCCESS' ? 'success' : 'error'}>
                        {item.result}
                      </Badge>
                    </td>
                    <td className="max-w-[260px] px-3 py-3">{item.reason || '—'}</td>
                    <td className="px-3 py-3">{item.reference || '—'}</td>
                    <td className="px-3 py-3">{item.adminId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal */}
      {modalAction && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="liquidity-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-[520px] rounded-[18px] border border-[#E5E7EB] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="liquidity-modal-title" className="text-base font-black">
                  {modalAction === 'ADD' ? 'Add Liquidity' : 'Remove Liquidity'}
                </h2>
                <p className="mt-1 text-xs text-[#667085]">
                  {modalAction === 'ADD'
                    ? 'Increase the authoritative Pulse Trade platform liquidity pool.'
                    : `Remove unused liquidity. Maximum removable: ${formatTokenAmount(liquidity?.availableLiquidity)}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={submitLoading}
                className="rounded-lg p-1 text-[#667085] hover:bg-[#F2F4F7]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-[#344054]">Amount (TDX) *</span>
                <input
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="10000"
                  disabled={submitLoading}
                  className="h-10 w-full rounded-[9px] border border-[#D0D5DD] px-3 text-sm outline-none focus:border-[#667085]"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-[#344054]">Reason *</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={120}
                  placeholder="Initial Pulse liquidity"
                  disabled={submitLoading}
                  className="h-10 w-full rounded-[9px] border border-[#D0D5DD] px-3 text-sm outline-none focus:border-[#667085]"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-[#344054]">Reference</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={120}
                  placeholder="LIQ-001"
                  disabled={submitLoading}
                  className="h-10 w-full rounded-[9px] border border-[#D0D5DD] px-3 text-sm outline-none focus:border-[#667085]"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-[#344054]">Note</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Optional note"
                  disabled={submitLoading}
                  className="w-full resize-none rounded-[9px] border border-[#D0D5DD] px-3 py-2 text-sm outline-none focus:border-[#667085]"
                />
              </label>

              {submitError && (
                <div className="flex items-start gap-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-semibold text-[#B42318]">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={closeModal} disabled={submitLoading}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void submitLiquidityAdjustment()}
                  loading={submitLoading}
                >
                  {modalAction === 'ADD' ? 'Add Liquidity' : 'Remove Liquidity'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}