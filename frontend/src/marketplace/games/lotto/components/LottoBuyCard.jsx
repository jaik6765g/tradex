// src/marketplace/games/lotto/components/LottoBuyCard.jsx
// TPPlay-style bottom-sheet Buy Card confirmation layer.
// Temporary local state only. On confirm calls EXISTING placeBet with
// total = amount x quantity x multiplier as ticket amount.
// Backend contract unchanged: placeTicket({ roundId, amount, selectedNumbers }).
import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Ticket, Wallet, X } from 'lucide-react';
import { formatTdx } from '../utils/lottoPresentation';

const AMOUNT_OPTIONS = [1, 10, 100, 1000];
const MULTIPLIER_OPTIONS = [1, 5, 10, 20, 50, 100];
const MAX_QUANTITY = 999;

function sanitizeQty(raw) {
  const d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
  if (d === '') return '';
  const n = Number(d);
  if (!Number.isFinite(n)) return '';
  if (n < 1) return 1;
  if (n > MAX_QUANTITY) return MAX_QUANTITY;
  return Math.floor(n);
}

export default function LottoBuyCard(props) {
  const open = props.open;
  const onClose = props.onClose;
  const onConfirm = props.onConfirm;
  const gameTitle = props.gameTitle || 'Lotto 30sec';
  const selectionLabel = props.selectionLabel || 'Select';
  const balance = props.balance || 0;
  const submitting = props.submitting || false;
  const disabled = props.disabled || false;
  const isAuthenticated = props.isAuthenticated !== false;

  const [selAmount, setSelAmount] = useState(1);
  const [qty, setQty] = useState(1);
  const [qtyText, setQtyText] = useState('1');
  const [mult, setMult] = useState(1);
  const [agreed, setAgreed] = useState(true);

  useEffect(() => {
    if (open) {
      setSelAmount(1);
      setQty(1);
      setQtyText('1');
      setMult(1);
      setAgreed(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const total = useMemo(() => {
    const q = Number(qty) || 0;
    return Number(selAmount || 0) * q * Number(mult || 0);
  }, [selAmount, qty, mult]);

  const lowBalance = Number(balance) < total;

  const decQty = () => {
    const n = Math.max(1, (Number(qty) || 1) - 1);
    setQty(n);
    setQtyText(String(n));
  };

  const incQty = () => {
    const n = Math.min(MAX_QUANTITY, (Number(qty) || 1) + 1);
    setQty(n);
    setQtyText(String(n));
  };

  const onQtyChange = (e) => {
    const s = sanitizeQty(e.target.value);
    setQtyText(s === '' ? '' : String(s));
    if (s !== '') setQty(s);
  };

  const onQtyBlur = () => {
    if (qtyText === '' || Number(qtyText) < 1) {
      setQty(1);
      setQtyText('1');
    }
  };

  const confirmBlocked = disabled || submitting || !agreed || lowBalance || total <= 0 || !isAuthenticated;

  const doConfirm = () => {
    if (confirmBlocked) return;
    if (typeof onConfirm === 'function') onConfirm({ amount: selAmount, quantity: qty, multiplier: mult, total });
  };

  if (!open) return null;

  const sheetAnimation = 'lotto-buy-card__sheet--enter';

  return (
    <div className="lotto-buy-card" role="dialog" aria-modal="true" aria-label="Confirm ticket">
      <button type="button" aria-label="Close buy card" onClick={onClose} className="lotto-buy-card__overlay" />
      <div className={`lotto-buy-card__sheet ${sheetAnimation}`}>
        <div className="lotto-buy-card__grabber" aria-hidden />
        <div className="relative bg-gradient-to-r from-[#F97316] to-[#FB923C] px-4 pb-3 pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[13px] font-black text-white">{gameTitle}</p>
              <p className="mt-0.5 text-[11px] font-bold text-white/90">{selectionLabel}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Cancel" className="flex h-7 w-7 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/30">
              <X size={15} strokeWidth={2.6} />
            </button>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-[#F5F5F7]">Balance</p>
            <div className="flex items-center gap-1.5 rounded-lg border border-[#26262E] bg-[#16161C] px-2 py-1">
              <Wallet size={12} strokeWidth={2.4} className="text-[#B9BAC6]" />
              <span className="text-[11px] font-black text-[#F5F5F7] tabular-nums">{formatTdx(balance)} TDX</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {AMOUNT_OPTIONS.map((amt) => (
              <button key={amt} type="button" onClick={() => setSelAmount(amt)} aria-pressed={selAmount === amt} className={'h-10 rounded-lg text-[13px] font-black tabular-nums transition-all active:scale-95 ' + (selAmount === amt ? 'border border-[#FB923C] bg-gradient-to-b from-[#FB923C] to-[#F97316] text-[#181205] shadow-sm' : 'border border-[#26262E] bg-[#16161C] text-[#B9BAC6] hover:bg-[#1C1C24]')}>{amt}</button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[11px] font-black text-[#F5F5F7]">Quantity</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={decQty} disabled={qty <= 1} aria-label="Decrease quantity" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#26262E] bg-[#16161C] text-[#F5F5F7] hover:bg-[#1C1C24] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                <Minus size={15} strokeWidth={3} />
              </button>
              <input type="text" inputMode="numeric" value={qtyText} onChange={onQtyChange} onBlur={onQtyBlur} aria-label="Quantity" className="h-9 w-14 rounded-lg border border-[#26262E] bg-[#16161C] text-center text-sm font-black text-[#F5F5F7] tabular-nums outline-none focus:border-[#FB923C]" />
              <button type="button" onClick={incQty} disabled={qty >= MAX_QUANTITY} aria-label="Increase quantity" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#26262E] bg-[#16161C] text-[#F5F5F7] hover:bg-[#1C1C24] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                <Plus size={15} strokeWidth={3} />
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {MULTIPLIER_OPTIONS.map((m) => (
              <button key={m} type="button" onClick={() => setMult(m)} aria-pressed={mult === m} className={'h-8 rounded-lg text-[10px] font-black tabular-nums transition-all active:scale-95 ' + (mult === m ? 'border border-[#FB923C] bg-gradient-to-b from-[#FB923C] to-[#F97316] text-[#181205] shadow-sm' : 'border border-[#26262E] bg-[#16161C] text-[#B9BAC6] hover:bg-[#1C1C24]')}>X{m}</button>
            ))}
          </div>
          <label className="mt-3.5 flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-[#9A9BA8]">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer accent-[#F97316]" />
            <span>I agree <span className="font-bold text-[#FB923C]">Pre-sale rules</span></span>
          </label>
          {lowBalance && isAuthenticated && (
            <p className="mt-2 rounded-lg border border-[#4A2323] bg-[#2A1515] px-2.5 py-2 text-[11px] font-semibold text-[#F87171]" role="alert">Insufficient balance in the main TDX wallet.</p>
          )}
          {!isAuthenticated && (
            <p className="mt-2 rounded-lg border border-[#1E3A5F] bg-[#0F1D33] px-2.5 py-2 text-[11px] font-semibold text-[#93C5FD]" role="status">Connect your wallet to place a ticket.</p>
          )}
        </div>
        <div className="flex items-stretch gap-2 border-t border-[#26262E] bg-[#0B0B10] px-4 py-3">
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-xl border border-[#26262E] bg-[#16161C] text-sm font-black text-[#B9BAC6] hover:bg-[#1C1C24] active:scale-[0.98]">Cancel</button>
          <button type="button" onClick={doConfirm} disabled={confirmBlocked} className="flex h-12 flex-[2] items-center justify-center gap-1.5 rounded-xl text-sm font-black text-[#181205] enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #FB923C, #F97316)' }}>
            {submitting && (<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#181205] border-t-transparent" aria-hidden />)}
            <Ticket size={15} strokeWidth={2.4} />
            Total amount {formatTdx(total)} TDX
          </button>
        </div>
      </div>
    </div>
  );
}
