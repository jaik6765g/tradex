import React, { useMemo } from 'react';
import {
  Wallet,
  ArrowDownToLine,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  ArrowLeftRight,
  ChevronDown,
  ArrowRight,
  Zap,
} from 'lucide-react';

import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Skeleton from '../../../components/ui/Skeleton';
import Input from '../../../components/ui/Input';

import type {
  BotTransferWallet,
  BotWalletTransferDirection,
} from '../types/bot.types';

type Props = {
  loading: boolean;
  availableBalance?: string | null;
  isAccountMissing: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  mainBalance?: string | null;
  mainBalanceLoading?: boolean;
  transferAmount?: string | null;
  transferLoading: boolean;
  transferDirection: BotWalletTransferDirection;
  transferDirectionEnabled: boolean;
  transferDirectionMessage?: string | null;
  onAmountChange: (value: string) => void;
  onTransfer: () => void;
  onDirectionChange: (direction: BotWalletTransferDirection) => void;
};

const QUICK_AMOUNTS = ['1000', '5000', '10000', '50000'] as const;

const WALLET_LABELS: Record<BotTransferWallet, string> = {
  MAIN_WALLET: 'Main',
  BOT_WALLET: 'Bot',
};

function normalizeAmount(value?: string | null): string {
  return String(value ?? '').trim();
}

