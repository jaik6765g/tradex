// ============================================================
// TRADEX WALLET SERVICE
// ============================================================

import { apiClient } from '../../core/api/client';
import type { WalletBalance } from '../types/wallet.types';
import type { Transaction, TransactionFilter } from '../transactions/types/transaction.types';

// ============================================================
// TYPES
// ============================================================

export type BalanceResponse = {
  userId: string;
  availableBalance: number;
  lockedBalance: number;
  gameLocked: number;
  tradingLocked: number;
  withdrawalLocked: number;
  totalBalance: number;
};

export interface ExtendedWalletBalance extends WalletBalance {
  tdxAvailable: string;
  tdxLocked: string;
  tdxTotal: string;
  gameLocked: string;
  tradingLocked: string;
  withdrawalLocked: string;
}

export interface TransactionResponse {
  id: string;
  type: string;
  amount: number | string;
  balanceBefore: number | string;
  balanceAfter: number | string;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface TransactionListResponse {
  items: Transaction[];
  total: number;
  hasMore: boolean;
}

interface TransactionListEnvelope {
  items?: unknown[];
  total?: unknown;
}

interface LedgerSummaryItem {
  type: string;
  total: string;
}

// ============================================================
// HELPERS
// ============================================================

export function formatBalanceAmount(
  value: number | string | null | undefined,
  fractionDigits = 2,
): string {
  if (value === null || value === undefined) return (0).toFixed(fractionDigits);
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return (0).toFixed(fractionDigits);
  return numeric.toFixed(fractionDigits);
}

// ============================================================
// TRANSFORMERS
// ============================================================

// Ledger types that represent money credited to the user's balance.
// The backend stores every ledger amount as a non-negative decimal,
// so the display direction (+/-) is derived from the type.
const CREDIT_LEDGER_TYPES: ReadonlySet<string> = new Set([
  'DEPOSIT',
  'GAME_WIN',
  'TRADE_PROFIT',
  'TRADE_DRAW',
  'WITHDRAWAL_RELEASE',
  'BOT_FIRST_ACTIVATION_REFERRAL',
  'BOT_FIRST_ACTIVATION_LIQUIDITY',
  'ADMIN_ADJUSTMENT',
]);

/**
 * Detect a manual admin-bonus ledger entry. Bonuses are written as
 * ADMIN_ADJUSTMENT rows tagged with referenceType/metadata.category
 * 'ADMIN_BONUS' and a "Admin bonus: ..." description.
 */
function isBonusLedgerEntry(item: TransactionResponse): boolean {
  const referenceType = (item.referenceType ?? '').toUpperCase();
  const category =
    typeof item.metadata?.category === 'string'
      ? item.metadata.category.toUpperCase()
      : '';
  const description = (item.description ?? '').trim().toUpperCase();

  return (
    referenceType === 'ADMIN_BONUS' ||
    category === 'ADMIN_BONUS' ||
    description.startsWith('ADMIN BONUS:')
  );
}

function mapLedgerType(
  type: string,
  item: TransactionResponse,
): Transaction['type'] {
  const t = (type ?? '').toUpperCase();
  if (t === 'ADMIN_ADJUSTMENT' && isBonusLedgerEntry(item)) return 'bonus';
  if (t.includes('DEPOSIT')) return 'deposit';
  if (t.includes('WITHDRAWAL')) return 'withdraw';
  if (t.includes('TRADE')) return 'trade';
  if (t.includes('GAME')) return 'game';
  return 'other';
}

// Determine the UI direction (+/-) for a ledger entry. Shares the
// backend's accounting metadata when available, otherwise falls back
// to the ledger type. Unknown types yield `undefined` so consumers
// can keep their generic presentation.
function mapLedgerDirection(item: TransactionResponse): 'credit' | 'debit' | undefined {
  const t = (item.type ?? '').toUpperCase();
  const metadata = item.metadata ?? {};
  const accounting =
    typeof metadata.accounting === 'string'
      ? metadata.accounting.toUpperCase()
      : '';

  if (accounting.includes('CREDIT')) return 'credit';
  if (accounting.includes('DEBIT')) return 'debit';
  if (typeof metadata.debitSource === 'string' && metadata.debitSource.length > 0) {
    return 'debit';
  }

  for (const creditType of CREDIT_LEDGER_TYPES) {
    if (t.includes(creditType)) return 'credit';
  }
  if (t.includes('TRADE') || t.includes('GAME') || t.includes('WITHDRAWAL')) {
    return 'debit';
  }
  return undefined;
}

// ============================================================
// WITHDRAWAL STATUS MAPPING
// ============================================================
//
// The withdrawals service writes into each withdrawal ledger entry's
// metadata a `status` snapshot of the withdrawal lifecycle at the time
// the ledger event happened (upstream `createLedger`), e.g.:
//   WITHDRAWAL_LOCK      -> metadata.status = REQUESTED
//   WITHDRAWAL (consume) -> metadata.status = COMPLETED
//   WITHDRAWAL_RELEASE   -> metadata.status = pre-release status
//
// These raw lifecycle values are normalized into the display statuses
// used across the Transactions UI so a pending admin-approval
// withdrawal no longer shows as "Completed".

const WITHDRAWAL_STATUS_MAP: Readonly<Record<string, Transaction['status']>> = {
  REQUESTED: 'pending',
  RISK_CHECKING: 'processing',
  LIQUIDITY_CHECK: 'processing',
  PENDING_ADMIN_APPROVAL: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  QUEUED: 'processing',
  PROCESSING: 'processing',
  SENT: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  HOLD: 'pending',
};

// Map the actual withdrawal status preserved in the ledger response.
// Non-withdrawal ledger entries represent settled/credited events and
// stay "completed".
function mapLedgerStatus(
  item: TransactionResponse,
  type: Transaction['type'],
): Transaction['status'] {
  if (type !== 'withdraw') return 'completed';

  const entryType = (item.type ?? '').toUpperCase();
  const rawStatus =
    typeof item.metadata?.status === 'string'
      ? item.metadata.status.trim().toUpperCase()
      : '';

  // A release event returns the reserved TDX because the withdrawal
  // was rejected/cancelled/failed. The snapshot metadata can still
  // hold the pre-release status, so the event type wins.
  if (entryType.includes('RELEASE')) {
    const mapped = WITHDRAWAL_STATUS_MAP[rawStatus];
    if (mapped === 'cancelled' || mapped === 'failed') return mapped;
    return 'rejected';
  }

  if (rawStatus && WITHDRAWAL_STATUS_MAP[rawStatus]) {
    return WITHDRAWAL_STATUS_MAP[rawStatus];
  }

  // No snapshot present — fall back to event semantics:
  // WITHDRAWAL_LOCK = reserve in flight (pending), WITHDRAWAL = done.
  if (entryType === 'WITHDRAWAL') return 'completed';
  return 'pending';
}

// Normalize a raw ledger amount into an absolute decimal string.
// Financial values stay as strings end-to-end — no float arithmetic.
function toAmountString(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0';
  let s = typeof value === 'number' ? value.toString() : String(value).trim();
  if (s.startsWith('-')) s = s.slice(1);
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[^0-9.]/g, '');
  if (s === '' || s === '.') return '0';
  return s;
}

