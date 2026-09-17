import React, { useEffect, useMemo, useState } from 'react';

import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Gamepad2,
  Link,
  MessageCircle,
  Network,
  Send,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import {
  getReferralDashboard,
  ReferralDashboardResponse,
} from '../services/referral';

type ReferralType = 'game' | 'trade' | 'bot';

const referralTypes = {
  game: {
    title: 'Game Referral',
    subtitle: 'Earn from Game',
    icon: Gamepad2,
    color: '#C99752',
    bg: '#211810',
    description:
      'Earn referral rewards when your network participates in TradeX games.',
  },
  trade: {
    title: 'Trade Referral',
    subtitle: 'Earn from Trade',
    icon: TrendingUp,
    color: '#C99752',
    bg: '#211810',
    description:
      'Earn referral rewards from eligible trading activity across your network.',
  },
  bot: {
    title: 'Bot Referral',
    subtitle: 'Earn from Bot',
    icon: Bot,
    color: '#FF8F3D',
    bg: '#2A190D',
    description:
      'Earn referral rewards from eligible automated bot activity.',
  },
};

function formatNumber(value: string) {
  return value;
}

export default function Referral() {
  const [activeType, setActiveType] = useState<ReferralType>('game');
  const [copied, setCopied] = useState(false);
  const [expandedLevels, setExpandedLevels] = useState<number[]>([1, 2]);

  // ============================================================
  // API STATE
  // ============================================================

  const [referralData, setReferralData] = useState<ReferralDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // REFERRAL LINK
  // ============================================================

  const referralLink = useMemo(() => {
    return referralData?.referralLink ?? '';
  }, [referralData]);

  const referralCode = useMemo(() => {
    return referralData?.referralCode ?? '';
  }, [referralData]);

  // ============================================================
  // LOAD REFERRAL DATA
  // ============================================================

  useEffect(() => {
    let mounted = true;

    async function loadReferral() {
      try {
        setLoading(true);
        setError(null);

        const data = await getReferralDashboard();

        if (mounted) {
          setReferralData(data);
        }
      } catch (err) {
        console.error('Failed to load referral dashboard:', err);

        if (mounted) {
          setError('Unable to load referral data. Please try again.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadReferral();

    return () => {
      mounted = false;
    };
  }, []);

  // ============================================================
  // HELPERS
  // ============================================================

  const type = referralTypes[activeType];
  const TypeIcon = type.icon;

  const toggleLevel = (level: number) => {
    setExpandedLevels((current) =>
      current.includes(level)
        ? current.filter((item) => item !== level)
        : [...current, level],
    );
  };

  const copyReferral = async () => {
    if (!referralLink) return;

    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  };

  const shareReferral = async () => {
    if (!referralLink) return;

    const shareData = {
      title: 'Join TradeX',
      text: `Join me on TradeX using referral code: ${referralCode}`,
      url: referralLink,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // User cancelled sharing.
      }
    }

    await copyReferral();
  };

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatTDX = (value: string | number | undefined): string => {
    const num = Number(value ?? 0);
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatWallet = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111217] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF7A18] mx-auto" />
          <p className="mt-4 text-[#A1A4AE]">Loading referral data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#111217] flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-[#A1A4AE]">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-[#FF7A18] text-[#F5F5F7] rounded-lg font-bold hover:bg-[#FF8F3D]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111217] pb-28">
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5">
        <div className="space-y-4">
          {/* Hero */}
          <section className="relative overflow-hidden rounded-[22px] bg-[#211810] min-h-[300px]">
            <div className="absolute -right-16 -top-20 h-[260px] w-[260px] rounded-full bg-[#FF7A18]/[0.08]" />
            <div className="absolute right-[18%] bottom-[-100px] h-[220px] w-[220px] rounded-full bg-[#FF7A18]/[0.05]" />

            <div className="relative z-10 grid min-h-[300px] grid-cols-1 md:grid-cols-[1.25fr_0.75fr]">
              <div className="flex flex-col justify-center p-6 md:p-8">
                <h1 className="text-[30px] font-black leading-tight text-white">
                  Refer{' '}
                  <span className="text-[#FF7A18]">& Earn</span>
                </h1>

                <p className="mt-2 text-sm leading-6 text-[#292B33]">
                  Invite your friends and earn TDX rewards
                </p>

                <p className="text-sm leading-6 text-[#292B33]">
                  across Game, Trade and Bot.
                </p>

                <p className="mt-5 mb-2 text-sm font-extrabold text-[#FF8F3D]">
                  Your Referral Link
                </p>

                <div className="flex h-[52px] max-w-[520px] overflow-hidden rounded-[13px] border border-[#4F525C] bg-[#211810]">
                  <div className="flex min-w-0 flex-1 items-center px-3">
                    <span className="truncate text-sm text-white">
                      {referralLink || 'No referral link available'}
                    </span>
                  </div>

                  <button
                    onClick={copyReferral}
                    disabled={!referralLink}
                    className="flex w-[52px] shrink-0 items-center justify-center bg-[#FF7A18] text-[#F5F5F7] hover:bg-[#FF8F3D] disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy referral link"
                  >
                    {copied ? <Check size={21} /> : <Copy size={21} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-6 pb-7 md:pb-0">
                <div className="mb-3 flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#FF7A18]/10">
                  <div className="flex h-[92px] w-[92px] items-center justify-center rounded-full bg-[#FF7A18]/15">
                    <Sparkles size={66} className="text-[#FF7A18]" />
                  </div>
                </div>

                <span className="mb-2 text-[13px] text-[#34343E]">
                  Share via
                </span>

                <div className="flex gap-2">
                  <button
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22C55E] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Share on WhatsApp"
                  >
                    <MessageCircle size={21} />
                  </button>

                  <button
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FF8F3D] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Share"
                  >
                    <Send size={20} />
                  </button>

                  <button
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4F525C] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="More sharing options"
                  >
                    <Share2 size={21} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Stats - Real API Data */}
          <section className="grid grid-cols-1 overflow-hidden rounded-[18px] border border-[#292B33] bg-[#15161C] sm:grid-cols-3">
            <StatCard
              icon={<Users size={22} />}
              iconColor="#C99752"
              title="Total Network"
              value={String(referralData?.stats.totalNetwork ?? 0)}
            />

            <StatCard
              icon={<Network size={22} />}
              iconColor="#4ADE80"
              title="Total Active"
              value={String(referralData?.stats.totalActive ?? 0)}
              divider
            />

            <StatCard
              icon={<Wallet size={22} />}
              iconColor="#FF8F3D"
              title="Total Earned"
              value={`${formatTDX(referralData?.stats.totalEarned)} TDX`}
              divider
            />
          </section>

          {/* Referral link */}
          <section className="rounded-[18px] border border-[#292B33] bg-[#15161C] p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-[17px] font-extrabold text-[#F5F5F7]">
                  Your Referral Link
                </h2>
                <p className="mt-1 text-xs text-[#70737E]">
                  Share your link and invite new users
                </p>
              </div>

              <Link size={24} className="text-[#FF8F3D]" />
            </div>

            <div className="flex h-12 overflow-hidden rounded-xl border border-[#292B33] bg-[#15161C]">
              <div className="flex min-w-0 flex-1 items-center px-3">
                <span className="truncate text-sm text-[#E4E5E8]">
                  {referralLink || 'No referral link available'}
                </span>
              </div>

              <button
                onClick={copyReferral}
                disabled={!referralLink}
                className="flex w-12 shrink-0 items-center justify-center bg-[#FF7A18] text-[#F5F5F7] hover:bg-[#FF8F3D] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? <Check size={19} /> : <Copy size={19} />}
              </button>
            </div>

            <button
              onClick={shareReferral}
              disabled={!referralLink}
              className="mt-2.5 flex h-[42px] w-full items-center justify-center gap-2 rounded-[11px] bg-[#2A190D] text-sm font-bold text-[#F5F5F7] hover:bg-[#33220F] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Share2 size={18} />
              Share Referral Link
            </button>
          </section>

          {/* Referral type tabs */}
          <section className="grid grid-cols-1 overflow-hidden rounded-[18px] border border-[#292B33] bg-[#15161C] sm:grid-cols-3">
            {(Object.keys(referralTypes) as ReferralType[]).map((key) => {
              const item = referralTypes[key];
              const Icon = item.icon;
              const active = activeType === key;

              return (
                <button
                  key={key}
                  onClick={() => setActiveType(key)}
                  className={`relative flex min-h-[105px] items-center justify-center gap-3 px-4 py-4 transition ${
                    active ? 'bg-[#2A190D]' : 'bg-[#15161C] hover:bg-[#15161C]'
                  }`}
                >
                  <div
                    className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: item.bg }}
                  >
                    <Icon size={23} style={{ color: item.color }} />
                  </div>

                  <div className="text-left">
                    <div className="text-xs font-extrabold text-[#F5F5F7]">
                      {item.title}
                    </div>

                    <div className="mt-1 text-[10px] text-[#A1A4AE]">
                      {item.subtitle}
                    </div>
                  </div>

                  {active && (
                    <div className="absolute bottom-0 left-1/2 h-[3px] w-[42px] -translate-x-1/2 rounded-full bg-[#FF8F3D]" />
                  )}
                </button>
              );
            })}
          </section>

          {/* Active referral type */}
          <section className="rounded-[18px] border border-[#292B33] bg-[#15161C] p-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: type.bg }}
              >
                <TypeIcon size={21} style={{ color: type.color }} />
              </div>

              <div>
                <h2 className="text-base font-extrabold text-[#F5F5F7]">
                  {type.title}
                </h2>
                <p className="mt-1 text-xs text-[#A1A4AE]">
                  {type.description}
                </p>
              </div>
            </div>
          </section>

          {/* Level structure - REAL API DATA */}
          <section className="rounded-[18px] border border-[#292B33] bg-[#15161C] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-[#F5F5F7]">
                  Referral Structure
                </h2>
                <p className="mt-1 text-xs text-[#A1A4AE]">
                  Your network earnings by level
                </p>
              </div>

              <span className="rounded-full bg-[#2A190D] px-3 py-1.5 text-xs font-bold text-[#FDBA74]">
                6 Levels
              </span>
            </div>

            <div className="space-y-2">
              {referralData?.levels.map((level) => {
                const expanded = expandedLevels.includes(level.level);

                return (
                  <div
                    key={level.level}
                    className="overflow-hidden rounded-[14px] border border-[#202229]"
                  >
                    <button
                      onClick={() => toggleLevel(level.level)}
                      className="flex w-full items-center gap-3 bg-[#1A1A20] px-4 py-3 text-left hover:bg-[#15161C]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF7A18] text-xs font-extrabold text-white">
                        L{level.level}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-[#F5F5F7]">
                          Level {level.level}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#A1A4AE]">
                          {level.totalUsers} users · {level.activeUsers} active
                        </div>
                      </div>

                      <span className="rounded-full bg-[#2A190D] px-2.5 py-1 text-xs font-extrabold text-[#FDBA74]">
                        {level.percentage}%
                      </span>

                      {expanded ? (
                        <ChevronUp size={18} className="text-[#A1A4AE]" />
                      ) : (
                        <ChevronDown size={18} className="text-[#A1A4AE]" />
                      )}
                    </button>

                    {expanded && (
                      <div className="border-t border-[#202229] bg-[#15161C]">
                        {level.users.length === 0 ? (
                          <div className="px-4 py-5 text-center text-xs text-[#70737E]">
                            No users at this level yet.
                          </div>
                        ) : (
                          level.users.map((user) => (
                            <div
                              key={user.userId}
                              className="flex items-center gap-3 border-b border-[#1B1917] px-4 py-3 last:border-b-0"
                            >
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1B1917] text-xs font-extrabold text-[#A1A4AE]">
                                {user.walletAddress.slice(0, 1).toUpperCase()}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-[#F5F5F7]">
                                    {formatWallet(user.walletAddress)}
                                  </span>

                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      user.active ? 'bg-[#22C55E]' : 'bg-[#A1A4AE]'
                                    }`}
                                  />
                                </div>

                                <div className="mt-0.5 text-[10px] text-[#70737E]">
                                  {user.active ? 'Active' : 'Inactive'}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs font-bold text-[#F5F5F7]">
                                  {formatTDX(user.tradeVolume)} TDX
                                </div>
                                <div className="mt-0.5 text-[10px] font-bold text-[#4ADE80]">
                                  +{formatTDX(user.earned)} TDX
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bottom summary - Real API Data */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={<Users size={19} />}
              label="Network Users"
              value={String(referralData?.stats.totalNetwork ?? 0)}
            />

            <SummaryCard
              icon={<TrendingUp size={19} />}
              label="Active Users"
              value={String(referralData?.stats.totalActive ?? 0)}
            />

            <SummaryCard
              icon={<Wallet size={19} />}
              label="Total Rewards"
              value={`${formatTDX(referralData?.stats.totalEarned)} TDX`}
              highlight
            />
          </section>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function StatCard({
  icon,
  iconColor,
  title,
  value,
  divider,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-3 px-4 py-5 ${
        divider ? 'border-t border-[#292B33] sm:border-l sm:border-t-0' : ''
      }`}
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        style={{
          color: iconColor,
          backgroundColor: `${iconColor}15`,
        }}
      >
        {icon}
      </div>

      <div>
        <div className="text-xs text-[#A1A4AE]">{title}</div>
        <div className="mt-1 text-lg font-black text-[#F5F5F7]">{value}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          highlight ? 'bg-[#2A190D] text-[#FF8F3D]' : 'bg-[#1B1917] text-[#A1A4AE]'
        }`}
      >
        {icon}
      </div>

      <div>
        <div className="text-[11px] text-[#A1A4AE]">{label}</div>
        <div className="mt-1 text-sm font-extrabold text-[#F5F5F7]">{value}</div>
      </div>
    </div>
  );
}