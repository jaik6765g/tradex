export const PULSE_SETTLEMENT_QUEUE = 'pulse-settlement';

export const PULSE_SETTLEMENT_SCAN_JOB = 'scan-expired-trades';
export const PULSE_SETTLEMENT_SETTLE_JOB = 'settle-expired-trade';

export const PULSE_SETTLEMENT_SCAN_REPEAT_JOB_ID =
  'pulse-settlement-scan-repeat';

export const pulseSettlementTradeJobId = (tradeId: string): string =>
  `pulse-settlement-trade-${tradeId}`;
