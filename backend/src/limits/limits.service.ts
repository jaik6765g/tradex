// backend/src/limits/limits.service.ts
//
// Deposit / Withdrawal Limits — Architecture Plan v3.
//
// Single source of truth for the four financial limit settings plus the
// daily-withdrawal-frequency setting. Values are ALWAYS read from the
// admin_settings table on enforcement paths (no TTL cache) per the approved
// design decision: financial enforcement must never serve stale limits.
//
// All monetary comparisons are exact Decimal.js operations. All values are
// exchanged as strings over the API.

import { Injectable, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';

import { AdminSetting } from '../admin/entities/admin-setting.entity';

// ============================================================
// SETTINGS KEYS (admin_settings rows)
// ============================================================

export const MIN_DEPOSIT_USDT_KEY = 'minDepositUsdt';
export const MAX_DEPOSIT_USDT_KEY = 'maxDepositUsdt';
export const MIN_WITHDRAWAL_USDT_KEY = 'minWithdrawalUsdt';
export const MAX_WITHDRAWAL_USDT_KEY = 'maxWithdrawalUsdt';
export const MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY =
  'maxWithdrawalsPerUserPerDay';

// ------------------------------------------------------------
// MIN/MAX PAIRS (used by the atomic admin invariant check)
// ------------------------------------------------------------
// Each financial limit key maps to its counterpart so the admin update path
// can lock BOTH rows and validate min <= max on the effective post-update
// pair, regardless of which member is being written.
export const LIMIT_SETTING_PAIRS: Record<string, string> = {
  [MIN_DEPOSIT_USDT_KEY]: MAX_DEPOSIT_USDT_KEY,
  [MAX_DEPOSIT_USDT_KEY]: MIN_DEPOSIT_USDT_KEY,
  [MIN_WITHDRAWAL_USDT_KEY]: MAX_WITHDRAWAL_USDT_KEY,
  [MAX_WITHDRAWAL_USDT_KEY]: MIN_WITHDRAWAL_USDT_KEY,
};

export const LIMIT_PAIR_MIN_KEY: Record<string, string> = {
  [MIN_DEPOSIT_USDT_KEY]: MIN_DEPOSIT_USDT_KEY,
  [MAX_DEPOSIT_USDT_KEY]: MIN_DEPOSIT_USDT_KEY,
  [MIN_WITHDRAWAL_USDT_KEY]: MIN_WITHDRAWAL_USDT_KEY,
  [MAX_WITHDRAWAL_USDT_KEY]: MIN_WITHDRAWAL_USDT_KEY,
};

export const LIMIT_PAIR_MAX_KEY: Record<string, string> = {
  [MIN_DEPOSIT_USDT_KEY]: MAX_DEPOSIT_USDT_KEY,
  [MAX_DEPOSIT_USDT_KEY]: MAX_DEPOSIT_USDT_KEY,
  [MIN_WITHDRAWAL_USDT_KEY]: MAX_WITHDRAWAL_USDT_KEY,
  [MAX_WITHDRAWAL_USDT_KEY]: MAX_WITHDRAWAL_USDT_KEY,
};

// ------------------------------------------------------------
// ADMIN WRITE-TIME KEY CLASSIFICATION + VALIDATION
// ------------------------------------------------------------

/** The four monetary limit keys — these MUST be stored with valueType 'number'. */
export const NUMERIC_LIMIT_SETTING_KEYS: readonly string[] = [
  MIN_DEPOSIT_USDT_KEY,
  MAX_DEPOSIT_USDT_KEY,
  MIN_WITHDRAWAL_USDT_KEY,
  MAX_WITHDRAWAL_USDT_KEY,
];

export function isNumericLimitSettingKey(key: string): boolean {
  return NUMERIC_LIMIT_SETTING_KEYS.includes(key);
}

export function isDailyWithdrawalFrequencySettingKey(key: string): boolean {
  return key === MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY;
}

/** Canonical stored values for the daily-withdrawal-frequency setting. */
export function countFrequencyValue(value: number): string {
  return JSON.stringify({ mode: 'COUNT', value });
}

export const UNLIMITED_FREQUENCY_VALUE = JSON.stringify({ mode: 'UNLIMITED' });

/**
 * Validates and canonicalizes an incoming administrator value for
 * `maxWithdrawalsPerUserPerDay`.
 *
 * Accepted EXACTLY (no extra keys tolerated):
 *   {"mode":"COUNT","value":N}   N = positive integer
 *   {"mode":"UNLIMITED"}         no other keys
 *
 * Backward compatible with the legacy numeric representation:
 *   "5"  -> {"mode":"COUNT","value":5}
 *   "0"  -> {"mode":"UNLIMITED"}   (legacy "check disabled" semantics)
 *
 * Anything else is rejected with a clear 400 INVALID_SETTING_VALUE payload.
 * Returns the canonical JSON string to persist (valueType 'json').
 */
export function normalizeDailyWithdrawalFrequencySettingValue(
  raw: string | null | undefined,
): string {
  const fail = (message: string): never => {
    throw new HttpException(
      {
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_SETTING_VALUE',
        message,
      },
      400,
    );
  };

  if (raw === null || raw === undefined) {
    return fail(
      'Daily withdrawal frequency value is required (expected {"mode":"COUNT","value":N} or {"mode":"UNLIMITED"})',
    );
  }

  const text = String(raw).trim();
  if (!text) {
    return fail(
      'Daily withdrawal frequency value is required (expected {"mode":"COUNT","value":N} or {"mode":"UNLIMITED"})',
    );
  }

  // ---- Legacy numeric representation (backward compatibility) ----
  if (!text.startsWith('{')) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) {
      return fail(
        `Invalid daily withdrawal frequency value "${text}". Expected a positive integer, {"mode":"COUNT","value":N} or {"mode":"UNLIMITED"}`,
      );
    }
    if (numeric <= 0) {
      return UNLIMITED_FREQUENCY_VALUE;
    }
    if (!Number.isInteger(numeric)) {
      return fail(
        `Daily withdrawal frequency must be a positive integer (received ${numeric})`,
      );
    }
    return countFrequencyValue(numeric);
  }

  // ---- Canonical JSON representation (strict) ----
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(
      'Daily withdrawal frequency value must be valid JSON: {"mode":"COUNT","value":N} or {"mode":"UNLIMITED"}',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(
      'Daily withdrawal frequency value must be a JSON object: {"mode":"COUNT","value":N} or {"mode":"UNLIMITED"}',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const mode = obj.mode;

  if (mode === 'UNLIMITED') {
    if (keys.length !== 1) {
      return fail(
        '{"mode":"UNLIMITED"} must not contain any additional fields',
      );
    }
    return UNLIMITED_FREQUENCY_VALUE;
  }

  if (mode === 'COUNT') {
    if (keys.length !== 2 || keys[0] !== 'mode' || keys[1] !== 'value') {
      return fail(
        '{"mode":"COUNT"} requires exactly the fields "mode" and "value"',
      );
    }
    const value = obj.value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      return fail(
        'Daily withdrawal frequency "value" must be a positive integer',
      );
    }
    return countFrequencyValue(value);
  }

  return fail(
    'Daily withdrawal frequency "mode" must be exactly "COUNT" or "UNLIMITED"',
  );
}

