import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

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
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import {
  getReferralDashboard,
  type ReferralDashboardResponse,
  type ReferralLevel,
} from '../services/referral';
import {
  fetchReferralTypeDistribution,
  formatDistributionPercent,
  type ReferralTypeDistribution,
} from '../services/referralDistribution';

// ============================================================
// REFERRAL TYPES
// ============================================================

type ReferralType = 'game' | 'trade' | 'bot';

// ============================================================
// TYPE CONFIG
// ============================================================

const referralTypes: Record<
  ReferralType,
  {
    title: string;
    subtitle: string;
    icon: typeof Gamepad2;
    color: string;
    bg: string;
    description: string;
    available: boolean;
  }
> = {
  game: {
    title: 'Game Referral',
    subtitle: 'Earn from Game',
    icon: Gamepad2,
    color: '#7C3AED',
    bg: '#F3EAFF',
    description:
      'Earn referral rewards when your network participates in TradeX games.',
    available: true,
  },

  trade: {
    title: 'Trade Referral',
    subtitle: 'Earn from Trade',
    icon: TrendingUp,
    color: '#2563EB',
    bg: '#EAF3FF',
    description:
      'Earn referral rewards from eligible Pulse Trade activity across your network.',
    available: true,
  },

  bot: {
    title: 'Bot Referral',
    subtitle: 'Earn from Bot',
    icon: Bot,
    color: '#F59E0B',
    bg: '#FFF5D8',
    description:
      'Earn referral rewards from eligible automated bot activity.',
    available: true,
  },
};

// ============================================================
// NUMBER FORMATTERS
// ============================================================

