import { TradeStatus } from './enums';

export const ACTIVE_SETTLEMENT_STATUSES = [
  TradeStatus.ACCEPTED,
  TradeStatus.ENTRY_CLOSED,
  TradeStatus.EXPIRING,
  TradeStatus.SETTLING,
  TradeStatus.SETTLEMENT_DELAYED,
];

export const TERMINAL_STATUSES = [
  TradeStatus.SETTLED,
  TradeStatus.REJECTED,
  TradeStatus.CANCELLED,
  TradeStatus.SETTLEMENT_FAILED,
];

export const SETTLEMENT_ISSUE_STATUSES = [
  TradeStatus.SETTLEMENT_DELAYED,
  TradeStatus.SETTLEMENT_FAILED,
];

export const ADMIN_TRADE_STATUS_OPTIONS = [
  'CREATED',
  'VALIDATING',
  'ACCEPTED',
  'ENTRY_CLOSED',
  'EXPIRING',
  'SETTLING',
  'SETTLEMENT_DELAYED',
  'SETTLEMENT_FAILED',
  'SETTLED',
  'REJECTED',
  'CANCELLED',
] as const;

export const ADMIN_TRADE_RESULT_OPTIONS = ['WIN', 'LOSS', 'DRAW'] as const;

export const ADMIN_TRADE_DIRECTION_OPTIONS = ['LONG', 'SHORT'] as const;

export const ADMIN_TRADE_DURATION_OPTIONS = [
  '30S',
  '1M',
  '3M',
  '5M',
  '10M',
] as const;

export const ADMIN_TRADE_SYMBOL_OPTIONS = [
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'SOL/USDT',
] as const;
