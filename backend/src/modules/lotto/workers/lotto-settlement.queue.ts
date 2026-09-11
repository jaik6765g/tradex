export const LOTTO_SETTLEMENT_QUEUE = 'lotto-settlement';

export const LOTTO_SETTLEMENT_SCAN_JOB = 'scan-expired-rounds';
export const LOTTO_SETTLEMENT_SETTLE_JOB = 'settle-expired-round';

export const LOTTO_SETTLEMENT_SCAN_REPEAT_JOB_ID =
  'lotto-settlement-scan-repeat';

export const lottoSettlementRoundJobId = (roundId: number): string =>
  `lotto-settlement-round-${roundId}`;