function formatTDX(
  value: string | number | null | undefined,
): string {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatWallet(
  address: string | undefined | null,
): string {
  if (!address) {
    return 'Unknown';
  }

  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(
  value: string | undefined,
): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================
// MAIN SCREEN
// ============================================================

export default function ReferralScreen() {
  // ==========================================================
  // UI STATE
  // ==========================================================

  const [activeType, setActiveType] =
    useState<ReferralType>('trade');

  const [copied, setCopied] =
    useState(false);

  const [expandedLevels, setExpandedLevels] =
    useState<number[]>([1, 2]);

  // ==========================================================
  // API STATE
  // ==========================================================

  const [referralData, setReferralData] =
    useState<ReferralDashboardResponse | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  // ==========================================================
  // DISTRIBUTION STATE (backend-configured percentages/levels)
  // ==========================================================

  const [distribution, setDistribution] =
    useState<ReferralTypeDistribution | null>(
      null,
    );

  // ==========================================================
  // LOAD DATA
  // ==========================================================

  const loadReferral = useCallback(
    async () => {
      try {
        setLoading(true);
        setError(null);

        const data =
          await getReferralDashboard();

        setReferralData(data);
      } catch (err) {
        console.error(
          'Failed to load referral dashboard:',
          err,
        );

        let message =
          'Unable to load referral data.';

        if (
          err &&
          typeof err === 'object' &&
          'response' in err
        ) {
          const response =
            (
              err as {
                response?: {
                  status?: number;
                  data?: {
                    message?: string;
                  };
                };
              }
            ).response;

          if (response?.status === 401) {
            message =
              'Your session has expired. Please reconnect your wallet.';
          } else if (
            response?.data?.message
          ) {
            message =
              String(
                response.data.message,
              );
          }
        }

        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadReferral();
  }, [loadReferral]);

  // ==========================================================
  // LOAD DISTRIBUTION (backend-configured percentages/levels)
  // ----------------------------------------------------------
  // Trade percentages resolve from the referral dashboard;
  // Bot percentages are fetched live from GET /bot/settings
  // when accessible; Game mirrors the backend lotto policy.
  // ==========================================================

  useEffect(() => {
    let mounted = true;

    void fetchReferralTypeDistribution(
      referralData?.levels,
    ).then((data) => {
      if (mounted) {
        setDistribution(data);
      }
    });

    return () => {
      mounted = false;
    };
  }, [referralData]);

  // ==========================================================
  // REFERRAL LINK
  // ==========================================================

  const referralLink =
    referralData?.referralLink ?? '';

  const referralCode =
    referralData?.referralCode ?? '';

  // ==========================================================
  // ACTIVE TYPE
  // ==========================================================

  const activeConfig =
    referralTypes[activeType];

  const TypeIcon =
    activeConfig.icon;

  // ==========================================================
  // ACTIVE TYPE DISTRIBUTION (backend-configured percentages)
  // ==========================================================

  const getActiveTypeLevelPercent = (
    levelNumber: number,
  ): number => {
    if (activeType === 'bot') {
      const group = distribution?.bot.find(
        (item) => item.id === 'first_activation',
      );

      return (
        group?.levels.find(
          (item) => item.level === levelNumber,
        )?.percent ?? 0
      );
    }

    const levels =
      activeType === 'game'
        ? distribution?.game
        : distribution?.trade;

    return (
      levels?.find(
        (item) => item.level === levelNumber,
      )?.percent ?? 0
    );
  };

  // ==========================================================
  // LEVEL TOGGLE
  // ==========================================================

  const toggleLevel = (
    level: number,
  ) => {
    setExpandedLevels(
      (current) =>
        current.includes(level)
          ? current.filter(
              (item) =>
                item !== level,
            )
          : [
              ...current,
              level,
            ],
    );
  };

  // ==========================================================
  // COPY
  // ==========================================================

  const copyReferral = async () => {
    if (!referralLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        referralLink,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (err) {
      console.error(
        'Failed to copy referral link:',
        err,
      );
    }
  };

  // ==========================================================
  // SHARE
  // ==========================================================

  const shareReferral = async () => {
    if (!referralLink) {
      return;
    }

    const shareData = {
      title: 'Join TradeX',
      text: referralCode
        ? `Join me on TradeX using referral code ${referralCode}.`
        : 'Join me on TradeX.',
      url: referralLink,
    };

    if (
      typeof navigator.share ===
        'function'
    ) {
      try {
        await navigator.share(
          shareData,
        );

        return;
      } catch {
        // User cancelled share.
      }
    }

    await copyReferral();
  };

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="flex flex-col items-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF7E0]">
              <RefreshCw
                size={22}
                className="animate-spin text-[#F59E0B]"
              />
            </div>

            <div className="text-sm font-semibold text-[#64748B]">
              Loading referral data...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="rounded-[18px] border border-red-200 bg-red-50 p-5">
            <div className="text-sm font-bold text-red-600">
              {error}
            </div>

            <button
              type="button"
              onClick={() =>
                void loadReferral()
              }
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#111827] px-5 text-sm font-bold text-white hover:bg-[#1F2937]"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================
  // NO DATA
  // ==========================================================

  if (!referralData) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-6 text-center">
            <div className="text-sm font-semibold text-[#64748B]">
              No referral data available.
            </div>

            <button
              type="button"
              onClick={() =>
                void loadReferral()
              }
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#FBBF24] px-5 text-sm font-bold text-[#111827]"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-28">
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5">
        <div className="space-y-4">

          {/* ==================================================
              HERO
          ================================================== */}

          <section className="relative min-h-[300px] overflow-hidden rounded-[22px] bg-[#071426]">
            <div className="absolute -right-16 -top-20 h-[260px] w-[260px] rounded-full bg-[#FBBF24]/[0.08]" />

            <div className="absolute bottom-[-100px] right-[18%] h-[220px] w-[220px] rounded-full bg-[#FBBF24]/[0.05]" />

            <div className="relative z-10 grid min-h-[300px] grid-cols-1 md:grid-cols-[1.25fr_0.75fr]">

              {/* LEFT */}
              <div className="flex flex-col justify-center p-6 md:p-8">
                <h1 className="text-[30px] font-black leading-tight text-white">
                  Refer{' '}
                  <span className="text-[#FBBF24]">
                    &amp; Earn
                  </span>
                </h1>

                <p className="mt-2 text-sm leading-6 text-[#E5E7EB]">
                  Invite your friends and earn TDX rewards
                </p>

                <p className="text-sm leading-6 text-[#E5E7EB]">
                  from eligible TradeX activity.
                </p>

                <p className="mb-2 mt-5 text-sm font-extrabold text-[#FACC15]">
                  Your Referral Link
                </p>

                <div className="flex h-[52px] max-w-[520px] overflow-hidden rounded-[13px] border border-[#374151] bg-[#101C2D]">
                  <div className="flex min-w-0 flex-1 items-center px-3">
                    <span className="truncate text-sm text-white">
                      {referralLink ||
                        'No referral link available'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={copyReferral}
                    disabled={!referralLink}
                    className="flex w-[52px] shrink-0 items-center justify-center bg-[#FBBF24] text-[#111827] hover:bg-[#FCD34D] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Copy referral link"
                  >
                    {copied ? (
                      <Check size={21} />
                    ) : (
                      <Copy size={21} />
                    )}
                  </button>
                </div>

                {referralCode && (
                  <div className="mt-2 text-xs text-[#9CA3AF]">
                    Referral Code:{' '}
                    <span className="font-bold text-[#FBBF24]">
                      {referralCode}
                    </span>
                  </div>
                )}
              </div>

              {/* RIGHT */}
              <div className="flex flex-col items-center justify-center px-6 pb-7 md:pb-0">
                <div className="mb-3 flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#FBBF24]/10">
                  <div className="flex h-[92px] w-[92px] items-center justify-center rounded-full bg-[#FBBF24]/15">
                    <Sparkles
                      size={66}
                      className="text-[#FBBF24]"
                    />
                  </div>
                </div>

                <span className="mb-2 text-[13px] text-[#D1D5DB]">
                  Share via
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22C55E] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Share"
                  >
                    <MessageCircle size={21} />
                  </button>

                  <button
                    type="button"
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Share"
                  >
                    <Send size={20} />
                  </button>

                  <button
                    type="button"
                    onClick={shareReferral}
                    disabled={!referralLink}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[#374151] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    title="More sharing options"
                  >
                    <Share2 size={21} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ==================================================
              STATS
          ================================================== */}

          <section className="grid grid-cols-1 overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white sm:grid-cols-3">

            <StatCard
              icon={<Users size={22} />}
              iconColor="#7C3AED"
              title="Total Network"
              value={String(
                referralData.stats
                  .totalNetwork,
              )}
            />

            <StatCard
              icon={<Network size={22} />}
              iconColor="#16A34A"
              title="Total Active"
              value={String(
                referralData.stats
                  .totalActive,
              )}
              divider
            />

            <StatCard
              icon={<Wallet size={22} />}
              iconColor="#F59E0B"
              title="Total Earned"
              value={`${formatTDX(
                referralData.stats
                  .totalEarned,
              )} TDX`}
              divider
            />
          </section>

          {/* ==================================================
              REFERRAL LINK
          ================================================== */}

          <section className="rounded-[18px] border border-[#E5E7EB] bg-white p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-[17px] font-extrabold text-[#111827]">
                  Your Referral Link
                </h2>

                <p className="mt-1 text-xs text-[#6B7280]">
                  Share your link and invite new users
                </p>
              </div>

              <Link
                size={24}
                className="text-[#F59E0B]"
              />
            </div>

            <div className="flex h-12 overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
              <div className="flex min-w-0 flex-1 items-center px-3">
                <span className="truncate text-sm text-[#374151]">
                  {referralLink ||
                    'No referral link available'}
                </span>
              </div>

              <button
                type="button"
                onClick={copyReferral}
                disabled={!referralLink}
                className="flex w-12 shrink-0 items-center justify-center bg-[#FBBF24] text-[#111827] hover:bg-[#FCD34D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copied ? (
                  <Check size={19} />
                ) : (
                  <Copy size={19} />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={shareReferral}
              disabled={!referralLink}
              className="mt-2.5 flex h-[42px] w-full items-center justify-center gap-2 rounded-[11px] bg-[#FFF7E0] text-sm font-bold text-[#111827] hover:bg-[#FEF0C7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Share2 size={18} />
              Share Referral Link
            </button>
          </section>

          {/* ==================================================
              REFERRAL TYPE TABS
          ================================================== */}

          <section className="overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-3">
              {(Object.keys(
                referralTypes,
              ) as ReferralType[]).map(
                (key) => {
                  const item =
                    referralTypes[key];

                  const Icon =
                    item.icon;

                  const active =
                    activeType === key;

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!item.available}
                      onClick={() => {
                        if (
                          item.available
                        ) {
                          setActiveType(key);
                        }
                      }}
                      className={`relative flex min-h-[96px] items-center justify-center gap-3 px-4 py-3 transition-all duration-150 ${
                        !item.available
                          ? 'cursor-not-allowed opacity-55'
                          : 'hover:bg-[#F9FAFB]'
                      }`}
                    >
                      {active && (
                        <div
                          className="absolute inset-x-0 bottom-0 h-[3px]"
                          style={{
                            backgroundColor:
                              item.color,
                          }}
                        />
                      )}

                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                          active
                            ? 'scale-105 shadow-sm'
                            : ''
                        }`}
                        style={{
                          backgroundColor:
                            item.bg,
                          boxShadow: active
                            ? `0 0 0 3px ${item.color}20`
                            : undefined,
                        }}
                      >
                        <Icon
                          size={22}
                          style={{
                            color:
                              item.color,
                          }}
                        />
                      </div>

                      <div className="text-left">
                        <div
                          className={`text-xs font-extrabold ${
                            active
                              ? ''
                              : 'text-[#111827]'
                          }`}
                          style={
                            active
                              ? {
                                  color:
                                    item.color,
                                }
                              : undefined
                          }
                        >
                          {item.title}
                        </div>

                        <div className="mt-1 text-[10px] text-[#64748B]">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          </section>

          {/* ==================================================
              ACTIVE TYPE + DISTRIBUTION
              (Game / Trade / Bot — each category shows its own
              backend-configured referral distribution)
          ================================================== */}

          <section className="overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white">
            {/* Category header */}
            <div
              className="flex items-center gap-3 px-4 py-4"
              style={{
                backgroundColor: `${activeConfig.color}0F`,
              }}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor:
                    activeConfig.bg,
                }}
              >
                <TypeIcon
                  size={21}
                  style={{
                    color:
                      activeConfig.color,
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-base font-extrabold text-[#111827]">
                  {activeConfig.title} — Referral
                  Distribution
                </h2>

                <p className="mt-1 text-xs leading-5 text-[#64748B]">
                  {activeConfig.description}
                </p>
              </div>
            </div>

            <div className="p-4">
              {activeType === 'bot' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(distribution?.bot ?? []).map((group) => (
                    <div
                      key={group.id}
                      className="rounded-[14px] border border-[#EAECF0] p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#111827]">
                          {group.label}
                        </span>

                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-extrabold text-white"
                          style={{
                            backgroundColor:
                              activeConfig.color,
                          }}
                        >
                          Total{' '}
                          {formatDistributionPercent(
                            group.totalPercent,
                          )}
                          %
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {group.levels.map((item) => (
                          <div
                            key={item.level}
                            className="rounded-lg bg-[#F8FAFC] px-2 py-1.5 text-center"
                          >
                            <div className="text-[10px] text-[#667085]">
                              L{item.level}
                            </div>

                            <div className="text-xs font-extrabold text-[#111827]">
                              {formatDistributionPercent(
                                item.percent,
                              )}
                              %
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                (() => {
                  const levels =
                    activeType === 'game'
                      ? (distribution?.game ?? [])
                      : (distribution?.trade ?? []);

                  const total = levels.reduce(
                    (sum, item) => sum + item.percent,
                    0,
                  );

                  return (
                    <div className="rounded-[14px] border border-[#EAECF0] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#111827]">
                          {activeConfig.title} — 6
                          Levels
                        </span>

                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-extrabold text-white"
                          style={{
                            backgroundColor:
                              activeConfig.color,
                          }}
                        >
                          Total{' '}
                          {formatDistributionPercent(
                            Number(total.toFixed(4)),
                          )}
                          %
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {levels.map((item) => (
                          <div
                            key={item.level}
                            className="rounded-lg bg-[#F8FAFC] px-2 py-1.5 text-center"
                          >
                            <div className="text-[10px] text-[#667085]">
                              L{item.level}
                            </div>

                            <div className="text-xs font-extrabold text-[#111827]">
                              {formatDistributionPercent(
                                item.percent,
                              )}
                              %
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </section>

          {/* ==================================================
              REFERRAL STRUCTURE
          ================================================== */}

          <section className="rounded-[18px] border border-[#E5E7EB] bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-[#111827]">
                  Referral Structure
                </h2>

                <p className="mt-1 text-xs text-[#64748B]">
                  Your network earnings by level
                </p>
              </div>

              <span className="rounded-full bg-[#FFF7E0] px-3 py-1.5 text-xs font-bold text-[#B77900]">
                6 Levels
              </span>
            </div>

            <div className="space-y-2">
              {referralData.levels.map(
                (
                  level: ReferralLevel,
                ) => {
                  const expanded =
                    expandedLevels.includes(
                      level.level,
                    );

                  return (
                    <div
                      key={level.level}
                      className="overflow-hidden rounded-[14px] border border-[#EAECF0]"
                    >
                      {/* LEVEL HEADER */}
                      <button
                        type="button"
                        onClick={() =>
                          toggleLevel(
                            level.level,
                          )
                        }
                        className="flex w-full items-center gap-3 bg-[#FCFCFD] px-4 py-3 text-left hover:bg-[#F9FAFB]"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111827] text-xs font-extrabold text-white">
                          L{level.level}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-extrabold text-[#111827]">
                            Level{' '}
                            {level.level}
                          </div>

                          <div className="mt-0.5 text-[11px] text-[#667085]">
                            {
                              level.totalUsers
                            }{' '}
                            users ·{' '}
                            {
                              level.activeUsers
                            }{' '}
                            active
                          </div>
                        </div>

                        <span className="rounded-full bg-[#FFF7E0] px-2.5 py-1 text-xs font-extrabold text-[#B77900]">
                          {
                            formatDistributionPercent(
                              getActiveTypeLevelPercent(
                                level.level,
                              ),
                            )
                          }
                          %
                        </span>

                        {expanded ? (
                          <ChevronUp
                            size={18}
                            className="shrink-0 text-[#667085]"
                          />
                        ) : (
                          <ChevronDown
                            size={18}
                            className="shrink-0 text-[#667085]"
                          />
                        )}
                      </button>

                      {/* USERS */}
                      {expanded && (
                        <div className="border-t border-[#EAECF0] bg-white">
                          {level.users
                            .length ===
                          0 ? (
                            <div className="px-4 py-6 text-center text-xs text-[#98A2B3]">
                              No users at this level yet.
                            </div>
                          ) : (
                            level.users.map(
                              (user) => (
                                <div
                                  key={
                                    user.userId
                                  }
                                  className="flex items-center gap-3 border-b border-[#F2F4F7] px-4 py-3 last:border-b-0"
                                >
                                  {/* AVATAR */}
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] text-xs font-extrabold text-[#475467]">
                                    {user.walletAddress
                                      ?.slice(
                                        2,
                                        4,
                                      )
                                      .toUpperCase() ||
                                      'TX'}
                                  </div>

                                  {/* USER */}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate text-sm font-bold text-[#111827]">
                                        {formatWallet(
                                          user.walletAddress,
                                        )}
                                      </span>

                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                          user.active
                                            ? 'bg-[#22C55E]'
                                            : 'bg-[#98A2B3]'
                                        }`}
                                      />
                                    </div>

                                    <div className="mt-0.5 text-[10px] text-[#98A2B3]">
                                      {user.active
                                        ? 'Active'
                                        : 'Inactive'}
                                      {' · '}
                                      Joined{' '}
                                      {formatDate(
                                        user.joinedAt,
                                      )}
                                    </div>
                                  </div>

                                  {/* AMOUNTS */}
                                  <div className="shrink-0 text-right">
                                    <div className="text-xs font-bold text-[#111827]">
                                      {formatTDX(
                                        user.tradeVolume,
                                      )}{' '}
                                      TDX
                                    </div>

                                    <div className="mt-0.5 text-[10px] font-bold text-[#16A34A]">
                                      +
                                      {formatTDX(
                                        user.earned,
                                      )}{' '}
                                      TDX
                                    </div>
                                  </div>
                                </div>
                              ),
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          </section>

          {/* ==================================================
              SUMMARY
          ================================================== */}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={<Users size={19} />}
              label="Network Users"
              value={String(
                referralData.stats
                  .totalNetwork,
              )}
            />

            <SummaryCard
              icon={<TrendingUp size={19} />}
              label="Active Users"
              value={String(
                referralData.stats
                  .totalActive,
              )}
            />

            <SummaryCard
              icon={<Wallet size={19} />}
              label="Total Rewards"
              value={`${formatTDX(
                referralData.stats
                  .totalEarned,
              )} TDX`}
              highlight
            />
          </section>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// STAT CARD
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
        divider
          ? 'border-t border-[#E5E7EB] sm:border-l sm:border-t-0'
          : ''
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
        <div className="text-xs text-[#64748B]">
          {title}
        </div>

        <div className="mt-1 text-lg font-black text-[#111827]">
          {value}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

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
    <div className="flex items-center gap-3 rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          highlight
            ? 'bg-[#FFF7E0] text-[#F59E0B]'
            : 'bg-[#F3F4F6] text-[#475467]'
        }`}
      >
        {icon}
      </div>

      <div>
        <div className="text-[11px] text-[#667085]">
          {label}
        </div>

        <div className="mt-1 text-sm font-extrabold text-[#111827]">
          {value}
        </div>
      </div>
    </div>
  );
}