// Approved defaults (Architecture Plan v3, FINAL GLOBAL LIMITS).
export const DEFAULT_MIN_DEPOSIT_USDT = '10';
export const DEFAULT_MAX_DEPOSIT_USDT = '10000';
export const DEFAULT_MIN_WITHDRAWAL_USDT = '5';
export const DEFAULT_MAX_WITHDRAWAL_USDT = '500';
export const DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY = 3;

export type DailyWithdrawalFrequency =
  { mode: 'COUNT'; value: number } | { mode: 'UNLIMITED' };

/**
 * Parses the daily withdrawal frequency setting.
 *
 * Canonical representation (approved): JSON value in admin_settings:
 *   {"mode":"COUNT","value":3}  -> at most `value` accepted withdrawals/day
 *   {"mode":"UNLIMITED"}        -> no daily cap
 *
 * Legacy representation (pre-migration): plain number, e.g. "3".
 * Legacy "0"/non-positive meant "check disabled" — parsed as UNLIMITED to
 * preserve existing production behaviour during migration.
 */
export function parseDailyWithdrawalFrequency(
  raw: string | null | undefined,
): DailyWithdrawalFrequency {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { mode: 'COUNT', value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY };
  }

  const trimmed = raw.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        mode?: unknown;
        value?: unknown;
      };
      if (parsed?.mode === 'UNLIMITED') {
        return { mode: 'UNLIMITED' };
      }
      if (parsed?.mode === 'COUNT') {
        const value = Number(parsed.value);
        if (Number.isInteger(value) && value >= 1) {
          return { mode: 'COUNT', value };
        }
      }
      return { mode: 'COUNT', value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY };
    } catch {
      return { mode: 'COUNT', value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY };
    }
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return { mode: 'COUNT', value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY };
  }
  if (numeric <= 0) {
    return { mode: 'UNLIMITED' };
  }
  return { mode: 'COUNT', value: Math.floor(numeric) };
}

