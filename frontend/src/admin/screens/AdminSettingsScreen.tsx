// frontend/src/admin/screens/AdminSettingsScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, Save, Search } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type {
  AdminSettingItem,
  AdminSettingValueType,
  UpdateAdminSettingPayload,
} from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

type SettingsState = {
  items: AdminSettingItem[];
  total: number;
  limit: number;
  offset: number;
};

type SectionKey =
  | 'platform'
  | 'pulseTrade'
  | 'fees'
  | 'deposits'
  | 'withdrawals'
  | 'liquidity'
  | 'risk'
  | 'referral'
  | 'security'
  | 'adminAccess';

const SECTION_DEFINITIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'platform', label: 'Platform' },
  { key: 'pulseTrade', label: 'Pulse Trade' },
  { key: 'fees', label: 'Fees' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'risk', label: 'Risk' },
  { key: 'referral', label: 'Referral' },
  { key: 'security', label: 'Security' },
  { key: 'adminAccess', label: 'Admin Access' },
];

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function stringifyValue(value: string | number | boolean | Record<string, unknown> | unknown[], valueType: AdminSettingValueType): string {
  if (valueType === 'json') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function detectSection(settingKey: string): SectionKey {
  const normalized = settingKey.trim().toLowerCase();
  if (normalized.startsWith('pulse') || normalized.startsWith('trade')) return 'pulseTrade';
  if (normalized.startsWith('fee')) return 'fees';
  if (normalized.startsWith('deposit') || normalized.includes('deposit')) return 'deposits';
  if (normalized.startsWith('withdraw') || normalized.includes('withdraw')) return 'withdrawals';
  if (normalized.startsWith('liquidity')) return 'liquidity';
  if (normalized.startsWith('risk')) return 'risk';
  if (normalized.startsWith('referral')) return 'referral';
  if (normalized.startsWith('security')) return 'security';
  if (normalized.startsWith('admin')) return 'adminAccess';
  return 'platform';
}

function isSensitiveSetting(setting: AdminSettingItem): boolean {
  const normalized = setting.key.toLowerCase();
  return normalized.includes('security') || normalized.includes('risk') ||
    normalized.includes('withdraw') || normalized.includes('deposit') ||
    normalized.includes('liquidity') || normalized.includes('admin') ||
    normalized.includes('fee');
}

function getValueTypeBadgeVariant(type: AdminSettingValueType): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (type === 'boolean') return 'info';
  if (type === 'number') return 'warning';
  if (type === 'json') return 'neutral';
  return 'success';
}

