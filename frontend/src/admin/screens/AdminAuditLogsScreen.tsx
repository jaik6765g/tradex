// frontend/src/admin/screens/AdminAuditLogsScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, Search } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminAuditLogEntry, AdminAuditLogsQueryParams } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

const ROW_OPTIONS = [10, 20, 50, 100] as const;

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function stringifyJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getResultValue(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const result = metadata.result;
  const status = metadata.status;
  const outcome = metadata.outcome;

  if (typeof result === 'string' && result.trim()) return result.trim().toUpperCase();
  if (typeof status === 'string' && status.trim()) return status.trim().toUpperCase();
  if (typeof outcome === 'string' && outcome.trim()) return outcome.trim().toUpperCase();
  if (typeof metadata.success === 'boolean') return metadata.success ? 'SUCCESS' : 'FAILED';
  if (log.action.toUpperCase().includes('FAILED')) return 'FAILED';

  return 'UNKNOWN';
}

function getResultVariant(result: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = result.toUpperCase();
  if (normalized.includes('SUCCESS') || normalized.includes('OK')) return 'success';
  if (normalized.includes('FAIL') || normalized.includes('ERROR') || normalized.includes('DENIED')) return 'error';
  if (normalized.includes('PENDING')) return 'warning';
  return 'info';
}

function extractRequestId(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const requestId = metadata.requestId ?? metadata.request_id ?? metadata.correlationId;
  return typeof requestId === 'string' && requestId.trim() ? requestId.trim() : '—';
}

function extractWallet(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const wallet = metadata.walletAddress ?? metadata.wallet ?? metadata.adminWallet;
  return typeof wallet === 'string' && wallet.trim() ? wallet.trim() : '—';
}

function extractUser(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const userId = metadata.userId ?? metadata.user_id ?? metadata.targetUserId;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : '—';
}

function extractSource(log: AdminAuditLogEntry): string {
  const metadata = log.metadata as Record<string, unknown>;
  const source = metadata.source ?? metadata.channel;
  if (typeof source === 'string' && source.trim()) return source.trim();
  return log.ipAddress || '—';
}

type AuditFilters = {
  searchInput: string;
  search: string;
  action: string;
  result: string;
  adminId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
};

