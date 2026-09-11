import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoRound } from '../services/adminLotto.service';

type ConfirmState =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'manualResult'; round: AdminLottoRound; symbol: string }
  | { kind: 'addLiquidity' }
  | { kind: 'removeLiquidity' }
  | null;

export default function ConfirmModal({
  state, busy, onClose, onPause, onResume, onManualResult, onAddLiquidity, onRemoveLiquidity,
}: {
  state: ConfirmState;
  busy: boolean;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onManualResult: (round: AdminLottoRound, symbol: string, reason?: string) => void;
  onAddLiquidity: (amount: number, reason?: string) => void;
  onRemoveLiquidity: (amount: number, reason?: string) => void;
}) {
  if (!state) return null;

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const confirm = () => {
    if (state.kind === 'pause') onPause();
    else if (state.kind === 'resume') onResume();
    else if (state.kind === 'manualResult') onManualResult(state.round, state.symbol, reason);
    else if (state.kind === 'addLiquidity') onAddLiquidity(Number(amount), reason);
    else if (state.kind === 'removeLiquidity') onRemoveLiquidity(Number(amount), reason);
  };

  const title = state.kind === 'pause' ? 'Pause the Lotto game?' : state.kind === 'resume' ? 'Resume the Lotto game?' : state.kind === 'manualResult' ? `Set result ${state.symbol} for ${state.round.roundNumber}?` : state.kind === 'addLiquidity' ? 'Add Lotto liquidity?' : 'Remove Lotto liquidity?';

  const description =
    state.kind === 'pause' ? 'New ticket purchases will be rejected. Rounds already in flight continue to draw and settle.' :
    state.kind === 'resume' ? 'New ticket purchases will be accepted again.' :
    state.kind === 'manualResult' ? `Round #${state.round.roundNumber} (${state.round.category}) — current status: ${state.round.status}. The result will be locked with source=ADMIN and the round moved to RESULTED.` :
    state.kind === 'addLiquidity' ? 'Adds TDX to the Lotto liquidity pool. Reserved liability stays unchanged.' :
    'Removes TDX from the pool. Only liquidity above the reserved payout liability can be removed.';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#101828]/45">
      <div className="mx-auto mt-24 w-full max-w-md rounded-[16px] border border-[#E4E7EC] bg-white p-5 shadow-xl">
        <h3 className="flex items-center gap-2 text-base font-black text-[#111827]"><AlertTriangle size={18} className="text-[#B54708]" /> {title}</h3>
        <p className="mt-2 text-xs text-[#667085]">{description}</p>

        {state.kind === 'manualResult' && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[#F8FAFC] p-2 text-xs">
            <span className="text-[#667085]">Selected result</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFFAEB] text-sm font-black text-[#B54708]">{state.symbol}</span>
          </div>
        )}

        {(state.kind === 'addLiquidity' || state.kind === 'removeLiquidity') && (
          <div className="mt-3 space-y-2">
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in TDX" className="h-10 w-full rounded-lg border border-[#E4E7EC] px-3 text-xs" />
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, audited)" className="h-10 w-full rounded-lg border border-[#E4E7EC] px-3 text-xs" />
            {amount && Number(amount) > 0 && <p className="text-[10px] text-[#667085]">{formatTdx(Number(amount))} TDX</p>}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#E4E7EC] px-4 text-xs font-bold text-[#475467] hover:bg-[#F9FAFB]">Cancel</button>
          <button type="button" disabled={busy || ((state.kind === 'addLiquidity' || state.kind === 'removeLiquidity') && !(Number(amount) > 0))} onClick={confirm} className="flex h-9 items-center gap-1 rounded-lg bg-[#F5B800] px-4 text-xs font-black text-[#181205] disabled:opacity-50">
            <CheckCircle2 size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}