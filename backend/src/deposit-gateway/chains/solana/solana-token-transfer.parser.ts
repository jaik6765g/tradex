// ============================================================
// SOLANA SPL USDT TRANSFER PARSER (READ-ONLY)
// ============================================================
// Extracts a single token transfer from a parsed Solana transaction
// (getTransaction with jsonParsed encoding). Rejects native SOL transfers
// (lamports), memo-only txs, non-token instructions and unsupported formats.
//
// Recipient identity must NEVER be derived from this parser alone — the
// destination token account must be resolved back to a TradeX deposit address
// via getTokenAccountsByOwner (see solana-deposit-detection.processor).
// ============================================================

export interface ParsedSplTransfer {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Raw token units (integer string — never a float). */
  amountRaw: string;
  sourceTokenAccount: string | null;
  destinationTokenAccount: string | null;
  authority: string | null;
  success: boolean;
  /** 'processed' | 'confirmed' | 'finalized' | null. */
  confirmationStatus: string | null;
  error: string | null;
}

const TOKEN_PROGRAM_NAMES = new Set(['spl-token', 'spl-token-2022']);
const TRANSFER_TYPES = new Set(['transfer', 'transferChecked']);

/** Confirmations = latestSlot − txSlot + 1 (never negative). */
export function computeSolanaConfirmations(latestSlot: number, txSlot: number): number {
  return Math.max(0, latestSlot - txSlot + 1);
}

/**
 * Extract the FIRST valid SPL token transfer from a parsed Solana transaction.
 * Returns null when the transaction is not a safely-attributable token transfer
 * (never guess — callers route null to ignore/manual-review, NOT credit).
 */
export function extractSplTransfer(tx: unknown, signature: string): ParsedSplTransfer | null {
  if (!tx || typeof tx !== 'object') return null;
  const t = tx as any;

  const slot = Number(t.slot ?? 0);
  const blockTime = t.blockTime == null ? null : Number(t.blockTime);
  const err = t.meta?.err;
  const success = err == null || err === false || err === undefined;

  const instructions = t.transaction?.message?.instructions;
  if (!Array.isArray(instructions)) return null;

  let found: any = null;
  for (const ins of instructions) {
    if (!ins || typeof ins !== 'object') continue;
    if (typeof ins.parsed !== 'object' || ins.parsed === null) continue;
    const type = ins.parsed.type;
    if (!TRANSFER_TYPES.has(type)) continue;
    // Must be an SPL token program transfer, not a native SOL/system transfer.
    if (ins.parsed.program && !TOKEN_PROGRAM_NAMES.has(ins.parsed.program)) continue;
    found = ins;
    break;
  }
  if (!found) return null;

  const value = found.parsed.value ?? found.parsed.info ?? found.parsed;
  if (!value || typeof value !== 'object') return null;
  // Native SOL transfers carry lamports — never treat them as USDT.
  if (value.lamports !== undefined) return null;

    const amount = value.tokenAmount?.amount ?? value.amount;
  if (amount === undefined || amount === null) return null;
  let amountRaw: string;
  try {
    amountRaw = typeof amount === 'bigint' ? amount.toString() : BigInt(String(amount)).toString();
  } catch {
    return null;
  }
  if (BigInt(amountRaw) <= 0n) return null;

  const destination = typeof value.destination === 'string' ? value.destination : null;
  const source = typeof value.source === 'string' ? value.source : null;
  const authority = typeof value.authority === 'string' ? value.authority : null;
  if (!destination) return null; // unknown recipient → must not credit

  return {
    signature,
    slot,
    blockTime,
    amountRaw,
    sourceTokenAccount: source,
    destinationTokenAccount: destination,
    authority,
    success,
    confirmationStatus:
      typeof t.meta?.confirmationStatus === 'string' ? t.meta.confirmationStatus : null,
    error: success ? null : JSON.stringify(err),
  };
}