export default function AdminAuditLogsScreen() {
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<AuditFilters>({
    searchInput: '',
    search: '',
    action: '',
    result: 'ALL',
    adminId: '',
    from: '',
    to: '',
    limit: 20,
    offset: 0,
  });
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogEntry | null>(null);

  const loadAuditLogs = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const query: AdminAuditLogsQueryParams = {
      limit: filters.limit,
      offset: filters.offset,
      action: filters.action || undefined,
      adminId: filters.adminId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };

    try {
      const response = await AdminService.getAdminAuditLogs(query);
      setLogs(response.items);
      setTotal(response.total);
    } catch (loadError) {
      setError(AdminService.getErrorMessage(loadError));
      setLogs([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [filters.action, filters.adminId, filters.from, filters.limit, filters.offset, filters.to]);

  useEffect(() => {
    void loadAuditLogs({ withLoader: true });
  }, [loadAuditLogs]);

  const actionOptions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((log) => {
      if (log.action.trim()) set.add(log.action.trim());
    });
    return ['ALL', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const normalizedSearch = filters.search.trim().toLowerCase();
    return logs.filter((log) => {
      if (filters.result !== 'ALL' && getResultValue(log) !== filters.result) return false;
      if (!normalizedSearch) return true;

      const searchSpace = [
        log.id,
        log.adminId,
        log.action,
        log.targetType,
        log.targetId ?? '',
        extractUser(log),
        extractWallet(log),
        extractSource(log),
        stringifyJson(log.metadata),
      ].join(' ').toLowerCase();

      return searchSpace.includes(normalizedSearch);
    });
  }, [filters.result, filters.search, logs]);

  const rangeStart = total === 0 ? 0 : filters.offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(filters.offset + filters.limit, total);
  const currentPage = Math.floor(filters.offset / filters.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const canGoPrev = filters.offset > 0;
  const canGoNext = filters.offset + filters.limit < total;

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Audit Logs</h1>
            <p className="mt-0.5 text-xs text-[#667085]">
              Review administrative actions, security events, and system activity.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadAuditLogs({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {/* Filters */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.9fr_0.9fr_auto_auto]">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Search</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
                <input
                  type="text"
                  value={filters.searchInput}
                  onChange={(e) => setFilters((prev) => ({ ...prev, searchInput: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setFilters((prev) => ({ ...prev, search: prev.searchInput.trim(), offset: 0 }));
                    }
                  }}
                  placeholder="Event ID, action, resource, user, source..."
                  className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-10 px-4"
                onClick={() => {
                  setFilters((prev) => ({ ...prev, search: prev.searchInput.trim(), offset: 0 }));
                }}
              >
                Search
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Event Type</label>
            <select
              value={filters.action || 'ALL'}
              onChange={(e) => {
                const value = e.target.value;
                setFilters((prev) => ({ ...prev, action: value === 'ALL' ? '' : value, offset: 0 }));
              }}
              className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            >
              {actionOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Result</label>
            <select
              value={filters.result}
              onChange={(e) => setFilters((prev) => ({ ...prev, result: e.target.value }))}
              className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            >
              <option value="ALL">ALL</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Admin</label>
            <input
              type="text"
              value={filters.adminId}
              onChange={(e) => setFilters((prev) => ({ ...prev, adminId: e.target.value, offset: 0 }))}
              placeholder="Admin ID"
              className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Date From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value, offset: 0 }))}
              className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Date To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value, offset: 0 }))}
              className="h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">Rows</label>
            <select
              value={filters.limit}
              onChange={(e) => setFilters((prev) => ({ ...prev, limit: Number(e.target.value), offset: 0 }))}
              className="h-10 rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
            >
              {ROW_OPTIONS.map((option) => (
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
                setFilters({
                  searchInput: '',
                  search: '',
                  action: '',
                  result: 'ALL',
                  adminId: '',
                  from: '',
                  to: '',
                  limit: 20,
                  offset: 0,
                });
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </section>

      {/* Loading */}
      {loading && !logs.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`audit-skeleton-${index}`} className="grid grid-cols-9 gap-2">
                {Array.from({ length: 9 }).map((__, colIndex) => (
                  <Skeleton key={`audit-skeleton-${index}-${colIndex}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState
          title="Unable to load audit logs"
          description={error}
          onRetry={() => void loadAuditLogs({ withLoader: true })}
          retryLabel="Retry"
        />
      )}

      {/* Table */}
      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#344054]">No audit logs found</p>
              <p className="mt-1 text-xs text-[#667085]">Try changing search or filters, then refresh.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 h-8 px-3 text-xs"
                onClick={() => void loadAuditLogs({ withLoader: false })}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1250px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Time</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Admin</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Resource</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">User</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Result</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Source</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {filteredLogs.map((log) => {
                      const result = getResultValue(log);
                      return (
                        <tr key={log.id} className="align-top transition-colors hover:bg-[#F8FAFC]">
                          <td className="px-3 py-2 text-xs text-[#111827]">{formatDateTime(log.createdAt)}</td>
                          <td className="px-3 py-2 text-xs text-[#111827] font-mono">{log.adminId}</td>
                          <td className="px-3 py-2 text-xs text-[#111827] font-semibold">{log.action}</td>
                          <td className="px-3 py-2 text-xs text-[#111827]">
                            <p>{log.targetType}</p>
                            <p className="mt-1 text-[10px] font-mono text-[#667085]">{log.targetId || '—'}</p>
                          </td>
                          <td className="px-3 py-2 text-xs text-[#111827]">
                            <p>{extractUser(log)}</p>
                            <p className="mt-1 text-[10px] font-mono text-[#667085]">{extractWallet(log)}</p>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <Badge variant={getResultVariant(result)}>{result}</Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-[#111827]">{extractSource(log)}</td>
                          <td className="px-3 py-2 text-xs text-[#111827]">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setSelectedLog(log)}
                            >
                              <Eye size={12} className="mr-1" />
                              View
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EAECF0] px-3 py-2.5">
                <p className="text-xs text-[#667085]">
                  Showing <span className="font-bold text-[#111827]">{rangeStart}-{rangeEnd}</span> of{' '}
                  <span className="font-bold text-[#111827]">{total}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canGoPrev}
                    onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#344054]">Page {currentPage} of {totalPages}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canGoNext}
                    onClick={() => setFilters((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-4xl rounded-[16px] border border-[#E5E7EB] bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-[#111827]">Audit Log Details</h2>
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setSelectedLog(null)}>
                Close
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs text-[#344054] sm:grid-cols-2">
              <p><span className="text-[#667085]">Event ID:</span> <span className="font-mono text-[#111827]">{selectedLog.id}</span></p>
              <p><span className="text-[#667085]">Timestamp:</span> <span className="font-semibold text-[#111827]">{formatDateTime(selectedLog.createdAt)}</span></p>
              <p><span className="text-[#667085]">Admin ID:</span> <span className="font-mono text-[#111827]">{selectedLog.adminId}</span></p>
              <p><span className="text-[#667085]">Admin Wallet:</span> <span className="font-mono text-[#111827]">{extractWallet(selectedLog)}</span></p>
              <p><span className="text-[#667085]">Action:</span> <span className="font-semibold text-[#111827]">{selectedLog.action}</span></p>
              <p><span className="text-[#667085]">Resource Type:</span> <span className="font-semibold text-[#111827]">{selectedLog.targetType}</span></p>
              <p><span className="text-[#667085]">Resource ID:</span> <span className="font-mono text-[#111827]">{selectedLog.targetId || '—'}</span></p>
              <p><span className="text-[#667085]">User:</span> <span className="font-mono text-[#111827]">{extractUser(selectedLog)}</span></p>
              <p><span className="text-[#667085]">Wallet:</span> <span className="font-mono text-[#111827]">{extractWallet(selectedLog)}</span></p>
              <p><span className="text-[#667085]">Result:</span> <Badge variant={getResultVariant(getResultValue(selectedLog))}>{getResultValue(selectedLog)}</Badge></p>
              <p><span className="text-[#667085]">Source:</span> <span className="font-semibold text-[#111827]">{extractSource(selectedLog)}</span></p>
              <p><span className="text-[#667085]">Request ID:</span> <span className="font-mono text-[#111827]">{extractRequestId(selectedLog)}</span></p>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Before</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] text-[#111827]">
                  {stringifyJson(selectedLog.oldValue)}
                </pre>
              </div>
              <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">After</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] text-[#111827]">
                  {stringifyJson(selectedLog.newValue)}
                </pre>
              </div>
              <div className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Metadata</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] text-[#111827]">
                  {stringifyJson(selectedLog.metadata)}
                </pre>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-[#667085]">Audit records are read-only and cannot be edited or deleted.</p>
          </div>
        </div>
      )}
    </div>
  );
}