// ============================================================
// MACHINE-READABLE ERROR PAYLOADS
// ============================================================
// Shape mirrors the existing wagering error contract
// (403 WAGERING_REQUIREMENT_INCOMPLETE): machine-readable `code` plus
// context fields, thrown inside the existing zero-mutation validation paths.

export const DEPOSIT_BELOW_MINIMUM_CODE = 'DEPOSIT_BELOW_MINIMUM';
export const DEPOSIT_ABOVE_MAXIMUM_CODE = 'DEPOSIT_ABOVE_MAXIMUM';
export const WITHDRAWAL_BELOW_MINIMUM_CODE = 'WITHDRAWAL_BELOW_MINIMUM';
export const WITHDRAWAL_ABOVE_MAXIMUM_CODE = 'WITHDRAWAL_ABOVE_MAXIMUM';
export const DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE =
  'DAILY_WITHDRAWAL_LIMIT_EXCEEDED';
export const LIMIT_MIN_EXCEEDS_MAX_CODE = 'LIMIT_MIN_EXCEEDS_MAX';
export const MISSING_REASON_CODE = 'MISSING_REASON';

export interface LimitErrorPayload {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  [context: string]: unknown;
}

// ============================================================
// IST DAY WINDOW (Asia/Kolkata, fixed UTC+05:30 — no DST)
// ============================================================

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IstDayWindow {
  /** Inclusive start of the Asia/Kolkata calendar day, as a UTC instant. */
  startUtc: Date;
  /** Exclusive end of the Asia/Kolkata calendar day, as a UTC instant. */
  endUtc: Date;
  /** Inclusive start of the NEXT Asia/Kolkata day — same as endUtc. */
  nextDayStartUtc: Date;
  /** ISO string of next IST midnight — the machine-readable `resetsAt`. */
  resetsAtIso: string;
}
// ============================================================
// LIMITS INTERFACE
// ============================================================

export interface DepositLimits {
  minUsdt: string;
  maxUsdt: string;
}

export interface WithdrawalLimits {
  minUsdt: string;
  maxUsdt: string;
}

export interface UserLimitsView {
  deposit: DepositLimits;
  withdraw: WithdrawalLimits;
  dailyWithdrawals: DailyWithdrawalFrequency;
}

@Injectable()
export class LimitsService {
  private readonly logger = new Logger(LimitsService.name);

  constructor(
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepo: Repository<AdminSetting>,
  ) {}

  // ------------------------------------------------------------
  // READS (DB-authoritative, no cache — enforcement path)
  // ------------------------------------------------------------

  /** Reads a single raw setting value; null when the row is missing. */
  async readRawSetting(key: string): Promise<string | null> {
    const row = await this.adminSettingRepo.findOne({ where: { key } });
    return row ? row.value : null;
  }

  async getDepositLimits(): Promise<DepositLimits> {
    const [min, max] = await Promise.all([
      this.readRawSetting(MIN_DEPOSIT_USDT_KEY),
      this.readRawSetting(MAX_DEPOSIT_USDT_KEY),
    ]);
    return {
      minUsdt: this.positiveOrDefault(min, DEFAULT_MIN_DEPOSIT_USDT),
      maxUsdt: this.positiveOrDefault(max, DEFAULT_MAX_DEPOSIT_USDT),
    };
  }

  async getWithdrawalLimits(): Promise<WithdrawalLimits> {
    const [min, max] = await Promise.all([
      this.readRawSetting(MIN_WITHDRAWAL_USDT_KEY),
      this.readRawSetting(MAX_WITHDRAWAL_USDT_KEY),
    ]);
    return {
      minUsdt: this.positiveOrDefault(min, DEFAULT_MIN_WITHDRAWAL_USDT),
      maxUsdt: this.positiveOrDefault(max, DEFAULT_MAX_WITHDRAWAL_USDT),
    };
  }

  async getDailyWithdrawalFrequency(): Promise<DailyWithdrawalFrequency> {
    const raw = await this.readRawSetting(MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY);
    return parseDailyWithdrawalFrequency(raw);
  }

  /** Aggregate view for the user-facing limits endpoint. */
  async getUserLimitsView(): Promise<UserLimitsView> {
    const [deposit, withdraw, dailyWithdrawals] = await Promise.all([
      this.getDepositLimits(),
      this.getWithdrawalLimits(),
      this.getDailyWithdrawalFrequency(),
    ]);
    return { deposit, withdraw, dailyWithdrawals };
  }

  // ------------------------------------------------------------
  // VALIDATION (exact Decimal.js, zero-mutation on failure)
  // ------------------------------------------------------------

