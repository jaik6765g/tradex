import React, { useState } from 'react';
import {
  BadgeCheck,
  CircleUserRound,
  Copy,
  Check,
  Calendar,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { useWalletContext } from '../../wallet/context/WalletContext';

export default function ProfileHero() {
  const { address, isConnected } = useAccount();
  const { tdxBalance } = useWalletContext();
  const [copied, setCopied] = useState(false);

  const userId = address ? `TDX-${address.slice(2, 10).toUpperCase()}` : 'TDX-8F29K';
  const memberSince = 'August 2025';

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  // ============================================================
  // NOT CONNECTED
  // ============================================================

  if (!isConnected) {
    return (
      <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm p-5 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center mb-3">
          <CircleUserRound size={32} className="text-gray-400" />
        </div>
        <h3 className="text-sm font-bold text-gray-800">Connect Wallet</h3>
        <p className="text-xs text-gray-500 mt-1">Please connect your wallet to view profile</p>
      </div>
    );
  }

  // ============================================================
  // CONNECTED
  // ============================================================

  return (
    <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      {/* Profile Header */}
      <div className="p-4 flex items-center gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 border-2 border-blue-200 flex items-center justify-center">
            <CircleUserRound size={28} className="text-blue-600" />
          </div>
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
        </div>

        {/* User Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">TradeX User</h2>
            <BadgeCheck size={14} className="text-green-500 shrink-0" />
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {userId}
            </span>
            <button onClick={copyId} className="text-gray-400 hover:text-gray-600">
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            </button>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <Calendar size={10} /> {memberSince}
            </span>
            <span className="text-[10px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              Verified
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}