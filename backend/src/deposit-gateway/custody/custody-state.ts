/**
 * Global custody emergency state (TradeX Custody Hardening).
 *
 * Read at runtime from configuration so an emergency response does NOT require
 * a code deploy or DB migration — an operator can flip the state via the
 * secret manager / environment and the change takes effect on next request
 * (and is re-read per request, never cached in a way that survives a restart
 * incorrectly).
 *
 * States:
 *   NORMAL            — standard operations: allocate, sweep, derive.
 *   CUSTODY_LOCKDOWN  — master seed suspected/confirmed compromised:
 *                       stop new allocation, stop automatic sweeps, preserve
 *                       all records. No new derived accounts.
 *   RECOVERY          — controlled post-compromise recovery: elevated ops
 *                       allowed (e.g. one-time fund movement to a new treasury)
 *                       under strict audit. Still no routine allocation/sweep.
 */

export enum CustodyState {
  NORMAL = 'NORMAL',
  CUSTODY_LOCKDOWN = 'CUSTODY_LOCKDOWN',
  RECOVERY = 'RECOVERY',
}

export const CUSTODY_STATE_ENV_KEY = 'CUSTODY_STATE';
export const CUSTODY_GENERATION_ENV_KEY = 'CUSTODY_GENERATION';

export function normalizeCustodyState(value: string | undefined): CustodyState {
  const v = (value ?? '').trim().toUpperCase();
  if (v === CustodyState.CUSTODY_LOCKDOWN) return CustodyState.CUSTODY_LOCKDOWN;
  if (v === CustodyState.RECOVERY) return CustodyState.RECOVERY;
  return CustodyState.NORMAL;
}

export function normalizeCustodyGeneration(value: string | undefined): number {
  const n = Number((value ?? '').trim());
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return 1;
  return n;
}

export function isAllocationAllowed(state: CustodyState): boolean {
  return state === CustodyState.NORMAL;
}

export function isAutomaticSweepAllowed(state: CustodyState): boolean {
  return state === CustodyState.NORMAL;
}
