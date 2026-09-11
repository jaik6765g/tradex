export const PULSE_SUPPORTED_PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'SOL/USDT',
] as const;

export type PulseSupportedPair = (typeof PULSE_SUPPORTED_PAIRS)[number];

export const PULSE_SUPPORTED_DURATIONS_SECONDS = [
  30, 60, 180, 300, 600,
] as const;

export type PulseSupportedDurationSeconds =
  (typeof PULSE_SUPPORTED_DURATIONS_SECONDS)[number];

export const PULSE_SUPPORTED_DURATION_CODES = [
  '30S',
  '1M',
  '3M',
  '5M',
  '10M',
] as const;

export type PulseSupportedDurationCode =
  (typeof PULSE_SUPPORTED_DURATION_CODES)[number];

const PULSE_DURATION_CODE_TO_SECONDS: Record<
  PulseSupportedDurationCode,
  PulseSupportedDurationSeconds
> = {
  '30S': 30,
  '1M': 60,
  '3M': 180,
  '5M': 300,
  '10M': 600,
};

const PULSE_DURATION_SECONDS_TO_CODE: Record<
  PulseSupportedDurationSeconds,
  PulseSupportedDurationCode
> = {
  30: '30S',
  60: '1M',
  180: '3M',
  300: '5M',
  600: '10M',
};

export const PULSE_MIN_TRADE_AMOUNT_TDX = '10';
export const PULSE_MAX_TRADE_AMOUNT_TDX = '10000';

export const PULSE_TRADE_FEE_PERCENT = '5';
export const PULSE_TRADE_REFERRAL_PERCENT = '2';
export const PULSE_TRADE_ADMIN_PERCENT = '2';
export const PULSE_TRADE_BONUS_VAULT_PERCENT = '1';

export const PULSE_30S_DURATION_SECONDS = 30;
export const PULSE_30S_CUTOFF_SECONDS = 10;

export const isSupportedPulsePair = (
  value: string,
): value is PulseSupportedPair => {
  return PULSE_SUPPORTED_PAIRS.includes(value as PulseSupportedPair);
};

export const isSupportedPulseDuration = (
  value: number,
): value is PulseSupportedDurationSeconds => {
  return PULSE_SUPPORTED_DURATIONS_SECONDS.includes(
    value as PulseSupportedDurationSeconds,
  );
};

export const isSupportedPulseDurationCode = (
  value: string,
): value is PulseSupportedDurationCode => {
  return PULSE_SUPPORTED_DURATION_CODES.includes(
    value as PulseSupportedDurationCode,
  );
};

export const pulseDurationCodeToSeconds = (
  value: PulseSupportedDurationCode,
): PulseSupportedDurationSeconds => {
  return PULSE_DURATION_CODE_TO_SECONDS[value];
};

export const pulseDurationSecondsToCode = (
  value: PulseSupportedDurationSeconds,
): PulseSupportedDurationCode => {
  return PULSE_DURATION_SECONDS_TO_CODE[value];
};

export const normalizePulseSymbol = (value: string): string => {
  return value.trim().toUpperCase().replace('-', '/');
};