// Exact decimal division by 10^places using string math (no floats).
function shiftDecimalPointLeft(value: string, places: number): string {
  const dot = value.indexOf('.');
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const fracPart = dot === -1 ? '' : value.slice(dot + 1);
  const digits = (intPart || '0') + fracPart;
  const fracLen = fracPart.length;
  const intCount = digits.length - fracLen - places;

  let newInt: string;
  let newFrac: string;
  if (intCount >= 1) {
    newInt = digits.slice(0, intCount);
    newFrac = digits.slice(intCount);
  } else {
    newInt = '0';
    newFrac = '0'.repeat(-intCount) + digits;
  }

  newInt = newInt.replace(/^0+(?=\d)/, '');
  if (newInt === '') newInt = '0';
  newFrac = newFrac.replace(/0+$/, '');
  return newFrac === '' ? newInt : `${newInt}.${newFrac}`;
}

function mapLedgerEntry(item: TransactionResponse): Transaction {
  const type = mapLedgerType(item.type, item);
  const metadata = item.metadata ?? {};
  const amount = toAmountString(item.amount);

  let currency = 'TDX';
  let displayAmount = amount;
  let tdxAmount = amount;
  let usdtAmount: string | undefined;

  if (type === 'deposit') {
    // Ledger amount is the TDX credited; the original USDT amount is in metadata.
    currency = 'TDX';
    displayAmount = amount;
    tdxAmount = amount;
    usdtAmount =
      metadata.usdtAmount != null ? String(metadata.usdtAmount) : undefined;
  } else if (type === 'withdraw') {
    // Existing UI conversion rule (100 TDX = 1 USDT), computed with
    // exact decimal string math — the stored TDX value is unchanged.
    currency = 'USDT';
    displayAmount = shiftDecimalPointLeft(amount, 2);
    usdtAmount = displayAmount;
    tdxAmount = amount;
  } else {
    currency = 'TDX';
    displayAmount = amount;
    tdxAmount = amount;
  }

  return {
    id: item.id,
    type,
    direction: mapLedgerDirection(item),
    status: mapLedgerStatus(item, type),
    amount: displayAmount,
    currency,
    tdxAmount,
    usdtAmount,
    txHash: item.referenceId || item.id,
    timestamp: item.createdAt,
    description: item.description,
    metadata: item.metadata,
  };
}

