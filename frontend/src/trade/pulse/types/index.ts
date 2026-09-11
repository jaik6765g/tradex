// ============================================================
// PULSE TRADE TYPES (BACKEND PHASE-4 CONTRACT)
// ============================================================

export const PULSE_SUPPORTED_PAIRS = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'] as const;
export type PulsePair = (typeof PULSE_SUPPORTED_PAIRS)[number];

export const PULSE_SUPPORTED_DURATIONS = ['30S', '1M', '3M', '5M', '10M'] as const;
export type PulseDuration = (typeof PULSE_SUPPORTED_DURATIONS)[number];

export const PULSE_MIN_AMOUNT_TDX = 10;
export const PULSE_MAX_AMOUNT_TDX = 10_000;

export const PULSE_DIRECTIONS = ['LONG', 'SHORT'] as const;
export type PulseDirection = (typeof PULSE_DIRECTIONS)[number];

export type PulsePublicStatus =
  | 'OPEN'
  | 'LOCKED'
  | 'SETTLING'
  | 'SETTLEMENT_DELAYED'
  | 'SETTLEMENT_FAILED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'WON'
  | 'LOST'
  | 'DRAW'
  | 'SETTLED'
  | string;

export type PulseTradeHistoryStatusFilter =
  | 'CREATED'
  | 'VALIDATING'
  | 'ACCEPTED'
  | 'ENTRY_CLOSED'
  | 'EXPIRING'
  | 'SETTLING'
  | 'SETTLEMENT_DELAYED'
  | 'SETTLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SETTLEMENT_FAILED';

export type PulseTradeResult = 'WIN' | 'LOSS' | 'DRAW' | null;

export interface PulseMarket {
  symbol: PulsePair;
  baseAsset: string;
  quoteAsset: string;
  enabled: boolean;
  minTradeAmount: string;
  maxTradeAmount: string;
  durations: PulseDuration[];
}

export interface PulseMarketsResponse {
  markets: PulseMarket[];
}

export interface PulsePriceResponse {
  symbol: string;
  price: string;
  source: string;
  timestamp: string;
  stale: boolean;
}

export interface PlacePulseTradeRequest {
  symbol: PulsePair;
  direction: PulseDirection;
  duration: PulseDuration;
  amount: string;
  clientRequestId: string;
}

export interface PulsePlaceTradeView {
  id: string;
  symbol: string;
  direction: PulseDirection;
  duration: PulseDuration;
  stake: string;
  fee: string;
  netStake: string;
  entryPrice: string;
  entryAt: string;
  expiresAt: string;
  status: PulsePublicStatus;
  result: PulseTradeResult;
  payout: string | null;
  remainingSeconds: number;
}

export interface PlacePulseTradeResponse {
  trade: PulsePlaceTradeView;
  feeBreakdown: {
    totalFee: string;
    referral: string;
    admin: string;
    bonusVault: string;
  };
  balance: {
    available: string;
    locked: string;
    total: string;
  };
}

export interface PulseOpenTrade {
  id: string;
  symbol: string;
  direction: PulseDirection;
  duration: PulseDuration;
  stake: string;
  fee: string;
  entryPrice: string;
  currentPrice: string;
  entryAt: string;
  expiresAt: string;
  remainingSeconds: number;
  status: PulsePublicStatus;
}

export interface PulseOpenTradesResponse {
  trades: PulseOpenTrade[];
}

export interface PulseHistoryTrade {
  id: string;
  symbol: string;
  direction: PulseDirection;
  duration: PulseDuration;
  stake: string;
  fee: string;
  entryPrice: string;
  expiryPrice: string | null;
  entryAt: string;
  expiresAt: string;
  settledAt: string | null;
  status: PulsePublicStatus;
  result: PulseTradeResult;
  payout: string | null;
}

export interface PulseTradeHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  trades: PulseHistoryTrade[];
}

export interface PulseTradeDetailResponse {
  trade: {
    id: string;
    symbol: string;
    direction: PulseDirection;
    duration: PulseDuration;
    stake: string;
    fee: string;
    netStake: string;
    entryPrice: string;
    expiryPrice: string | null;
    entryAt: string;
    expiresAt: string;
    settledAt: string | null;
    status: PulsePublicStatus;
    result: PulseTradeResult;
    payout: string | null;
    remainingSeconds: number;
  };
}

export interface PulsePortfolioResponse {
  availableBalance: string;
  openExposure: string;
  totalTrades: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: string;
  /**
   * Net settled player PnL from payout economics:
   * settledStake - totalPayout.
   * This value is independent from `totalFees` (fees are not subtracted twice).
   */
  totalProfit: string;
  /**
   * Informational total fee amount over aggregated stake.
   * Reported separately from `totalProfit`.
   */
  totalFees: string;
}

export interface PulseLiquidityResponse {
  poolBalance: string;
  reservedAmount: string;
  availableLiquidity: string;
  openExposure: string;
  riskState: string;
}

export interface PulseRiskResponse {
  state: string;
  maxAllowedTrade: string;
  acceptingTrades: boolean;
  reason: string | null;
}

export interface PulseTradeHistoryQuery {
  limit?: number;
  offset?: number;
  symbol?: string;
  status?: PulseTradeHistoryStatusFilter;
  direction?: PulseDirection;
  duration?: PulseDuration;
  from?: string;
  to?: string;
}