  /**
   * Validates a deposit amount (USDT) against the configured limits.
   * Rejects with an Error carrying the machine-readable payload
   * (DEPOSIT_BELOW_MINIMUM / DEPOSIT_ABOVE_MAXIMUM / INVALID_AMOUNT).
   * Returns the parsed Decimal on success.
   */
  async assertDepositAmount(amountUsdt: Decimal | string): Promise<Decimal> {
    const amount = this.toDecimalOrInvalid(
      amountUsdt,
      'Invalid deposit amount',
    );
    if (!amount.isFinite() || amount.lte(0)) {
      throw this.invalidAmountError('Invalid deposit amount');
    }

    const { minUsdt, maxUsdt } = await this.getDepositLimits();
    if (amount.lt(new Decimal(minUsdt))) {
      throw this.limitError(400, 'Bad Request', DEPOSIT_BELOW_MINIMUM_CODE, {
        message: `Minimum deposit is ${minUsdt} USDT`,
        limit: minUsdt,
        amount: amount.toFixed(18),
      });
    }
    if (amount.gt(new Decimal(maxUsdt))) {
      throw this.limitError(400, 'Bad Request', DEPOSIT_ABOVE_MAXIMUM_CODE, {
        message: `Maximum deposit per transaction is ${maxUsdt} USDT`,
        limit: maxUsdt,
        amount: amount.toFixed(18),
      });
    }
    return amount;
  }

  /**
   * Validates a withdrawal amount (USDT) against the configured limits.
   * Withdrawals are requested in TDX (100 TDX = 1 USDT); callers convert
   * exactly with Decimal.js before calling this.
   */
  async assertWithdrawalAmount(amountUsdt: Decimal | string): Promise<Decimal> {
    const amount = this.toDecimalOrInvalid(
      amountUsdt,
      'Invalid withdrawal amount',
    );
    if (!amount.isFinite() || amount.lte(0)) {
      throw this.invalidAmountError('Invalid withdrawal amount');
    }

    const { minUsdt, maxUsdt } = await this.getWithdrawalLimits();
    if (amount.lt(new Decimal(minUsdt))) {
      throw this.limitError(400, 'Bad Request', WITHDRAWAL_BELOW_MINIMUM_CODE, {
        message: `Minimum withdrawal is ${minUsdt} USDT`,
        limit: minUsdt,
        amount: amount.toFixed(18),
      });
    }
    if (amount.gt(new Decimal(maxUsdt))) {
      throw this.limitError(400, 'Bad Request', WITHDRAWAL_ABOVE_MAXIMUM_CODE, {
        message: `Maximum withdrawal per transaction is ${maxUsdt} USDT`,
        limit: maxUsdt,
        amount: amount.toFixed(18),
      });
    }
    return amount;
  }

  // ------------------------------------------------------------
  // INTERIOR HELPERS
  // ------------------------------------------------------------

  /**
   * Exact Decimal.js parse; non-numeric input becomes a 400 INVALID_AMOUNT
   * instead of leaking a DecimalError.
   */
  private toDecimalOrInvalid(
    value: Decimal | string,
    message: string,
  ): Decimal {
    try {
      return new Decimal(typeof value === 'string' ? value : value.toString());
    } catch {
      throw this.invalidAmountError(message);
    }
  }

  private positiveOrDefault(raw: string | null, fallback: string): string {
    if (raw === null || raw.trim() === '') return fallback;
    try {
      const parsed = new Decimal(raw.trim());
      if (parsed.isFinite() && parsed.gt(0)) return parsed.toFixed(18);
    } catch {
      // fall through to default
    }
    return fallback;
  }

  private invalidAmountError(message: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_AMOUNT',
        message,
      },
      400,
    );
  }

  private limitError(
    statusCode: number,
    error: string,
    code: string,
    context: { message: string; [key: string]: unknown },
  ): HttpException {
    return new HttpException(
      {
        ...context,
        statusCode,
        error,
        code,
      },
      statusCode,
    );
  }
}

/**
 * Returns the [start, end) UTC instants covering the Asia/Kolkata calendar
 * day that contains `now`. IST has no DST so a fixed +05:30 offset is exact.
 */
export function getIstDayWindow(now: Date = new Date()): IstDayWindow {
  const istShifted = now.getTime() + IST_OFFSET_MS;
  const istDayStartShifted = Math.floor(istShifted / DAY_MS) * DAY_MS;
  const startUtcMs = istDayStartShifted - IST_OFFSET_MS;
  const endUtcMs = startUtcMs + DAY_MS;
  return {
    startUtc: new Date(startUtcMs),
    endUtc: new Date(endUtcMs),
    nextDayStartUtc: new Date(endUtcMs),
    resetsAtIso: new Date(endUtcMs).toISOString(),
  };
}