// ============================================================
// SAFE AMOUNT FORMATTING (display only — keeps values as strings)
// ============================================================

function incrementDecimalString(intPart: string): string {
  const chars = intPart.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === '9') {
      chars[i] = '0';
    } else {
      const next = '0123456789'.charAt('0123456789'.indexOf(chars[i]) + 1);
      chars[i] = next === '' ? '0' : next;
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

function roundFractionTo(
  fracPart: string,
  maxDecimals: number,
): { value: string; carry: boolean } {
  if (fracPart.length <= maxDecimals) {
    return { value: fracPart, carry: false };
  }

  const keep = fracPart.slice(0, maxDecimals);
  if (fracPart[maxDecimals] < '5') {
    return { value: keep, carry: false };
  }

  const chars = keep.split('');
  let carry = true;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === '9') {
      chars[i] = '0';
    } else {
      const next = '0123456789'.charAt('0123456789'.indexOf(chars[i]) + 1);
      chars[i] = next === '' ? '0' : next;
      carry = false;
      break;
    }
  }
  return { value: chars.join(''), carry };
}

/**
 * Format a monetary value for display only. Rounds to `maxDecimals`
 * using base-10 string math — it never converts the value to a float
 * and never mutates the underlying financial amount.
 */
export function formatTokenAmount(
  value: string | number | null | undefined,
  maxDecimals = 2,
): string {
  if (value === null || value === undefined) return (0).toFixed(maxDecimals);

  let s = typeof value === 'number' ? value.toString() : String(value).trim();
  if (s === '') s = '0';

  let sign = '';
  if (s.startsWith('-')) {
    sign = '-';
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[^0-9.]/g, '');

  const dot = s.indexOf('.');
  const intRaw = dot === -1 ? s : s.slice(0, dot);
  const fracRaw = dot === -1 ? '' : s.slice(dot + 1);

  let intPart = intRaw.replace(/^0+(?=\d)/, '');
  if (intPart === '') intPart = '0';

  let fracPart = fracRaw;
  if (fracPart.length > maxDecimals) {
    const rounded = roundFractionTo(fracPart, maxDecimals);
    fracPart = rounded.value;
    if (rounded.carry) intPart = incrementDecimalString(intPart);
  }

  if (maxDecimals <= 0) return `${sign}${intPart}`;
  if (fracPart.length < maxDecimals) {
    fracPart = fracPart.padEnd(maxDecimals, '0');
  }

  return `${sign}${intPart}.${fracPart}`;
}

// ============================================================
// RESPONSE NORMALIZATION
// ============================================================
//
// GET /ledger/me returns a plain array of ledger entries without a
// total. Some endpoints in the codebase can return an envelope
// ({ items, total }). Shape normalization lives here so screen code
// never has to know which one the API returned.
// ============================================================

