// src/profile/components/WalletSection.tsx
//
// Profile wallet card.
//
// Wallet CONNECTION has been removed from the player app — accounts are created
// and used with mobile-number login (see auth/authContext). This card therefore
// always renders the signed-in account's TDX wallet together with the
// Deposit / Withdraw / History actions, and never asks the user to connect a
// wallet.
//
// Wallet connection still exists for the ADMIN panel only, where it is required
// to sign on-chain withdrawal payouts (AdminWithdrawalsScreen).

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Eye,
  Gift,
  History,
  Wallet,
} from 'lucide-react';

import { useWalletContext } from '../../wallet/context/WalletContext';

export default function WalletSection() {
  const navigate = useNavigate();
  const [copiedReferral, setCopiedReferral] = useState(false);

  const { authUser, tdxBalance, balance } = useWalletContext();

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatTDX = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleCopyReferral = async () => {
    if (!authUser?.referralCode) return;
    try {
      await navigator.clipboard.writeText(authUser.referralCode);
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 1800);
    } catch {}
  };

  // Payout address linked to the account (stored on the backend), if any.
  const linkedAddress = authUser?.walletAddress ?? null;

  return (
    <div className="w-full rounded-2xl bg-[#15161C] border border-[#292B33] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#211810] flex items-center justify-center">
          <Wallet size={20} className="text-[#C99752]" />
        </div>
        <div>
          <h3 className="text-base font-bold text-[#F5F5F7]">Wallet</h3>
          <p className="text-xs text-[#70737E]">TradeX TDX Wallet</p>
        </div>
      </div>

      {/* Balance */}
      <div className="mx-5 mt-4 rounded-xl bg-[#211810] border border-[#34261C] p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#A1A4AE]">Total Balance</span>
          <Eye size={13} className="text-[#70737E]" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#F5F5F7]">{formatTDX(tdxBalance)}</span>
          <span className="text-sm font-semibold text-[#A1A4AE]">TDX</span>
        </div>
        <div className="mt-3 flex gap-4">
          <div>
            <p className="text-[10px] font-medium text-[#70737E] uppercase tracking-wider">Available</p>
            <p className="text-sm font-bold text-[#E4E5E8]">{formatTDX(balance.tdxAvailable)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-[#70737E] uppercase tracking-wider">Locked</p>
            <p className="text-sm font-bold text-[#E4E5E8]">{formatTDX(balance.tdxLocked)}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions — always available */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-2">
        <button onClick={() => navigate('/deposit')} className="flex flex-col items-center gap-1.5 rounded-xl border border-[#34343E] bg-[#1B1917] py-3 hover:bg-[#211810] hover:border-[#34261C] transition">
          <ArrowDownToLine size={18} className="text-[#C99752]" />
          <span className="text-[10px] font-semibold text-[#A1A4AE]">Deposit</span>
        </button>
        <button onClick={() => navigate('/withdraw')} className="flex flex-col items-center gap-1.5 rounded-xl border border-[#34343E] bg-[#1B1917] py-3 hover:bg-[#10251A] hover:border-[#123A24] transition">
          <ArrowUpFromLine size={18} className="text-[#4ADE80]" />
          <span className="text-[10px] font-semibold text-[#A1A4AE]">Withdraw</span>
        </button>
        <button onClick={() => navigate('/transactions')} className="flex flex-col items-center gap-1.5 rounded-xl border border-[#34343E] bg-[#1B1917] py-3 hover:bg-[#2A190D] hover:border-[#3A281C] transition">
          <History size={18} className="text-[#FF8F3D]" />
          <span className="text-[10px] font-semibold text-[#A1A4AE]">History</span>
        </button>
      </div>

      {/* Linked payout address (rendered only when the account has one) */}
      {linkedAddress && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-[#34343E] bg-[#1B1917] px-3 py-2.5">
          <Wallet size={15} className="text-[#70737E]" />
          <span className="flex-1 text-sm font-mono text-[#A1A4AE]">{formatAddress(linkedAddress)}</span>
        </div>
      )}

      {/* Referral code */}
      {authUser?.referralCode && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-[#3A281C] bg-[#2A190D] px-3 py-2.5">
          <Gift size={15} className="text-[#F59E0B]" />
          <span className="flex-1 text-sm font-mono font-bold text-[#F59E0B]">{authUser.referralCode}</span>
          <button onClick={handleCopyReferral} className="text-[#70737E] hover:text-[#A1A4AE]">
            {copiedReferral ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
          </button>
          <span className="text-[10px] font-medium text-[#4ADE80] bg-[#10251A] px-2 py-0.5 rounded-full border border-[#123A24]">Active</span>
        </div>
      )}

      <div className="pb-5" />
    </div>
  );
}