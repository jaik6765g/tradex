// frontend/src/admin/screens/AdminBotSettingsScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, RefreshCw, X } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { BotSettings, UpdateBotSettingsPayload } from '../types/admin.types';
import { Button, ErrorState, Skeleton } from '../../components/ui';

// ============================================================
// ✅ FIXED: 2 Decimal Places
// ============================================================

const RATE_SCALE = 2;

function toScaledBigInt(value: string, scale: number): bigint | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const [intPart = '0', fracPart = ''] = trimmed.split('.');
  const frac = fracPart.slice(0, scale).padEnd(scale, '0');
  try {
    return BigInt(`${intPart}${frac}`);
  } catch {
    return null;
  }
}

function formatRateDisplay(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const LEVEL_RATE_FIELDS = [
  { key: 'firstReferralLevel1Rate', label: 'L1' },
  { key: 'firstReferralLevel2Rate', label: 'L2' },
  { key: 'firstReferralLevel3Rate', label: 'L3' },
  { key: 'firstReferralLevel4Rate', label: 'L4' },
  { key: 'firstReferralLevel5Rate', label: 'L5' },
  { key: 'firstReferralLevel6Rate', label: 'L6' },
] as const;

const LEVEL_DIRECT_FIELDS = [
  { key: 'firstReferralLevel1DirectRequired', label: 'L1' },
  { key: 'firstReferralLevel2DirectRequired', label: 'L2' },
  { key: 'firstReferralLevel3DirectRequired', label: 'L3' },
  { key: 'firstReferralLevel4DirectRequired', label: 'L4' },
  { key: 'firstReferralLevel5DirectRequired', label: 'L5' },
  { key: 'firstReferralLevel6DirectRequired', label: 'L6' },
] as const;

type FormState = Record<string, string>;

function settingsToForm(settings: BotSettings): FormState {
  return {
    minimumActivation: settings.minimumActivation,
    maximumActivation: settings.maximumActivation,
    liquidityAllocationRate: settings.liquidityAllocationRate,
    firstReferralRate: settings.firstReferralRate,
    firstReferralLevel1Rate: settings.firstReferralLevel1Rate,
    firstReferralLevel2Rate: settings.firstReferralLevel2Rate,
    firstReferralLevel3Rate: settings.firstReferralLevel3Rate,
    firstReferralLevel4Rate: settings.firstReferralLevel4Rate,
    firstReferralLevel5Rate: settings.firstReferralLevel5Rate,
    firstReferralLevel6Rate: settings.firstReferralLevel6Rate,
    firstReferralLevel1DirectRequired: String(
      settings.firstReferralLevel1DirectRequired,
    ),
    firstReferralLevel2DirectRequired: String(
      settings.firstReferralLevel2DirectRequired,
    ),
    firstReferralLevel3DirectRequired: String(
      settings.firstReferralLevel3DirectRequired,
    ),
    firstReferralLevel4DirectRequired: String(
      settings.firstReferralLevel4DirectRequired,
    ),
    firstReferralLevel5DirectRequired: String(
      settings.firstReferralLevel5DirectRequired,
    ),
    firstReferralLevel6DirectRequired: String(
      settings.firstReferralLevel6DirectRequired,
    ),
  };
}

// ============================================================
// UI HELPERS
// ============================================================

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <h2 className="text-sm font-black text-[#F5F5F7]">{title}</h2>
      <p className="mt-0.5 text-xs text-[#A1A4AE]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ✅ FIXED: Simplified Field Component - No Strict Validation
function Field({
  label,
  suffix,
  value,
  onChange,
  invalid,
  placeholder = '0.00',
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A1A4AE]">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`h-10 w-full rounded-[10px] border bg-[#15161C] px-3 text-sm font-bold text-[#F5F5F7] outline-none transition focus:ring-2 ${
            invalid
              ? 'border-[#D92D20] focus:ring-[#4A2323]'
              : 'border-[#34343E] focus:ring-[#1E3A5F]'
          }`}
        />
        <span className="min-w-[42px] text-xs font-black text-[#A1A4AE]">
          {suffix}
        </span>
      </div>
    </label>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function AdminBotSettingsScreen() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async (withLoader: boolean) => {
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await AdminService.getBotSettings();
      setSettings(result);
      setForm(settingsToForm(result));
      setSuccessMessage(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load bot settings',
      );
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings(true);
  }, [loadSettings]);

  const updateField = useCallback((key: string, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSuccessMessage(null);
  }, []);

  // ✅ Allocation validation with tolerance
  const allocationValid = useMemo(() => {
    if (!form) return false;
    const liquidity = parseFloat(form.liquidityAllocationRate);
    const referral = parseFloat(form.firstReferralRate);
    if (!Number.isFinite(liquidity) || !Number.isFinite(referral)) return false;
    return Math.abs((liquidity + referral) - 100) < 0.01;
  }, [form]);

  const levelRateSum = useMemo(() => {
    if (!form) return null;
    let sum = BigInt(0);
    for (const field of LEVEL_RATE_FIELDS) {
      const scaled = toScaledBigInt(form[field.key], RATE_SCALE);
      if (scaled === null) return null;
      sum += scaled;
    }
    return sum;
  }, [form]);

  const firstReferralRateScaled = useMemo(() => {
    if (!form) return null;
    return toScaledBigInt(form.firstReferralRate, RATE_SCALE);
  }, [form]);

  const referralRatesValid = useMemo(() => {
    if (levelRateSum === null || firstReferralRateScaled === null) return false;
    return levelRateSum === firstReferralRateScaled;
  }, [levelRateSum, firstReferralRateScaled]);

  const qualificationValid = useMemo(() => {
    if (!form) return false;
    let prev = 0;
    for (const field of LEVEL_DIRECT_FIELDS) {
      const value = Number(form[field.key]);
      if (!Number.isInteger(value) || value < 1) return false;
      if (value < prev) return false;
      prev = value;
    }
    return true;
  }, [form]);

  const formValid = allocationValid && referralRatesValid && qualificationValid;

  const hasChanges = useMemo(() => {
    if (!settings || !form) return false;
    const original = settingsToForm(settings);
    return Object.keys(original).some((key) => original[key] !== form[key]);
  }, [settings, form]);

  const handleSave = useCallback(async () => {
    if (!form || !formValid) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const payload: UpdateBotSettingsPayload = {
        minimumActivation: form.minimumActivation,
        maximumActivation: form.maximumActivation,
        liquidityAllocationRate: form.liquidityAllocationRate,
        firstReferralRate: form.firstReferralRate,
        firstReferralLevel1Rate: form.firstReferralLevel1Rate,
        firstReferralLevel2Rate: form.firstReferralLevel2Rate,
        firstReferralLevel3Rate: form.firstReferralLevel3Rate,
        firstReferralLevel4Rate: form.firstReferralLevel4Rate,
        firstReferralLevel5Rate: form.firstReferralLevel5Rate,
        firstReferralLevel6Rate: form.firstReferralLevel6Rate,
        firstReferralLevel1DirectRequired: Number(
          form.firstReferralLevel1DirectRequired,
        ),
        firstReferralLevel2DirectRequired: Number(
          form.firstReferralLevel2DirectRequired,
        ),
        firstReferralLevel3DirectRequired: Number(
          form.firstReferralLevel3DirectRequired,
        ),
        firstReferralLevel4DirectRequired: Number(
          form.firstReferralLevel4DirectRequired,
        ),
        firstReferralLevel5DirectRequired: Number(
          form.firstReferralLevel5DirectRequired,
        ),
        firstReferralLevel6DirectRequired: Number(
          form.firstReferralLevel6DirectRequired,
        ),
      };

      const result = await AdminService.updateBotSettings(payload);
      setSettings(result);
      setForm(settingsToForm(result));
      setSuccessMessage('Bot settings saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bot settings');
    } finally {
      setSaving(false);
    }
  }, [form, formValid]);

  if (loading && !settings) {
    return (
      <div className="space-y-3">
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <Skeleton className="h-5 w-48" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <ErrorState
        title="Unable to load bot settings"
        description={error}
        onRetry={() => void loadSettings(true)}
      />
    );
  }

  if (!settings || !form) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#292B33] bg-[#15161C]">
              <Bot size={18} className="text-[#E4E5E8]" />
            </div>
            <div>
              <h1 className="text-[18px] font-black text-[#F5F5F7]">
                Bot Settings
              </h1>
              <p className="text-xs text-[#A1A4AE]">
                Activation limits, first-activation allocation, referral rates
                and qualification
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadSettings(false)}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {/* Feedback */}
      {error && (
        <div className="rounded-[12px] border border-[#4A2323] bg-[#281313] px-4 py-3 text-sm font-bold text-[#F87171]">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-[12px] border border-[#1E4A32] bg-[#10251A] px-4 py-3 text-sm font-bold text-[#4ADE80]">
          {successMessage}
        </div>
      )}

      {/* Activation Settings */}
      <Section
        title="Bot Activation Settings"
        description="Minimum and maximum TDX amount a user can activate."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Minimum Activation"
            suffix="TDX"
            value={form.minimumActivation}
            onChange={(v) => updateField('minimumActivation', v)}
            invalid={!toScaledBigInt(form.minimumActivation, 18)}
            placeholder="10000"
          />
          <Field
            label="Maximum Activation"
            suffix="TDX"
            value={form.maximumActivation}
            onChange={(v) => updateField('maximumActivation', v)}
            invalid={!toScaledBigInt(form.maximumActivation, 18)}
            placeholder="1000000"
          />
        </div>
      </Section>

      {/* ✅ First Activation Allocation - 2 Decimal Places */}
      <Section
        title="First Activation Allocation"
        description="How the activation amount is split between liquidity and the first-activation referral reserve. Must total 100%."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Liquidity Allocation"
            suffix="%"
            value={form.liquidityAllocationRate}
            onChange={(v) => updateField('liquidityAllocationRate', v)}
            invalid={!allocationValid}
            placeholder="90.00"
          />
          <Field
            label="Referral Reserve"
            suffix="%"
            value={form.firstReferralRate}
            onChange={(v) => updateField('firstReferralRate', v)}
            invalid={!allocationValid}
            placeholder="10.00"
          />
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs font-bold">
          {allocationValid ? (
            <span className="inline-flex items-center gap-1 text-[#4ADE80]">
              <Check size={14} /> Valid — allocation totals 100%
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#F87171]">
              <X size={14} /> Liquidity + Referral Reserve must total 100%
            </span>
          )}
        </div>
        <div className="mt-2 text-[10px] text-[#A1A4AE]">
          Current total:{' '}
          {form
            ? (parseFloat(form.liquidityAllocationRate) + parseFloat(form.firstReferralRate)).toFixed(2)
            : '—'}
          %
        </div>
      </Section>

      {/* ✅ Referral Rates - 2 Decimal Places */}
      <Section
        title="First Activation Referral Rates"
        description="Percentage of the activation amount paid to each referral level. L1-L6 must total the Referral Reserve."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LEVEL_RATE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              suffix="%"
              value={form[field.key]}
              onChange={(v) => updateField(field.key, v)}
              invalid={!referralRatesValid}
              placeholder="0.00"
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#202229] bg-[#15161C] px-3 py-2">
          <p className="text-xs font-bold text-[#E4E5E8]">
            Total Referral Rate:{' '}
            <span className="text-[#F5F5F7]">
              {levelRateSum !== null
                ? `${(Number(levelRateSum) / 10 ** RATE_SCALE).toFixed(2)}%`
                : '—'}
            </span>
          </p>
          {referralRatesValid ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#4ADE80]">
              <Check size={14} /> Valid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#F87171]">
              <X size={14} /> Referral rates must total{' '}
              {formatRateDisplay(form.firstReferralRate)}%
            </span>
          )}
        </div>
      </Section>

      {/* Referral Qualification */}
      <Section
        title="Referral Qualification"
        description="Active direct Bots a recipient must have to qualify for each level. Evaluated independently per recipient."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LEVEL_DIRECT_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              suffix="direct"
              value={form[field.key]}
              onChange={(v) => updateField(field.key, v)}
              invalid={!qualificationValid}
              placeholder="1"
            />
          ))}
        </div>

        <div className="mt-4 rounded-[12px] border border-[#202229] bg-[#15161C] p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#A1A4AE]">
            Qualification Table
          </p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((count) => {
              const unlocked = [1, 2, 3, 4, 5, 6].filter(
                (level) =>
                  count >=
                  Number(form[`firstReferralLevel${level}DirectRequired`]),
              );
              return (
                <div
                  key={count}
                  className="flex items-center justify-between rounded-[8px] border border-[#202229] bg-[#15161C] px-2.5 py-1.5"
                >
                  <span className="text-xs font-bold text-[#E4E5E8]">
                    {count} Active Direct{count === 1 ? '' : 's'}
                  </span>
                  <span className="text-xs font-black text-[#F5F5F7]">
                    {unlocked.length === 0
                      ? 'None'
                      : unlocked.length === 6
                        ? 'L1-L6'
                        : `L1-L${unlocked.length}`}
                  </span>
                </div>
              );
            })}
          </div>
          {!qualificationValid && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#F87171]">
              <X size={14} /> Qualification thresholds must be {'>= 1'} and
              non-decreasing (L2 {'>='} L1, L3 {'>='} L2, ...)
            </p>
          )}
        </div>
      </Section>

      {/* Save */}
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#E4E5E8]">
              {hasChanges ? 'You have unsaved changes' : 'All changes saved'}
            </p>
            <p className="text-[11px] text-[#A1A4AE]">
              Last updated:{' '}
              {settings.updatedAt
                ? new Date(settings.updatedAt).toLocaleString()
                : '—'}
            </p>
          </div>
          <Button
            size="md"
            className="h-10 px-5 text-sm"
            loading={saving}
            disabled={!formValid || !hasChanges}
            onClick={() => void handleSave()}
          >
            Save Bot Settings
          </Button>
        </div>
      </section>
    </div>
  );
}