function parsePositiveAmount(value?: string | null): number | null {
  const normalized = normalizeAmount(value);
  if (!normalized) return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function formatTdxAmount(value?: string | null): string {
  const numericValue = Number(normalizeAmount(value));
  if (!Number.isFinite(numericValue)) return '0.00';
  return numericValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function directionToWallets(direction: BotWalletTransferDirection): {
  fromWallet: BotTransferWallet;
  toWallet: BotTransferWallet;
} {
  if (direction === 'TRANSFER_OUT') {
    return { fromWallet: 'BOT_WALLET', toWallet: 'MAIN_WALLET' };
  }
  return { fromWallet: 'MAIN_WALLET', toWallet: 'BOT_WALLET' };
}

function walletsToDirection(
    fromWallet: BotTransferWallet,
    toWallet: BotTransferWallet,
): BotWalletTransferDirection {
  if (fromWallet === 'MAIN_WALLET' && toWallet === 'BOT_WALLET') {
    return 'TRANSFER_IN';
  }
  return 'TRANSFER_OUT';
}

export default function BotWalletCard({
                                        loading,
                                        availableBalance,
                                        isAccountMissing,
                                        errorMessage,
                                        onRetry,
                                        mainBalance,
                                        mainBalanceLoading = false,
                                        transferAmount,
                                        transferLoading,
                                        transferDirection,
                                        transferDirectionEnabled,
                                        transferDirectionMessage,
                                        onAmountChange,
                                        onTransfer,
                                        onDirectionChange,
                                      }: Props) {
  const normalizedTransferAmount = normalizeAmount(transferAmount);

  const parsedMainBalance = Number(normalizeAmount(mainBalance));
  const parsedBotBalance = Number(normalizeAmount(availableBalance));

  const mainWalletBalance = Number.isFinite(parsedMainBalance) ? parsedMainBalance : 0;
  const botWalletBalance = Number.isFinite(parsedBotBalance) ? parsedBotBalance : 0;

  const wallets = useMemo(() => directionToWallets(transferDirection), [transferDirection]);
  const { fromWallet, toWallet } = wallets;

  const fromBalance = fromWallet === 'MAIN_WALLET' ? mainWalletBalance : botWalletBalance;
  const toBalance = toWallet === 'MAIN_WALLET' ? mainWalletBalance : botWalletBalance;
  const fromBalanceLoading = fromWallet === 'MAIN_WALLET' ? mainBalanceLoading : loading;

  const parsedTransferAmount = parsePositiveAmount(normalizedTransferAmount);
  const hasTransferAmount = normalizedTransferAmount.length > 0;
  const hasInsufficientBalance = parsedTransferAmount != null && parsedTransferAmount > fromBalance;

  const transferDisabledBecauseLoading = loading || mainBalanceLoading || transferLoading;
  const transferDisabledBecauseAmount = parsedTransferAmount == null || hasInsufficientBalance;
  const transferDisabledBecauseState = isAccountMissing || Boolean(errorMessage) || !transferDirectionEnabled;
  const transferDisabled = transferDisabledBecauseLoading || transferDisabledBecauseAmount || transferDisabledBecauseState;

  const buttonLabel = transferDirection === 'TRANSFER_OUT' ? 'Transfer to Main' : 'Transfer to Bot';

  const handleSwapDirection = () => {
    if (!transferDirectionEnabled || transferLoading) return;
    const nextDirection = transferDirection === 'TRANSFER_IN' ? 'TRANSFER_OUT' : 'TRANSFER_IN';
    onDirectionChange(nextDirection);
  };

  const handleFromWalletChange: React.ChangeEventHandler<HTMLSelectElement> = (event) => {
    const selectedFrom = event.target.value as BotTransferWallet;
    const selectedTo: BotTransferWallet = selectedFrom === 'MAIN_WALLET' ? 'BOT_WALLET' : 'MAIN_WALLET';
    onDirectionChange(walletsToDirection(selectedFrom, selectedTo));
  };

  const handleMaxAmount = () => {
    if (transferDisabledBecauseLoading || transferDisabledBecauseState || fromBalanceLoading) return;
    onAmountChange(fromBalance.toString());
  };

  const handleQuickAmount = (quickValue: string) => {
    if (transferDisabledBecauseLoading || transferDisabledBecauseState) return;
    onAmountChange(quickValue);
  };

  return (
      <Card className="overflow-hidden rounded-[20px] border border-[#E5E7EB]">
        {/* ─── Balance Header ─── */}
        <section className="relative bg-[#0D1B2A] px-5 pt-5 pb-5">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-[#FBBF24]/[0.05]" />

          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#FBBF24]/[0.12] ring-1 ring-[#FBBF24]/10">
                <Wallet size={20} strokeWidth={2} className="text-[#FBBF24]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-black text-white">Bot Wallet</h2>
                  <div className="flex items-center gap-1 rounded-full bg-[#FBBF24]/10 px-1.5 py-0.5">
                    <Zap size={9} className="text-[#FBBF24]" />
                    <span className="text-[9px] font-extrabold text-[#FBBF24]">AI</span>
                  </div>
                </div>
                <p className="text-[10px] font-medium text-[#64748B]">Automated trading funds</p>
              </div>
            </div>

            {!loading && !errorMessage && !isAccountMissing && (
                <div className="flex items-center gap-1 rounded-full border border-[#22C55E]/20 bg-[#22C55E]/10 px-2 py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                  <span className="text-[9px] font-black text-[#86EFAC]">LIVE</span>
                </div>
            )}

            {onRetry && !loading && errorMessage && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-[#FBBF24] hover:bg-[#FBBF24]/10"
                >
                  <RefreshCw size={11} />
                  Retry
                </button>
            )}
          </div>

          {loading && (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-2.5 w-24 bg-[#1E293B]" />
                <Skeleton className="h-9 w-40 bg-[#1E293B]" />
              </div>
          )}

          {!loading && errorMessage && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#EF4444]/15 bg-[#EF4444]/[0.06] p-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-[#EF4444]" />
                <p className="text-xs font-bold text-[#FCA5A5]">{errorMessage}</p>
              </div>
          )}

          {!loading && !errorMessage && isAccountMissing && (
              <div className="mt-4 rounded-lg border border-[#334155] bg-[#111C2C] p-3">
                <p className="text-xs font-bold text-[#CBD5E1]">Bot account not created yet.</p>
                <p className="mt-0.5 text-[10px] text-[#64748B]">Transfer funds to activate.</p>
              </div>
          )}

          {!loading && !errorMessage && !isAccountMissing && (
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Available Balance</p>
                <div className="mt-1 flex items-baseline">
              <span className="text-[34px] font-black leading-none tracking-tight text-white">
                {formatTdxAmount(availableBalance)}
              </span>
                  <span className="ml-1.5 text-[14px] font-black text-[#FBBF24]">TDX</span>
                </div>
              </div>
          )}
        </section>

        {/* ─── Transfer Section ─── */}
        <section className="bg-white px-5 pt-4 pb-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#EFF6FF]">
              <ArrowDownToLine size={16} strokeWidth={2.2} className="text-[#175CD3]" />
            </div>
            <div>
              <h3 className="text-[14px] font-black text-[#101828]">Transfer</h3>
              <p className="text-[10px] font-medium text-[#667085]">Move TDX between wallets</p>
            </div>
          </div>

          {transferDirectionMessage && (
              <div className="mt-2 rounded-md border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1.5 text-[10px] font-bold text-[#B54708]">
                {transferDirectionMessage}
              </div>
          )}

          {/* Wallet Selector Row */}
          <div className="mt-3 flex items-end gap-2">
            {/* From */}
            <div className="flex-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
              <label className="text-[9px] font-bold uppercase tracking-wide text-[#98A2B3]">From</label>
              <div className="relative mt-1">
                <select
                    value={fromWallet}
                    onChange={handleFromWalletChange}
                    disabled={transferLoading || !transferDirectionEnabled}
                    className="h-9 w-full appearance-none rounded-lg border border-[#D0D5DD] bg-white px-2.5 pr-7 text-[13px] font-black text-[#344054] outline-none focus:border-[#175CD3] focus:ring-2 focus:ring-[#175CD3]/20 disabled:cursor-not-allowed disabled:bg-[#F2F4F7]"
                >
                  <option value="MAIN_WALLET" disabled={toWallet === 'MAIN_WALLET'}>Main Wallet</option>
                  <option value="BOT_WALLET" disabled={toWallet === 'BOT_WALLET'}>Bot Wallet</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#667085]" />
              </div>
              <div className="mt-1.5 text-[11px] font-black text-[#101828]">
                {fromBalanceLoading ? <Skeleton className="h-3.5 w-20" /> : <>{formatTdxAmount(fromBalance.toString())} <span className="text-[#FBBF24]">TDX</span></>}
              </div>
            </div>

            {/* Swap */}
            <button
                type="button"
                onClick={handleSwapDirection}
                disabled={!transferDirectionEnabled || transferLoading}
                className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-[#D0D5DD] bg-white text-[#175CD3] shadow-sm transition hover:border-[#175CD3] hover:bg-[#EFF6FF] disabled:opacity-50"
            >
              <ArrowLeftRight size={15} />
            </button>

            {/* To */}
            <div className="flex-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
              <label className="text-[9px] font-bold uppercase tracking-wide text-[#98A2B3]">To</label>
              <div className="relative mt-1">
                <select
                    value={toWallet}
                    onChange={(e) => {
                      const selectedTo = e.target.value as BotTransferWallet;
                      const selectedFrom: BotTransferWallet = selectedTo === 'MAIN_WALLET' ? 'BOT_WALLET' : 'MAIN_WALLET';
                      onDirectionChange(walletsToDirection(selectedFrom, selectedTo));
                    }}
                    disabled={transferLoading || !transferDirectionEnabled}
                    className="h-9 w-full appearance-none rounded-lg border border-[#D0D5DD] bg-white px-2.5 pr-7 text-[13px] font-black text-[#344054] outline-none focus:border-[#175CD3] focus:ring-2 focus:ring-[#175CD3]/20 disabled:cursor-not-allowed disabled:bg-[#F2F4F7]"
                >
                  <option value="MAIN_WALLET" disabled={fromWallet === 'MAIN_WALLET'}>Main Wallet</option>
                  <option value="BOT_WALLET" disabled={fromWallet === 'BOT_WALLET'}>Bot Wallet</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#667085]" />
              </div>
              <div className="mt-1.5 text-[11px] font-black text-[#101828]">
                {fromBalanceLoading ? <Skeleton className="h-3.5 w-20" /> : <>{formatTdxAmount(toBalance.toString())} <span className="text-[#FBBF24]">TDX</span></>}
              </div>
            </div>
          </div>

          {/* Amount Input */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[11px] font-black text-[#344054]">Amount</label>
              <button
                  type="button"
                  onClick={handleMaxAmount}
                  disabled={transferDisabledBecauseLoading || transferDisabledBecauseState || fromBalanceLoading}
                  className="rounded px-1.5 py-0.5 text-[10px] font-black text-[#175CD3] transition hover:bg-[#EFF6FF] disabled:opacity-40"
              >
                MAX
              </button>
            </div>

            <div className="relative">
              <Input
                  label=""
                  value={normalizedTransferAmount}
                  onChange={onAmountChange}
                  placeholder="0.00"
                  inputMode="decimal"
                  min="0"
                  disabled={transferDisabledBecauseLoading || transferDisabledBecauseState}
                  className="h-11 pr-12 text-[15px] font-black"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-[#98A2B3]">TDX</span>
            </div>

            {hasTransferAmount && parsedTransferAmount == null && (
                <p className="mt-1 text-[10px] font-bold text-[#D92D20]">Enter a valid TDX amount.</p>
            )}
            {hasInsufficientBalance && (
                <p className="mt-1 text-[10px] font-bold text-[#D92D20]">Exceeds {WALLET_LABELS[fromWallet]} balance.</p>
            )}
          </div>

          {/* Quick Amounts */}
          <div className="mt-3">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#98A2B3]">Quick Select</p>
            <div className="mt-1.5 flex gap-2">
              {QUICK_AMOUNTS.map((quickAmount) => (
                  <button
                      key={quickAmount}
                      type="button"
                      onClick={() => handleQuickAmount(quickAmount)}
                      disabled={transferDisabledBecauseLoading || transferDisabledBecauseState}
                      className="flex-1 rounded-lg border border-[#D0D5DD] bg-white py-2 text-[11px] font-black text-[#344054] transition hover:border-[#175CD3] hover:bg-[#EFF6FF] disabled:opacity-50"
                  >
                    {Number(quickAmount).toLocaleString('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 0 })}
                  </button>
              ))}
            </div>
          </div>

          {/* Summary + Button */}
          <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-[#667085]">You send</p>
                <p className="text-lg font-black text-[#101828]">
                  {formatTdxAmount(normalizedTransferAmount || '0')} <span className="text-[#FBBF24] text-sm">TDX</span>
                </p>
              </div>
              <div className="flex items-center gap-1 text-[#667085]">
                <ArrowRight size={14} className="text-[#175CD3]" />
                <span className="text-[10px] font-bold">{WALLET_LABELS[toWallet]}</span>
              </div>
            </div>
          </div>

          <Button
              type="button"
              loading={transferLoading}
              disabled={transferDisabled}
              onClick={onTransfer}
              size="md"
              className="mt-3 w-full h-11 text-[14px] font-black"
          >
            {transferLoading ? 'Processing...' : buttonLabel}
          </Button>

          <div className="mt-2 flex items-center justify-center gap-1">
            <ShieldCheck size={11} className="text-[#98A2B3]" />
            <p className="text-[9px] font-medium text-[#98A2B3]">Secure transfer validation</p>
          </div>
        </section>
      </Card>
  );
}