import React, { useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  Check,
  CircleUserRound,
  Copy,
  Gift,
  IdCard,
  Mail,
  Phone,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWalletContext } from '../../wallet/context/WalletContext';

// ============================================================
// HELPERS
// ============================================================

const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

// ============================================================
// MY PROFILE SCREEN
// ============================================================

export default function MyProfileScreen() {
  const navigate = useNavigate();
  const { authUser, address } = useWalletContext();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const walletAddress = authUser?.walletAddress || address || null;
  const referralCode = authUser?.referralCode || null;

  const memberSince = authUser?.createdAt
    ? new Date(authUser.createdAt).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  // ============================================================
  // DETAIL ROWS
  // ============================================================

  type Row = {
    key: string;
    label: string;
    value: string | null;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    copyable?: boolean;
    mono?: boolean;
  };

  const rows: Row[] = [
    {
      key: 'mobile',
      label: 'Mobile Number',
      value: authUser?.mobileNumber || null,
      icon: Phone,
    },
    {
      key: 'email',
      label: 'Email',
      value: authUser?.email || null,
      icon: Mail,
    },
    {
      key: 'wallet',
      label: 'Wallet Address',
      value: walletAddress,
      icon: Wallet,
      copyable: true,
      mono: true,
    },
    {
      key: 'uid',
      label: 'User ID',
      value: authUser?.id || null,
      icon: IdCard,
      copyable: true,
      mono: true,
    },
    {
      key: 'referral',
      label: 'Referral Code',
      value: referralCode,
      icon: Gift,
      copyable: true,
      mono: true,
    },
    {
      key: 'referredBy',
      label: 'Referred By',
      value: authUser?.referredBy || null,
      icon: User,
      mono: true,
    },
    {
      key: 'role',
      label: 'Account Role',
      value: authUser?.role || null,
      icon: ShieldCheck,
    },
    {
      key: 'status',
      label: 'Account Status',
      value: authUser?.status || null,
      icon: BadgeCheck,
    },
    {
      key: 'memberSince',
      label: 'Member Since',
      value: memberSince,
      icon: Calendar,
    },
  ];

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#111217] via-[#1B1917] to-[#292B33] overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] bg-[#C99752]/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-20 -left-20 w-[300px] h-[300px] bg-[#FF7A18]/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-[#34343E]/60 bg-[#15161C]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center px-4">
          <button
            onClick={() => navigate('/profile')}
            className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl border border-[#34343E] bg-[#15161C] hover:bg-[#1B1917] transition-colors"
            aria-label="Back to profile"
          >
            <ArrowLeft size={20} className="text-[#A1A4AE]" />
          </button>

          <div>
            <h1 className="text-base font-bold text-[#F5F5F7]">My Profile</h1>
            <p className="text-[10px] text-[#70737E]">Your account details</p>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-6">
        {/* ========================================================= */}
        {/* PROFILE SUMMARY */}
        {/* ========================================================= */}

        <div className="relative overflow-hidden rounded-2xl border border-[#292B33] bg-[#15161C] shadow-sm p-5">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#C99752] via-[#C99752] to-[#8F4817]" />

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#211810] to-[#29211A] border-2 border-[#34261C] flex items-center justify-center">
                <CircleUserRound size={32} className="text-[#C99752]" />
              </div>
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-[#15161C]" />
            </div>

            {/* Name + status */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[#F5F5F7] truncate">
                  {authUser?.mobileNumber
                    ? `Trader ${authUser.mobileNumber.replace(/.(?=.{4})/g, '•')}`
                    : 'TradeX User'}
                </h2>
                <BadgeCheck size={16} className="text-green-500 shrink-0" />
              </div>

              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] font-medium text-[#4ADE80] bg-[#10251A] px-2 py-0.5 rounded-full border border-[#123A24]">
                  Verified
                </span>
                {memberSince && (
                  <span className="flex items-center gap-1 text-[10px] text-[#70737E]">
                    <Calendar size={10} />
                    {memberSince}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* ACCOUNT DETAILS */}
        {/* ========================================================= */}

        <div className="mt-4 w-full rounded-2xl bg-[#15161C] border border-[#292B33] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#292B33]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
              Account Details
            </h3>
          </div>

          {rows.map((row, index) => {
            const Icon = row.icon;
            const isLast = index === rows.length - 1;
            const hasValue = Boolean(row.value);

            return (
              <div
                key={row.key}
                className={`
                  flex items-center gap-3 px-4 py-3.5
                  ${!isLast ? 'border-b border-[#292B33]' : ''}
                  ${!hasValue ? 'opacity-50' : ''}
                `}
              >
                {/* Icon */}
                <div className="w-9 h-9 rounded-xl bg-[#211810] flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-[#C99752]" />
                </div>

                {/* Label + value */}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#70737E]">{row.label}</div>
                  <div
                    className={`
                      text-sm font-semibold text-[#F5F5F7] truncate
                      ${row.mono ? 'font-mono text-xs' : ''}
                    `}
                  >
                    {hasValue
                      ? row.key === 'wallet'
                        ? formatAddress(row.value as string)
                        : row.value
                      : 'Not provided'}
                  </div>
                </div>

                {/* Copy button */}
                {row.copyable && hasValue && (
                  <button
                    type="button"
                    onClick={() => void copy(row.key, row.value as string)}
                    aria-label={`Copy ${row.label}`}
                    className="w-8 h-8 rounded-lg border border-[#34343E] bg-[#15161C] flex items-center justify-center hover:bg-[#1B1917] transition-colors shrink-0"
                  >
                    {copiedKey === row.key ? (
                      <Check size={14} className="text-[#4ADE80]" />
                    ) : (
                      <Copy size={14} className="text-[#70737E]" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ========================================================= */}
        {/* NOT LOGGED-IN FALLBACK */}
        {/* ========================================================= */}

        {!authUser && (
          <div className="mt-4 w-full rounded-2xl bg-[#15161C] border border-[#4A2323] shadow-sm p-5 text-center">
            <p className="text-sm font-bold text-[#F87171]">No account data</p>
            <p className="text-xs text-[#A1A4AE] mt-1">
              Please sign in to view your profile details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

