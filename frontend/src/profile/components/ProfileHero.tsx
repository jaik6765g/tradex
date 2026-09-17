import React, { useState } from 'react';
import {
  BadgeCheck,
  CircleUserRound,
  Copy,
  Check,
  Calendar,
} from 'lucide-react';
import { useWalletContext } from '../../wallet/context/WalletContext';

export default function ProfileHero() {
  const { authUser } = useWalletContext();
  const [copied, setCopied] = useState(false);

  // Referral code
  const referralCode = authUser?.referralCode || '';

  const memberSince = authUser?.createdAt
    ? new Date(authUser.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'August 2025';

  const copyReferral = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  // ============================================================
  // PROFILE CARD — always rendered (mobile login account, no
  // wallet connection required)
  // ============================================================

  return (
    <div className="w-full rounded-2xl bg-[#15161C] border border-[#292B33] shadow-sm overflow-hidden">
      {/* Profile Header */}
      <div className="p-4 flex items-center gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#211810] to-[#211810] border-2 border-[#34261C] flex items-center justify-center">
            <CircleUserRound size={28} className="text-[#C99752]" />
          </div>
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
        </div>

        {/* User Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#F5F5F7]">TradeX User</h2>
            <BadgeCheck size={14} className="text-green-500 shrink-0" />
            <span className="text-[10px] font-medium text-[#4ADE80] bg-[#10251A] px-2 py-0.5 rounded-full border border-[#123A24]">
              Verified
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            {referralCode && (
              <button
                type="button"
                onClick={() => void copyReferral()}
                aria-label="Copy referral code"
                className="
                  text-[10px]
                  font-bold
                  text-[#C99752]
                  bg-[#211810]
                  px-2
                  py-0.5
                  rounded-full
                  border
                  border-[#34261C]
                  flex
                  items-center
                  gap-1
                "
              >
                UID: {referralCode}
                {copied ? (
                  <Check size={10} className="text-[#4ADE80]" />
                ) : (
                  <Copy size={10} />
                )}
              </button>
            )}
            <span className="flex items-center gap-1 text-[10px] text-[#70737E]">
              <Calendar size={10} className="text-[#70737E]" />
              {memberSince}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}