function isTransactionResponse(value: unknown): value is TransactionResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TransactionResponse).id === 'string' &&
    typeof (value as TransactionResponse).type === 'string' &&
    typeof (value as TransactionResponse).createdAt === 'string'
  );
}

function normalizeTransactionList(
  raw: unknown,
  limit: number,
  offset: number,
): TransactionListResponse {
  // Array response: [ {...}, {...} ]
  if (Array.isArray(raw)) {
    const items = raw.filter(isTransactionResponse).map(mapLedgerEntry);
    // No total is provided by the backend — a full page means there
    // may be more records, so pagination uses the page-full signal.
    const hasMore = items.length >= Math.max(1, limit);
    return {
      items,
      total: offset + items.length,
      hasMore,
    };
  }

  // Envelope response: { items: [...], total: number }
  if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as TransactionListEnvelope).items)
  ) {
    const data = raw as TransactionListEnvelope;
    const items = (data.items ?? [])
      .filter(isTransactionResponse)
      .map(mapLedgerEntry);
    const total =
      typeof data.total === 'number' && Number.isFinite(data.total)
        ? Math.max(0, data.total)
        : offset + items.length;
    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  return { items: [], total: Math.max(0, offset), hasMore: false };
}

// ============================================================
// WALLET SERVICE
// ============================================================

export class WalletService {
  static async getMyBalance(options?: { signal?: AbortSignal }): Promise<BalanceResponse> {
    const res = await apiClient.get<BalanceResponse>('/balances/me', options);
    return res.data;
  }

  static async getBalance(_userId: string): Promise<ExtendedWalletBalance> {
    const res = await this.getMyBalance();
    return {
      usdt: '0',
      tdx: formatBalanceAmount(res.availableBalance),
      native: '0',
      nativeSymbol: 'BNB',
      tdxAvailable: formatBalanceAmount(res.availableBalance),
      tdxLocked: formatBalanceAmount(res.lockedBalance),
      tdxTotal: formatBalanceAmount(res.totalBalance),
      gameLocked: formatBalanceAmount(res.gameLocked),
      tradingLocked: formatBalanceAmount(res.tradingLocked),
      withdrawalLocked: formatBalanceAmount(res.withdrawalLocked),
    };
  }

  static async getTransactionHistory(
    _userId: string,
    limit = 20,
    offset = 0,
  ): Promise<Transaction[]> {
    try {
      const res = await apiClient.get<TransactionResponse[]>('/ledger/me', { params: { limit, offset } });
      return res.data.map(mapLedgerEntry);
    } catch {
      // Fail gracefully — history must never block the deposit /
      // wallet UI. Transient API timeouts return an empty list and
      // the next refresh cycle picks the data up.
      return [];
    }
  }

  static async getTransactions(
    _userId: string,
    limit = 20,
    offset = 0,
    _filter?: TransactionFilter,
  ): Promise<TransactionListResponse> {
    const res = await apiClient.get<
      TransactionResponse[] | { items?: TransactionResponse[]; total?: unknown }
    >('/ledger/me', { params: { limit, offset } });
    return normalizeTransactionList(res.data, limit, offset);
  }

  static async getTransaction(txId: string): Promise<Transaction> {
    const res = await apiClient.get<TransactionResponse[]>('/ledger/me', { params: { limit: 200, offset: 0 } });
    const found = res.data.find((item) => item.id === txId || item.referenceId === txId);
    if (!found) throw new Error('Transaction not found');
    return mapLedgerEntry(found);
  }

  static async getTransactionSummary(_userId: string): Promise<{
    totalDeposits: string;
    totalWithdrawals: string;
    totalTrades: string;
    totalGames: string;
  }> {
    const res = await apiClient.get<LedgerSummaryItem[]>('/ledger/me/summary');
    const data = res.data;
    const sum = (prefix: string) =>
      data
        .filter((item) => item.type.toUpperCase().includes(prefix))
        .reduce((acc, item) => acc + Number(item.total || 0), 0);

    return {
      totalDeposits: sum('DEPOSIT').toString(),
      totalWithdrawals: sum('WITHDRAWAL').toString(),
      totalTrades: sum('TRADE').toString(),
      totalGames: sum('GAME').toString(),
    };
  }
}