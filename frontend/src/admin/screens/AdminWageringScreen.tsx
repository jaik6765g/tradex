// frontend/src/admin/screens/AdminWageringScreen.tsx
//
// Admin screens for the deposit wagering requirement system:
//   1. Global wagering settings
//   2. User-specific multiplier override
//   3. User wagering summary
//   4. Active obligations
//   5. Audit history
//
// Every mutation sends a mandatory reason; the backend requires AdminGuard +
// MFA/AAL2 and writes an immutable admin_audit_logs row (targetType=WAGERING).
// Wagering records never alter balances or ledger entries — the existing
// Balance/Ledger remains the only financial source of truth.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  History,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  UserCog,
} from 'lucide-react';

import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import {
  AdminWageringService,
  extractWageringErrorMessage,
} from '../services/wagering.service';
import type {
  UpdateWageringSettingsPayload,
  WageringAuditEntry,
  WageringEligibleActivity,
  WageringObligation,
  WageringObligationStatus,
  WageringOverride,
  WageringSettings,
  WageringUserSummary,
} from '../types/wagering.types';
import { formatWageringDecimal } from '../types/wagering.types';

type TabKey = 'settings' | 'override' | 'summary' | 'obligations' | 'audit';

const TABS: Array<{
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: 'settings', label: 'Global Settings', icon: Settings2 },
  { key: 'override', label: 'User Override', icon: UserCog },
  { key: 'summary', label: 'User Summary', icon: ShieldCheck },
  { key: 'obligations', label: 'Obligations', icon: RefreshCw },
  { key: 'audit', label: 'Audit History', icon: History },
];

const DEFAULT_ALLOWED = [1, 2, 3, 5, 10];

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function obligationVariant(
  status: WageringObligationStatus,
): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'ACTIVE') return 'warning';
  if (status === 'CANCELLED') return 'error';
  return 'neutral';
}

function progressPercent(obligation: WageringObligation): number {
  // Presentational progress only. Money strings are never parsed into floats
  // for any financial decision — the backend remains authoritative.
  const required = Number(obligation.requiredAmount);
  const completed = Number(obligation.completedAmount);
  if (!Number.isFinite(required) || required <= 0) return 0;
  if (!Number.isFinite(completed) || completed <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / required) * 100)));
}

function FieldNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2 text-xs text-[#A1A4AE]">
      {children}
    </p>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
      <span className="text-sm font-bold text-[#E4E5E8]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-[#FF7A18]"
      />
    </label>
  );
}

function ReasonField({
  value,
  onChange,
  label = 'Reason (mandatory, stored permanently in the audit log)',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="Explain why this change is required (minimum 5 characters)"
        className="w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm text-[#F5F5F7]"
      />
      {value.trim().length > 0 && value.trim().length < 5 ? (
        <span className="mt-1 block text-xs text-[#F87171]">
          A reason of at least 5 characters is required.
        </span>
      ) : null}
    </label>
  );
}

function UserIdField({
  value,
  onChange,
  onSubmit,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[240px] flex-1">
        <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">User ID</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="User UUID"
          className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
        />
      </label>
      <Button onClick={onSubmit} loading={loading} disabled={!value.trim()}>
        <Search size={16} /> Load
      </Button>
    </div>
  );
}

