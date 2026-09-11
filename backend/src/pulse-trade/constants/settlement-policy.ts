import {
  PULSE_TRADE_ADMIN_PERCENT,
  PULSE_TRADE_BONUS_VAULT_PERCENT,
  PULSE_TRADE_FEE_PERCENT,
  PULSE_TRADE_REFERRAL_PERCENT,
} from './trade-config';

/**
 * Finalized Pulse Trade settlement policy.
 */
export const PULSE_SETTLEMENT_POLICY = {
  payout: {
    status: 'DOCUMENTED',
    winMultiplier: '1.9',
    drawMultiplier: '1.0',
    lossPayout: '0',
    version: 'SRS-2026-08-v4-final-net-win-gross-draw',
  },
  fee: {
    status: 'DOCUMENTED',
    totalPercent: PULSE_TRADE_FEE_PERCENT,
  },
  referral: {
    status: 'DOCUMENTED',
    totalPercent: PULSE_TRADE_REFERRAL_PERCENT,
    levels: {
      L1: '0.75',
      L2: '0.35',
      L3: '0.25',
      L4: '0.25',
      L5: '0.20',
      L6: '0.20',
    },
    unassignedPolicy: 'ROLLUP_TO_PLATFORM_REFERRAL_POOL',
    unassignedAccountingDestination: 'PULSE_LIQUIDITY_POOL',
    distributionTiming: 'TRADE_ENTRY',
  },
  admin: {
    status: 'DOCUMENTED',
    allocationPercent: PULSE_TRADE_ADMIN_PERCENT,
    accountingDestination: 'PLATFORM_ADMIN_POOL',
  },
  bonusVault: {
    status: 'DOCUMENTED',
    allocationPercent: PULSE_TRADE_BONUS_VAULT_PERCENT,
    accountingDestination: 'PLATFORM_BONUS_VAULT_POOL',
  },
  ledger: {
    settlementReferenceTypeStatus: 'DOCUMENTED',
    settlementReferenceType: 'TRADE_SETTLEMENT',
    feeReferenceType: 'TRADE_FEE_ALLOCATION',
    feeAllocationReferenceType: 'TRADE_FEE_DISTRIBUTION',
    unallocatedReferralToLiquidityReferenceType:
      'TRADE_FEE_UNALLOCATED_TO_LIQUIDITY_POOL',
  },
} as const;