export default function AdminSettingsScreen() {
  const [settingsState, setSettingsState] = useState<SettingsState>({
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<{
    setting: AdminSettingItem;
    value: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<{
    setting: AdminSettingItem;
    payload: UpdateAdminSettingPayload;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmReason, setConfirmReason] = useState('');

  const loadSettings = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const response = await AdminService.getAdminSettings({
        limit: settingsState.limit,
        offset: settingsState.offset,
        search: search || undefined,
      });

      setSettingsState({
        items: response.items,
        total: response.total,
        limit: response.limit,
        offset: response.offset,
      });
    } catch (loadError) {
      setError(AdminService.getErrorMessage(loadError));
      setSettingsState((prev) => ({ ...prev, items: [], total: 0 }));
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [search, settingsState.limit, settingsState.offset]);

  useEffect(() => {
    void loadSettings({ withLoader: true });
  }, [loadSettings]);

  const groupedSettings = useMemo(() => {
    const groups: Record<SectionKey, AdminSettingItem[]> = {
      platform: [], pulseTrade: [], fees: [], deposits: [],
      withdrawals: [], liquidity: [], risk: [], referral: [],
      security: [], adminAccess: [],
    };
    settingsState.items.forEach((item) => {
      groups[detectSection(item.key)].push(item);
    });
    return groups;
  }, [settingsState.items]);

  const rangeStart = settingsState.total === 0 ? 0 : settingsState.offset + 1;
  const rangeEnd = settingsState.total === 0 ? 0 : Math.min(settingsState.offset + settingsState.limit, settingsState.total);
  const currentPage = Math.floor(settingsState.offset / settingsState.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(settingsState.total / settingsState.limit));
  const canGoPrev = settingsState.offset > 0;
  const canGoNext = settingsState.offset + settingsState.limit < settingsState.total;

  const beginEdit = useCallback((setting: AdminSettingItem) => {
    setEditing({
      setting,
      value: stringifyValue(setting.parsedValue, setting.valueType),
    });
  }, []);

  const submitEdit = useCallback(() => {
    if (!editing) return;
    const payload: UpdateAdminSettingPayload = {
      value: editing.value,
      valueType: editing.setting.valueType,
      // reason is captured in the confirm modal and attached there.
      reason: '',
    };
    setConfirmReason('');
    setConfirming({ setting: editing.setting, payload });
  }, [editing]);

  const executeUpdate = useCallback(async () => {
    if (!confirming) return;
    const trimmedReason = confirmReason.trim();
    if (!trimmedReason) {
      setFeedback({ type: 'error', message: 'A reason is required for every setting change' });
      return;
    }
    setSaving(true);
    try {
      await AdminService.updateAdminSetting(confirming.setting.key, {
        ...confirming.payload,
        reason: trimmedReason,
      });
      setFeedback({ type: 'success', message: `Updated ${confirming.setting.key} successfully` });
      setEditing(null);
      setConfirming(null);
      setConfirmReason('');
      await loadSettings({ withLoader: false });
    } catch (updateError) {
      setFeedback({ type: 'error', message: AdminService.getErrorMessage(updateError) });
    } finally {
      setSaving(false);
    }
  }, [confirming, confirmReason, loadSettings]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Settings</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">
              Manage backend-persisted admin settings only. Changes are validated and audit logged.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadSettings({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {feedback && (
        <section className={`rounded-[12px] border px-3 py-2.5 ${
          feedback.type === 'success'
            ? 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]'
            : 'border-[#4A2323] bg-[#281313] text-[#F87171]'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">{feedback.message}</p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setFeedback(null)}>
              Dismiss
            </Button>
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto]">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Search</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#70737E]" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setSettingsState((prev) => ({ ...prev, offset: 0 }));
                      setSearch(searchInput.trim());
                    }
                  }}
                  placeholder="Search key, description, or value..."
                  className="h-10 w-full rounded-[10px] border border-[#34343E] bg-[#15161C] pl-9 pr-3 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-10 px-4"
                onClick={() => {
                  setSettingsState((prev) => ({ ...prev, offset: 0 }));
                  setSearch(searchInput.trim());
                }}
              >
                Search
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Rows</label>
            <select
              value={settingsState.limit}
              onChange={(e) => {
                setSettingsState((prev) => ({
                  ...prev,
                  limit: Number(e.target.value),
                  offset: 0,
                }));
              }}
              className="h-10 rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 text-sm font-semibold text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
            >
              {[20, 50, 100].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 px-3 text-xs"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setSettingsState((prev) => ({ ...prev, limit: 50, offset: 0 }));
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {Array.from({ length: SECTION_DEFINITIONS.length }).map((_, index) => (
            <div key={`setting-section-skeleton-${index}`} className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
              <Skeleton className="h-5 w-40" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((__, rowIndex) => (
                  <Skeleton key={`setting-row-skeleton-${index}-${rowIndex}`} className="h-10 w-full" />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!loading && error && (
        <ErrorState
          title="Unable to load settings"
          description={error}
          onRetry={() => void loadSettings({ withLoader: true })}
          retryLabel="Retry"
        />
      )}

      {!loading && !error && (
        <section className="space-y-3">
          <div className="rounded-[12px] border border-[#292B33] bg-[#15161C] px-3 py-2 text-xs text-[#A1A4AE]">
            Showing <span className="font-bold text-[#F5F5F7]">{rangeStart}-{rangeEnd}</span> of{' '}
            <span className="font-bold text-[#F5F5F7]">{settingsState.total}</span> settings
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {SECTION_DEFINITIONS.map((section) => {
              const sectionItems = groupedSettings[section.key];
              return (
                <article key={section.key} className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
                  <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#A1A4AE]">{section.label}</h2>

                  {sectionItems.length === 0 ? (
                    <div className="mt-3 rounded-[12px] border border-dashed border-[#34343E] bg-[#15161C] p-3 text-xs text-[#A1A4AE]">
                      No backend-persisted settings in this category.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {sectionItems.map((setting) => (
                        <div key={setting.id} className="rounded-[12px] border border-[#202229] bg-[#15161C] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-black text-[#F5F5F7] break-all">{setting.key}</p>
                              {setting.description && (
                                <p className="mt-1 text-[11px] text-[#A1A4AE]">{setting.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={getValueTypeBadgeVariant(setting.valueType)}>
                                {setting.valueType}
                              </Badge>
                              <Badge variant={setting.editable ? 'success' : 'neutral'}>
                                {setting.editable ? 'Editable' : 'Locked'}
                              </Badge>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                disabled={!setting.editable}
                                onClick={() => beginEdit(setting)}
                              >
                                <Pencil size={11} className="mr-1" />
                                Edit
                              </Button>
                            </div>
                          </div>
                          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[#202229] bg-[#15161C] p-2 text-[11px] text-[#F5F5F7]">
                            {stringifyValue(setting.parsedValue, setting.valueType)}
                          </pre>
                          <p className="mt-2 text-[10px] text-[#A1A4AE]">
                            Updated: <span className="font-semibold text-[#F5F5F7]">{formatDateTime(setting.updatedAt)}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={!canGoPrev}
                onClick={() => setSettingsState((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
              >
                Previous
              </Button>
              <span className="text-xs font-semibold text-[#E4E5E8]">Page {currentPage} of {totalPages}</span>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={!canGoNext}
                onClick={() => setSettingsState((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-2xl rounded-[16px] border border-[#292B33] bg-[#15161C] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-[#F5F5F7]">Edit Setting</h2>
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditing(null)}>
                Close
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-[#A1A4AE]">
                <span className="font-bold text-[#F5F5F7]">{editing.setting.key}</span> ({editing.setting.valueType})
              </p>
              <textarea
                value={editing.value}
                onChange={(e) => setEditing((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                className="min-h-[220px] w-full rounded-[10px] border border-[#34343E] bg-[#15161C] p-3 text-xs text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
              />
              <p className="text-[11px] text-[#A1A4AE]">
                This setting is persisted through frontend → AdminService → backend validation/service → database.
              </p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" className="h-8 px-3 text-xs" onClick={submitEdit}>
                <Save size={12} className="mr-1" />
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-lg rounded-[16px] border border-[#292B33] bg-[#15161C] p-4 shadow-xl">
            <h2 className="text-base font-black text-[#F5F5F7]">Confirm Setting Change</h2>
            <p className="mt-2 text-xs text-[#A1A4AE]">
              You are about to update <span className="font-bold text-[#F5F5F7]">{confirming.setting.key}</span>.
              {isSensitiveSetting(confirming.setting) && ' This is a sensitive setting and should be reviewed carefully before applying.'}
            </p>
            <div className="mt-3 rounded-[10px] border border-[#202229] bg-[#15161C] p-3 text-[11px] text-[#F5F5F7]">
              <p><span className="font-semibold">Value Type:</span> {confirming.payload.valueType}</p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-[#15161C] p-2 text-[11px] text-[#F5F5F7]">
                {confirming.payload.value}
              </pre>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">
                Reason <span className="text-[#F87171]">*</span>
              </label>
              <textarea
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                placeholder="Mandatory — recorded in the immutable audit log"
                className="min-h-[64px] w-full rounded-[10px] border border-[#34343E] bg-[#15161C] p-2.5 text-xs text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
              />
              {!confirmReason.trim() && (
                <p className="mt-1 text-[10px] text-[#F87171]">A reason is required before this change can be applied.</p>
              )}
            </div>
            <p className="mt-3 text-[11px] text-[#A1A4AE]">
              On success, settings data will refresh and backend will create an audit record for this update.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" disabled={saving} onClick={() => { setConfirming(null); setConfirmReason(''); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-3 text-xs"
                loading={saving}
                disabled={!confirmReason.trim()}
                onClick={() => void executeUpdate()}
              >
                Confirm Update
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}