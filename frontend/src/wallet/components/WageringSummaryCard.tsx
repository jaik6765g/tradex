// frontend/src/wallet/components/WageringSummaryCard.tsx
//
// User-facing wagering requirement summary: applicable multiplier, deposit,
// required / completed / remaining amounts, per-obligation status, withdrawal
// eligibility and a plain-language explanation of the rule (served by the
// backend so the disclosure always matches the enforced policy).
// Money strings are displayed with formatWageringAmount — never float math.

import React, { useCallback, useEffect, useState } from 'react';

import {
  wageringService,
  formatWageringAmount,
  type WageringSummary,
} from '../services/wagering.service';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-[#3A281C] bg-[#2A190D] text-[#FF8F3D]',
  COMPLETED: 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]',
  CANCELLED: 'border-[#4A2323] bg-[#281313] text-[#F87171]',
  EXPIRED: 'border-[#292B33] bg-[#15161C] text-[#A1A4AE]',
};

export default function WageringSummaryCard() {
  const [summary, setSummary] = useState<WageringSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await wageringService.getMySummary());
    } catch {
      // A failing wagering endpoint must never block the wallet screen.
      setSummary(null);
      setError('Wagering summary is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
        <p className="animate-pulse text-xs text-[#A1A4AE]">Loading wagering requirements…</p>
      </section>
    );
  }

  if (error && !summary) {
    return (
      <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
        <p className="text-xs text-[#A1A4AE]">{error}</p>
      </section>
    );
  }

  if (!summary) return null;

  // Wagering disabled → no requirement applies; keep the card silent.
  if (!summary.wageringEnabled) return null;

  const active = summary.obligations.filter((entry) => entry.status === 'ACTIVE');
  const historical = summary.obligations.filter((entry) => entry.status !== 'ACTIVE');

  return (
    <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF7A18] text-white">
            <span className="text-[13px] font-black">{summary.applicableMultiplier}X</span>
          </div>
          <div>
            <h2 className="text-[16px] font-black text-[#F5F5F7]">Wagering requirement</h2>
            <p className="text-[11px] text-[#A1A4AE]">
              {summary.multiplierSource === 'USER_OVERRIDE'
                ? 'Custom multiplier set by TradeX for your account'
                : 'Standard platform multiplier'}
            </p>
          </div>
        </div>
        <span
          className={
            summary.withdrawalEligible
              ? 'rounded-full border border-[#1E4A32] bg-[#10251A] px-2.5 py-1 text-[11px] font-extrabold text-[#4ADE80]'
              : 'rounded-full border border-[#3A281C] bg-[#2A190D] px-2.5 py-1 text-[11px] font-extrabold text-[#FF8F3D]'
          }
        >
          {summary.withdrawalEligible ? 'Withdrawal available' : 'Withdrawal on hold'}
        </span>
      </div>


      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-2 py-2 text-center">
          <span className="block text-[10px] uppercase tracking-wide text-[#A1A4AE]">Required</span>
          <span className="text-sm font-black text-[#F5F5F7]">
            {formatWageringAmount(summary.totalRequired)}
          </span>
        </div>
        <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-2 py-2 text-center">
          <span className="block text-[10px] uppercase tracking-wide text-[#A1A4AE]">Completed</span>
          <span className="text-sm font-black text-[#4ADE80]">
            {formatWageringAmount(summary.totalCompleted)}
          </span>
        </div>
        <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-2 py-2 text-center">
          <span className="block text-[10px] uppercase tracking-wide text-[#A1A4AE]">Remaining</span>
          <span className="text-sm font-black text-[#FF8F3D]">
            {formatWageringAmount(summary.totalRemaining)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[#A1A4AE]">{summary.ruleExplanation}</p>

      {active.length > 0 ? (
        <div className="mt-3 space-y-2">
          {active.map((obligation) => (
            <div
              key={obligation.id}
              className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2 text-[11px] text-[#A1A4AE]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-[#E4E5E8]">
                  Deposit {formatWageringAmount(obligation.depositAmountTdx)} TDX ×{' '}
                  {obligation.multiplier} = {formatWageringAmount(obligation.requiredAmount)} TDX
                  required
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-extrabold ${
                    STATUS_STYLES[obligation.status] ?? STATUS_STYLES.EXPIRED
                  }`}
                >
                  {obligation.status}
                </span>
              </div>
              <p className="mt-1">
                Wagered {formatWageringAmount(obligation.completedAmount)} of{' '}
                {formatWageringAmount(obligation.requiredAmount)} TDX ·{' '}
                {formatWageringAmount(obligation.remainingAmount)} TDX remaining
              </p>
            </div>
          ))}
        </div>
      ) : (
        historical.length === 0 && (
          <p className="mt-3 text-[11px] text-[#A1A4AE]">
            No wagering requirements are attached to your account.
          </p>
        )
      )}
    </section>
  );
}