function ObligationCard({
  obligation,
  onCancel,
  cancelling,
}: {
  obligation: WageringObligation;
  onCancel?: (obligation: WageringObligation) => void;
  cancelling?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={obligationVariant(obligation.status)}>{obligation.status}</Badge>
          <Badge variant="info">{obligation.multiplier}X</Badge>
          <Badge variant="neutral">Policy v{obligation.policyVersion}</Badge>
        </div>
        <span className="text-[11px] text-[#A1A4AE]">{formatDateTime(obligation.createdAt)}</span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-[#A1A4AE] sm:grid-cols-4">
        <div>
          <span className="block text-[11px] uppercase tracking-wide">Deposit (TDX)</span>
          <span className="text-sm font-bold text-[#F5F5F7]">
            {formatWageringDecimal(obligation.depositAmountTdx)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide">Required</span>
          <span className="text-sm font-bold text-[#F5F5F7]">
            {formatWageringDecimal(obligation.requiredAmount)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide">Completed</span>
          <span className="text-sm font-bold text-[#4ADE80]">
            {formatWageringDecimal(obligation.completedAmount)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide">Remaining</span>
          <span className="text-sm font-bold text-[#FF8F3D]">
            {formatWageringDecimal(obligation.remainingAmount)}
          </span>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#1B1C22]">
        <div
          className="h-full rounded-full bg-[#FF7A18]"
          style={{ width: `${progressPercent(obligation)}%` }}
        />
      </div>

      <div className="mt-3 grid gap-1 text-[11px] text-[#A1A4AE] sm:grid-cols-2">
        <span>Source deposit: {obligation.depositId}</span>
        <span>Ledger entry: {obligation.ledgerEntryId}</span>
        <span>
          Source: {formatWageringDecimal(obligation.sourceUsdtAmount)} USDT →{' '}
          {formatWageringDecimal(obligation.sourceTdxAmount)} TDX
        </span>
        <span>Rate snapshot: {formatWageringDecimal(obligation.conversionRate, 8)}</span>
        <span>Eligible activity: {obligation.eligibleActivity}</span>
        <span>Expires: {formatDateTime(obligation.expiresAt)}</span>
      </div>

      {obligation.cancelledReason ? (
        <p className="mt-2 text-xs text-[#F87171]">
          Cancelled reason: {obligation.cancelledReason}
        </p>
      ) : null}

      {onCancel && obligation.status === 'ACTIVE' ? (
        <div className="mt-3">
          <Button variant="danger" onClick={() => onCancel(obligation)} loading={cancelling}>
            <Ban size={16} /> Cancel obligation
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// 1. GLOBAL SETTINGS
// ------------------------------------------------------------------

function GlobalSettingsPanel() {
  const [settings, setSettings] = useState<WageringSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const [wageringEnabled, setWageringEnabled] = useState(false);
  const [defaultMultiplier, setDefaultMultiplier] = useState(2);
  const [allowedMultipliers, setAllowedMultipliers] = useState<number[]>(DEFAULT_ALLOWED);
  const [eligibleActivity, setEligibleActivity] =
    useState<WageringEligibleActivity>('BOTH');
  const [withdrawalEnforcement, setWithdrawalEnforcement] = useState(false);
  const [notifyUsers, setNotifyUsers] = useState(true);
  const [expiryDays, setExpiryDays] = useState(0);
  const [reconciliationMaxAgeDays, setReconciliationMaxAgeDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await AdminWageringService.getSettings();
      setSettings(data);
      setWageringEnabled(data.wageringEnabled);
      setDefaultMultiplier(data.defaultMultiplier);
      setAllowedMultipliers(data.allowedMultipliers ?? DEFAULT_ALLOWED);
      setEligibleActivity(data.eligibleActivity);
      setWithdrawalEnforcement(data.withdrawalEnforcement);
      setNotifyUsers(data.notifyUsers);
      setExpiryDays(data.expiryDays ?? 0);
      setReconciliationMaxAgeDays(data.reconciliationMaxAgeDays ?? 30);
    } catch (loadError) {
      setError(extractWageringErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMultiplier = (value: number) => {
    setAllowedMultipliers((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value].sort((a, b) => a - b),
    );
  };

  const validationError = useMemo(() => {
    if (allowedMultipliers.length === 0) {
      return 'At least one multiplier must be allowed.';
    }
    if (!allowedMultipliers.includes(defaultMultiplier)) {
      return 'The default multiplier must be present in the allowed list.';
    }
    if (reason.trim().length < 5) {
      return 'A reason of at least 5 characters is required.';
    }
    return null;
  }, [allowedMultipliers, defaultMultiplier, reason]);

  const handleSave = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: UpdateWageringSettingsPayload = {
        wageringEnabled,
        defaultMultiplier,
        allowedMultipliers,
        eligibleActivity,
        withdrawalEnforcement,
        notifyUsers,
        expiryDays,
        reconciliationMaxAgeDays,
        reason: reason.trim(),
      };
      const result = await AdminWageringService.updateSettings(payload);
      setSettings(result.settings);
      setReason('');
      setNotice(
        `Settings saved at policy version ${result.policyVersion}. Existing obligations keep their original multiplier and policy version.`,
      );
    } catch (saveError) {
      setError(extractWageringErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await AdminWageringService.reconcile();
      setNotice(
        `Reconciliation complete — scanned ${result.scanned}, created ${result.created}, skipped ${result.skipped}.`,
      );
    } catch (reconcileError) {
      setError(extractWageringErrorMessage(reconcileError));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <ErrorState title="Wagering error" description={error} /> : null}
      {notice ? (
        <div className="rounded-[12px] border border-[#1E4A32] bg-[#10251A] px-3 py-2 text-sm text-[#4ADE80]">
          {notice}
        </div>
      ) : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#F5F5F7]">Global wagering settings</h2>
            <p className="mt-1 text-xs text-[#A1A4AE]">
              Applies to deposits credited after wagering is enabled. Deposits credited before the
              activation timestamp never create obligations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="info">Policy v{settings?.policyVersion ?? '—'}</Badge>
            <Badge variant={wageringEnabled ? 'success' : 'neutral'}>
              {wageringEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Wagering enabled"
            checked={wageringEnabled}
            onChange={setWageringEnabled}
          />
          <Toggle
            label="Withdrawal enforcement"
            checked={withdrawalEnforcement}
            onChange={setWithdrawalEnforcement}
          />
          <Toggle label="Notify users" checked={notifyUsers} onChange={setNotifyUsers} />

          <label className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
            <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">Eligible activity</span>
            <select
              value={eligibleActivity}
              onChange={(event) =>
                setEligibleActivity(event.target.value as WageringEligibleActivity)
              }
              className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            >
              <option value="BOTH">BOTH (Lotto + Trade)</option>
              <option value="LOTTO">LOTTO</option>
              <option value="TRADE">TRADE</option>
            </select>
          </label>

          <label className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
            <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">Default multiplier</span>
            <select
              value={defaultMultiplier}
              onChange={(event) => setDefaultMultiplier(Number(event.target.value))}
              className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            >
              {allowedMultipliers.map((value) => (
                <option key={value} value={value}>
                  {value}X
                </option>
              ))}
            </select>
          </label>

          <label className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
            <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">
              Obligation expiry (days, 0 = never)
            </span>
            <input
              type="number"
              min={0}
              max={3650}
              value={expiryDays}
              onChange={(event) => setExpiryDays(Number(event.target.value))}
              className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            />
          </label>

          <label className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
            <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">
              Reconciliation window (days, 0 = unlimited)
            </span>
            <input
              type="number"
              min={0}
              max={3650}
              value={reconciliationMaxAgeDays}
              onChange={(event) => setReconciliationMaxAgeDays(Number(event.target.value))}
              className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">Allowed multipliers</span>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ALLOWED.map((value) => {
              const active = allowedMultipliers.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleMultiplier(value)}
                  className={
                    active
                      ? 'rounded-full border border-[#FF7A18] bg-[#2A190D] px-4 py-1.5 text-xs font-extrabold text-[#FF8F3D]'
                      : 'rounded-full border border-[#292B33] bg-[#15161C] px-4 py-1.5 text-xs font-extrabold text-[#A1A4AE]'
                  }
                >
                  {value}X
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <FieldNotice>
            Activation timestamp: {formatDateTime(settings?.activationTimestamp)} — deposits credited
            before this moment never create obligations. Settings changes are prospective: existing
            obligations keep their snapshotted multiplier and policy version.
          </FieldNotice>
          <ReasonField value={reason} onChange={setReason} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} loading={saving} disabled={Boolean(validationError)}>
              <Save size={16} /> Save settings
            </Button>
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={16} /> Reload
            </Button>
            <Button variant="secondary" onClick={handleReconcile}>
              <ShieldCheck size={16} /> Run reconciliation
            </Button>
          </div>
          {validationError ? <p className="text-xs text-[#F87171]">{validationError}</p> : null}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// 2. USER OVERRIDE
// ------------------------------------------------------------------

function OverridePanel() {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [override, setOverride] = useState<WageringOverride | null>(null);
  const [multiplier, setMultiplier] = useState(2);
  const [reason, setReason] = useState('');
  const [allowed, setAllowed] = useState<number[]>(DEFAULT_ALLOWED);

  useEffect(() => {
    AdminWageringService.getSettings()
      .then((settings) => setAllowed(settings.allowedMultipliers ?? DEFAULT_ALLOWED))
      .catch(() => setAllowed(DEFAULT_ALLOWED));
  }, []);

  const load = async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await AdminWageringService.getOverride(userId.trim());
      setOverride(result);
      if (result) {
        setMultiplier(result.multiplier);
      }
    } catch (loadError) {
      setOverride(null);
      setError(extractWageringErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await AdminWageringService.setOverride(
        userId.trim(),
        multiplier,
        reason.trim(),
      );
      setOverride(saved);
      setReason('');
      setNotice(
        `Override saved. Applies prospectively to obligations created after ${formatDateTime(saved.appliedFrom)} — existing obligations keep their original multiplier.`,
      );
    } catch (saveError) {
      setError(extractWageringErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await AdminWageringService.removeOverride(userId.trim(), reason.trim());
      setOverride(null);
      setReason('');
      setNotice('Override removed. The global default multiplier applies to future deposits.');
    } catch (removeError) {
      setError(extractWageringErrorMessage(removeError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorState title="Wagering error" description={error} /> : null}
      {notice ? (
        <div className="rounded-[12px] border border-[#1E4A32] bg-[#10251A] px-3 py-2 text-sm text-[#4ADE80]">
          {notice}
        </div>
      ) : null}
      <Card className="p-4">
        <h2 className="text-base font-extrabold text-[#F5F5F7]">User multiplier override</h2>
        <p className="mt-1 text-xs text-[#A1A4AE]">
          Applies only to obligations created after the change. Existing obligations keep their
          snapshotted multiplier and policy version. Every change requires a reason and is written
          to the immutable audit log.
        </p>
        <div className="mt-4">
          <UserIdField value={userId} onChange={setUserId} onSubmit={load} loading={loading} />
        </div>

        {override ? (
          <div className="mt-4 rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3 text-xs text-[#A1A4AE]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">{override.multiplier}X active override</Badge>
              {override.previousValue ? (
                <Badge variant="neutral">previous: {override.previousValue}X</Badge>
              ) : null}
            </div>
            <p className="mt-2">Reason: {override.reason}</p>
            <p>Set by: {override.adminId ?? '—'}</p>
            <p>Effective from: {formatDateTime(override.appliedFrom)}</p>
          </div>
        ) : (
          <div className="mt-4">
            <FieldNotice>
              No override for this user — the global default multiplier applies.
            </FieldNotice>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-3">
            <span className="mb-2 block text-sm font-bold text-[#E4E5E8]">New multiplier</span>
            <select
              value={multiplier}
              onChange={(event) => setMultiplier(Number(event.target.value))}
              className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            >
              {(allowed.length > 0 ? allowed : DEFAULT_ALLOWED).map((value) => (
                <option key={value} value={value}>
                  {value}X
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 space-y-3">
          <ReasonField value={reason} onChange={setReason} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSave}
              loading={saving}
              disabled={!userId.trim() || reason.trim().length < 5}
            >
              <UserCog size={16} /> Save override
            </Button>
            {override ? (
              <Button
                variant="danger"
                onClick={handleRemove}
                loading={saving}
                disabled={reason.trim().length < 5}
              >
                <Ban size={16} /> Remove override
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// 3. USER SUMMARY
// ------------------------------------------------------------------

function UserSummaryPanel() {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<WageringUserSummary | null>(null);

  const load = async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await AdminWageringService.getUserSummary(userId.trim());
      setSummary(result);
    } catch (loadError) {
      setSummary(null);
      setError(extractWageringErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorState title="Wagering error" description={error} /> : null}
      <Card className="p-4">
        <h2 className="text-base font-extrabold text-[#F5F5F7]">User wagering summary</h2>
        <div className="mt-4">
          <UserIdField value={userId} onChange={setUserId} onSubmit={load} loading={loading} />
        </div>

        {summary ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{summary.applicableMultiplier}X applies</Badge>
              <Badge variant="neutral">{summary.multiplierSource}</Badge>
              <Badge variant={summary.withdrawalEligible ? 'success' : 'error'}>
                {summary.withdrawalEligible ? 'Withdrawal eligible' : 'Withdrawal restricted'}
              </Badge>
            </div>
            {summary.override ? (
              <FieldNotice>
                Override reason: {summary.override.reason} — set at{' '}
                {formatDateTime(summary.override.appliedFrom)}
              </FieldNotice>
            ) : null}
            <div className="grid gap-2 text-xs text-[#A1A4AE] sm:grid-cols-3">
              <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2">
                <span className="block text-[11px] uppercase tracking-wide">Total required</span>
                <span className="text-sm font-bold text-[#F5F5F7]">
                  {formatWageringDecimal(summary.totalRequired)}
                </span>
              </div>
              <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2">
                <span className="block text-[11px] uppercase tracking-wide">Total completed</span>
                <span className="text-sm font-bold text-[#4ADE80]">
                  {formatWageringDecimal(summary.totalCompleted)}
                </span>
              </div>
              <div className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2">
                <span className="block text-[11px] uppercase tracking-wide">Total remaining</span>
                <span className="text-sm font-bold text-[#FF8F3D]">
                  {formatWageringDecimal(summary.totalRemaining)}
                </span>
              </div>
            </div>
            <p className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2 text-xs text-[#A1A4AE]">
              {summary.ruleExplanation}
            </p>
            {summary.obligations.length === 0 ? (
              <EmptyState title="No wagering obligations for this user." />
            ) : (
              summary.obligations.map((obligation) => (
                <ObligationCard key={obligation.id} obligation={obligation} />
              ))
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}


// ------------------------------------------------------------------
// 4. ACTIVE OBLIGATIONS
// ------------------------------------------------------------------

function ObligationsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WageringObligation[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [filterUserId, setFilterUserId] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<WageringObligation | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await AdminWageringService.listObligations({
        status: statusFilter === 'ACTIVE' ? 'ACTIVE' : undefined,
        userId: filterUserId.trim() || undefined,
        limit: 50,
      });
      setItems(response.items);
      setTotal(response.total);
    } catch (loadError) {
      setError(extractWageringErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, filterUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = async () => {
    if (!cancelTarget || cancelReason.trim().length < 5) return;
    setCancellingId(cancelTarget.id);
    setError(null);
    try {
      await AdminWageringService.cancelObligation(cancelTarget.id, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch (cancelError) {
      setError(extractWageringErrorMessage(cancelError));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorState title="Wagering error" description={error} /> : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#F5F5F7]">Wagering obligations</h2>
            <p className="mt-1 text-xs text-[#A1A4AE]">
              {total} obligation{total === 1 ? '' : 's'} — multipliers and required amounts are
              snapshots and never change after creation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'ACTIVE' | 'ALL')}
              className="h-10 rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            >
              <option value="ACTIVE">ACTIVE only</option>
              <option value="ALL">All statuses</option>
            </select>
            <input
              value={filterUserId}
              onChange={(event) => setFilterUserId(event.target.value)}
              placeholder="Filter by user ID"
              className="h-10 w-[220px] rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            />
            <Button variant="secondary" onClick={load} loading={loading}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <EmptyState title="No obligations match this filter." />
          ) : (
            items.map((obligation) => (
              <ObligationCard
                key={obligation.id}
                obligation={obligation}
                onCancel={(target) => setCancelTarget(target)}
              />
            ))
          )}
        </div>
      </Card>

      {cancelTarget ? (
        <Card className="p-4">
          <h3 className="text-sm font-extrabold text-[#F5F5F7]">
            Cancel obligation {cancelTarget.id}
          </h3>
          <p className="mt-1 text-xs text-[#A1A4AE]">
            Cancelling stops this requirement without touching the user balance or any ledger
            entry. The action is audited with your reason.
          </p>
          <div className="mt-3 space-y-3">
            <ReasonField
              value={cancelReason}
              onChange={setCancelReason}
              label="Cancellation reason (mandatory)"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={handleCancel}
                loading={cancellingId === cancelTarget.id}
                disabled={cancelReason.trim().length < 5}
              >
                <Ban size={16} /> Confirm cancel
              </Button>
              <Button variant="secondary" onClick={() => setCancelTarget(null)}>
                Keep obligation
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}


// ------------------------------------------------------------------
// 5. AUDIT HISTORY
// ------------------------------------------------------------------

function AuditPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WageringAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filterUserId, setFilterUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await AdminWageringService.getAudit({
        userId: filterUserId.trim() || undefined,
        limit: 50,
      });
      setItems(response.items);
      setTotal(response.total);
    } catch (loadError) {
      setError(extractWageringErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [filterUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {error ? <ErrorState title="Wagering error" description={error} /> : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#F5F5F7]">Wagering audit history</h2>
            <p className="mt-1 text-xs text-[#A1A4AE]">
              {total} immutable audit entr{total === 1 ? 'y' : 'ies'} — every admin change with its
              reason, before/after values and policy version.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filterUserId}
              onChange={(event) => setFilterUserId(event.target.value)}
              placeholder="Filter by user ID"
              className="h-10 w-[220px] rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm text-[#F5F5F7]"
            />
            <Button variant="secondary" onClick={load} loading={loading}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : items.length === 0 ? (
            <EmptyState title="No audit entries match this filter." />
          ) : (
            items.map((entry) => (
              <div
                key={entry.id}
                className="rounded-[12px] border border-[#292B33] bg-[#111217] px-3 py-2 text-xs text-[#A1A4AE]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">{entry.action}</Badge>
                    <span className="text-[#E4E5E8]">{entry.targetId ?? '—'}</span>
                  </div>
                  <span>{formatDateTime(entry.createdAt)}</span>
                </div>
                {entry.newValue && typeof entry.newValue === 'object' ? (
                  <p className="mt-1 break-words">
                    {JSON.stringify(entry.newValue)}
                  </p>
                ) : null}
                {entry.adminId ? <p className="mt-1">Admin: {entry.adminId}</p> : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// SCREEN
// ------------------------------------------------------------------

export default function AdminWageringScreen() {
  const [tab, setTab] = useState<TabKey>('settings');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'inline-flex items-center gap-2 rounded-full border border-[#FF7A18] bg-[#2A190D] px-4 py-2 text-xs font-extrabold text-[#FF8F3D]'
                : 'inline-flex items-center gap-2 rounded-full border border-[#292B33] bg-[#15161C] px-4 py-2 text-xs font-extrabold text-[#A1A4AE]'
            }
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'settings' ? <GlobalSettingsPanel /> : null}
      {tab === 'override' ? <OverridePanel /> : null}
      {tab === 'summary' ? <UserSummaryPanel /> : null}
      {tab === 'obligations' ? <ObligationsPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
    </div>
  );
}