// ============================================================
// REFERRAL DISTRIBUTION SERVICE
// ============================================================
//
// Resolves the backend-configured referral distribution
// percentages/levels for the Referral page tabs (Trade / Game /
// Bot Trade).
//
// Sources (backend verified):
// - Trade:  GET /users/referral/me -> levels[].percentage
//           (PULSE_SETTLEMENT_POLICY referral levels, L1-L6).
// - Bot:    GET /bot/settings -> firstReferralRate +
//           firstReferralLevel1Rate..6Rate (First Activation,
//           total 10%). The API response does not expose the
//           monthly referral level rates, so the Monthly group
//           mirrors the backend bot_settings configuration
//           (monthly_referral_rate = 1% and
//           monthly_referral_level_1_rate..6_rate). The endpoint
//           is admin-only; for non-admin users the backend
//           configured values are used directly.
// - Game:   The backend lotto engine distributes 2% of every
//           ticket across L1-L6 (lotto.service.ts
//           referralLevels). No endpoint exposes this policy,
//           so the configured backend policy is used.
//
// No earnings/network data is produced here — that continues to
// come from GET /users/referral/me untouched.
// ============================================================

import { apiClient } from '../../core/api/client';

// ============================================================
// TYPES
// ============================================================

export interface DistributionLevel {
  level: number;
  /** Percent value exactly as configured in the backend (e.g. 0.75). */
  percent: number;
}

export interface DistributionGroup {
  id: 'first_activation' | 'monthly' | 'standard';
  label: string;
  totalPercent: number;
  levels: DistributionLevel[];
}

export interface ReferralTypeDistribution {
  /** Per-level percentages for the Trade tab (backend API data). */
  trade: DistributionLevel[];
  /** Per-level percentages for the Game tab (backend lotto policy). */
  game: DistributionLevel[];
  /** Distribution groups for the Bot Trade tab (backend bot_settings). */
  bot: DistributionGroup[];
}

interface BotSettingsResponse {
  firstReferralRate: string;
  firstReferralLevel1Rate: string;
  firstReferralLevel2Rate: string;
  firstReferralLevel3Rate: string;
  firstReferralLevel4Rate: string;
  firstReferralLevel5Rate: string;
  firstReferralLevel6Rate: string;
}

interface ReferralDashboardLevelLike {
  level: number;
  percentage: string;
}

// ============================================================
// BACKEND CONFIGURED DISTRIBUTION (bot_settings / lotto policy)
// ============================================================
//
// Used only when the backend API does not expose the values to
// the requesting user. Verified against the live bot_settings
// row (First Activation 10%, Monthly 1%) and the backend lotto
// referral policy (2% per ticket).
// ============================================================

const BOT_FIRST_ACTIVATION_LEVELS: DistributionLevel[] = [
  { level: 1, percent: 6 },
  { level: 2, percent: 1.5 },
  { level: 3, percent: 1 },
  { level: 4, percent: 0.6 },
  { level: 5, percent: 0.5 },
  { level: 6, percent: 0.4 },
];

const BOT_MONTHLY_LEVELS: DistributionLevel[] = [
  { level: 1, percent: 0.55 },
  { level: 2, percent: 0.2 },
  { level: 3, percent: 0.1 },
  { level: 4, percent: 0.05 },
  { level: 5, percent: 0.05 },
  { level: 6, percent: 0.05 },
];

const GAME_LEVELS: DistributionLevel[] = [
  { level: 1, percent: 0.75 },
  { level: 2, percent: 0.35 },
  { level: 3, percent: 0.25 },
  { level: 4, percent: 0.25 },
  { level: 5, percent: 0.2 },
  { level: 6, percent: 0.2 },
];

// ============================================================
// HELPERS
// ============================================================

function sumLevels(levels: DistributionLevel[]): number {
  return Number(
    levels
      .reduce((total, item) => total + item.percent, 0)
      .toFixed(4),
  );
}

function toPercent(value: string | number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildBotGroups(
  firstActivationLevels: DistributionLevel[],
  monthlyLevels: DistributionLevel[],
  firstActivationTotal: number,
  monthlyTotal: number,
): DistributionGroup[] {
  return [
    {
      id: 'first_activation',
      label: 'First Activation',
      totalPercent: firstActivationTotal,
      levels: firstActivationLevels,
    },
    {
      id: 'monthly',
      label: 'Monthly',
      totalPercent: monthlyTotal,
      levels: monthlyLevels,
    },
  ];
}

// ============================================================
// DISTRIBUTION RESOLUTION
// ============================================================

/**
 * Trade tab distribution — resolved from the backend referral
 * dashboard (`levels[].percentage`), so admin-configured Trade
 * policy is reflected exactly.
 */
export function buildTradeDistribution(
  referralLevels: ReferralDashboardLevelLike[] | undefined,
): DistributionLevel[] {
  if (!referralLevels || referralLevels.length === 0) {
    return [];
  }

  return [...referralLevels]
    .sort((a, b) => a.level - b.level)
    .map((level) => ({
      level: level.level,
      percent: toPercent(level.percentage),
    }));
}

/**
 * Bot Trade tab distribution — fetched live from
 * GET /bot/settings when the endpoint is accessible; otherwise
 * the backend configured distribution is used.
 */
export async function fetchBotDistributionGroups(): Promise<DistributionGroup[]> {
  try {
    const response = await apiClient.get<BotSettingsResponse>('/bot/settings');
    const data = response.data;

    const firstActivationLevels: DistributionLevel[] = [
      data.firstReferralLevel1Rate,
      data.firstReferralLevel2Rate,
      data.firstReferralLevel3Rate,
      data.firstReferralLevel4Rate,
      data.firstReferralLevel5Rate,
      data.firstReferralLevel6Rate,
    ].map((rate, index) => ({
      level: index + 1,
      percent: toPercent(rate),
    }));

    return buildBotGroups(
      firstActivationLevels,
      BOT_MONTHLY_LEVELS,
      toPercent(data.firstReferralRate),
      sumLevels(BOT_MONTHLY_LEVELS),
    );
  } catch {
    // /bot/settings is admin-only — non-admin users receive 403.
    // Fall back to the backend configured distribution.
    return buildBotGroups(
      BOT_FIRST_ACTIVATION_LEVELS,
      BOT_MONTHLY_LEVELS,
      sumLevels(BOT_FIRST_ACTIVATION_LEVELS),
      sumLevels(BOT_MONTHLY_LEVELS),
    );
  }
}

/**
 * Game tab distribution — backend lotto referral policy
 * (2% of every ticket across L1-L6).
 */
export function buildGameDistribution(): DistributionLevel[] {
  return GAME_LEVELS;
}

/**
 * Resolve the full distribution snapshot for the Referral page.
 */
export async function fetchReferralTypeDistribution(
  referralLevels: ReferralDashboardLevelLike[] | undefined,
): Promise<ReferralTypeDistribution> {
  const bot = await fetchBotDistributionGroups();

  return {
    trade: buildTradeDistribution(referralLevels),
    game: buildGameDistribution(),
    bot,
  };
}

/**
 * Format a percent value for display without altering the
 * configured number (6.0000 -> "6", 0.5500 -> "0.55",
 * 0.75 -> "0.75").
 */
export function formatDistributionPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Number(value.toFixed(4)));
}

export const ReferralDistributionService = {
  buildTradeDistribution,
  fetchBotDistributionGroups,
  buildGameDistribution,
  fetchReferralTypeDistribution,
  formatDistributionPercent,
};

export default ReferralDistributionService;