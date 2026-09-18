// frontend/src/admin/types/wagering.types.ts
//
// Types mirror the backend wagering contract (backend/src/wagering).
// All money values are exact 18dp decimal strings — never parse them into
// floats for display or arithmetic; use the provided formatDecimal helper.

export type WageringEligibleActivity = 'LOTTO' | 'TRADE' | 'BOTH';

export type WageringObligationStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export type WageringMultiplierSource = 'USER_OVERRIDE' | 'GLOBAL_DEFAULT';

export type WageringSettings = {
  singletonKey: number;
  wageringEnabled: boolean;
  defaultMultiplier: number;
  allowedMultipliers: number[];
  eligibleActivity: WageringEligibleActivity;
  withdrawalEnforcement: boolean;
  notifyUsers: boolean;
  expiryDays: number;
  reconciliationMaxAgeDays: number;
  policyVersion: number;
  activationTimestamp?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateWageringSettingsPayload = {
  wageringEnabled?: boolean;
  defaultMultiplier?: number;
  allowedMultipliers?: number[];
  eligibleActivity?: WageringEligibleActivity;
  withdrawalEnforcement?: boolean;
  notifyUsers?: boolean;
  expiryDays?: number;
  reconciliationMaxAgeDays?: number;
  reason: string;
};

export type WageringObligation = {
  id: string;
  userId: string;
  depositId: string;
  ledgerEntryId: string;
  sourceUsdtAmount: string;
  sourceTdxAmount: string;
  conversionRate: string;
  depositAmountTdx: string;
  multiplier: number;
  requiredAmount: string;
  completedAmount: string;
  remainingAmount: string;
  status: WageringObligationStatus;
  policyVersion: number;
  eligibleActivity: WageringEligibleActivity;
  expiresAt?: string | null;
  cancelledReason?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type WageringOverride = {
  id?: string;
  userId?: string;
  multiplier: number;
  previousValue?: number | null;
  reason: string;
  adminId?: string;
  appliedFrom?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WageringUserSummary = {
  wageringEnabled: boolean;
  withdrawalEligible: boolean;
  applicableMultiplier: number;
  multiplierSource: WageringMultiplierSource;
  totalRequired: string;
  totalCompleted: string;
  totalRemaining: string;
  ruleExplanation: string;
  obligations: WageringObligation[];
  override?: WageringOverride | null;
};

export type WageringObligationListResponse = {
  items: WageringObligation[];
  total: number;
};

export type WageringAuditAction =
  | 'WAGERING_SETTINGS_UPDATE'
  | 'WAGERING_OVERRIDE_SET'
  | 'WAGERING_OVERRIDE_REMOVE'
  | 'WAGERING_OBLIGATION_CANCEL'
  | 'WAGERING_RECONCILE_RUN';

export type WageringAuditEntry = {
  id: string;
  adminId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  createdAt: string;
};

export type WageringAuditResponse = {
  items: WageringAuditEntry[];
  total: number;
};

export type WageringObligationQueryParams = {
  userId?: string;
  status?: WageringObligationStatus;
  limit?: number;
  offset?: number;
};

export type WageringAuditQueryParams = {
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
};

/**
 * Formats an exact 18dp decimal string for display without floating-point
 * rounding of the whole value. Trimming only removes insignificant trailing
 * zeros, so "100.000000000000000000" renders as "100".
 */
export function formatWageringDecimal(value?: string | null, maxDecimals = 6): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;

  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  const rendered = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return negative ? `-${rendered}` : rendered;
}