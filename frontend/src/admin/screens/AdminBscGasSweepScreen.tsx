// frontend/src/admin/screens/AdminBscGasSweepScreen.tsx (part 1)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, Fuel, Zap } from 'lucide-react';
import { BscGasService, type BscGasRow, type BscBatchPreview } from '../services/bscGas.service';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

type StatusFilter = 'ALL' | BscGasRow['opStatus'];

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  NO_USDT: 'neutral', READY: 'success', GAS_REQUIRED: 'warning',
  SWEEPING: 'info', COMPLETED: 'success', MANUAL_REVIEW: 'error',
};

function short(addr: string): string {
  if (!addr) return '—';
  return addr.length <= 12 ? addr : addr.slice(0, 6) + '...' + addr.slice(-4);
}

export default function AdminBscGasSweepScreen() {
  const [rows, setRows] = useState<BscGasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<BscBatchPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sweepConfirm, setSweepConfirm] = useState<BscGasRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [treasury, setTreasury] = useState('');
  const [gasWallet, setGasWallet] = useState<{ address: string | null; configured: boolean }>({ address: null, configured: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await BscGasService.list();
      setRows(res.rows);
      setTreasury(res.treasury);
      setGasWallet(res.gasWallet);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load BSC gas dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.opStatus === filter)),
    [rows, filter],
  );

  const toggleOne = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const openPreview = async (addresses: string[]) => {
    setBusy(true);
    setNotice(null);
    try {
      const p = await BscGasService.preview(addresses);
      setPreview(p);
      setPreviewOpen(true);
    } catch (e: any) {
      setNotice('Preview failed: ' + (e?.response?.data?.message ?? e?.message ?? 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const confirmSend = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const addrs = preview.eligible.map((e) => e.address);
      await BscGasService.send(addrs, preview.idempotencyKey);
      setNotice('BNB batch broadcast. Tracking confirmations — rows will refresh.');
      setPreviewOpen(false);
      setPreview(null);
      setSelected([]);
      await load();
    } catch (e: any) {
      setNotice('Batch send failed: ' + (e?.response?.data?.message ?? e?.message ?? 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const confirmSweep = async () => {
    if (!sweepConfirm) return;
    setBusy(true);
    try {
      await BscGasService.sweepAddress(sweepConfirm.depositAddressId);
      setNotice('Sweep requested for ' + short(sweepConfirm.depositAddress) + '. Status polled, never assumed.');
      setSweepConfirm(null);
      await load();
    } catch (e: any) {
      setNotice('Sweep failed: ' + (e?.response?.data?.message ?? e?.message ?? 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const bulkSweep = async () => {
    const ids = selected.filter((id) => rows.find((r) => r.depositAddressId === id)?.eligibleForSweep);
    if (ids.length === 0) {
      setNotice('No READY rows selected for sweep.');
      return;
    }
    setBusy(true);
    try {
      await BscGasService.bulkSweep(ids);
      setNotice('Bulk sweep requested for ' + ids.length + ' address(es). Each sweep is independent.');
      setSelected([]);
      await load();
    } catch (e: any) {
      setNotice('Bulk sweep failed: ' + (e?.response?.data?.message ?? e?.message ?? 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const token = localStorage.getItem('token') ?? '';
    fetch(BscGasService.exportUrl(), { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Export failed: ' + r.status);
        return r.blob();
      })
      .then((b) => {
        const url = URL.createObjectURL(b);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'bsc-gas-sweep.csv';
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setNotice('Export failed: ' + (e?.message ?? 'unknown')));
  };
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState title="BSC Gas & Sweep unavailable" description={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-3">
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-[#F5F5F7]">BSC Gas &amp; Sweep — manual control</h2>
            <p className="text-xs text-[#A1A4AE]">
              BSC / 56 · Treasury {short(treasury)} · Gas wallet {gasWallet.configured ? short(gasWallet.address ?? '') + ' (server-side)' : 'NOT CONFIGURED'} · No auto top-up · No auto sweep
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
              className="h-8 rounded-[8px] border border-[#292B33] bg-[#111217] px-2 text-xs text-[#F5F5F7]"
            >
              {(['ALL', 'NO_USDT', 'READY', 'GAS_REQUIRED', 'SWEEPING', 'COMPLETED', 'MANUAL_REVIEW'] as StatusFilter[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Button variant="secondary" size="sm" onClick={exportCsv}><Download size={14} className="mr-1" /> CSV</Button>
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" /> Refresh</Button>
            <Button variant="primary" size="sm" disabled={busy || selected.length === 0} onClick={bulkSweep}>
              <Zap size={14} className="mr-1" /> Sweep selected
            </Button>
          </div>
        </div>
        {notice && <p className="mt-2 text-xs text-[#E8B931]">{notice}</p>}
      </section>

      <section className="overflow-x-auto rounded-[16px] border border-[#292B33] bg-[#15161C]">
        <table className="w-full min-w-[1240px] divide-y divide-[#202229]">
          <thead>
            <tr>
              {['', 'User', 'Deposit address', 'USDT', 'BNB', 'Required', 'Shortfall', 'Top-up', 'Sweep', 'Status', 'Actions'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1B1917]">
            {filtered.map((r) => (
              <tr key={r.depositAddressId} className="hover:bg-[#1A1A22]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.depositAddressId)}
                    onChange={() => toggleOne(r.depositAddressId)}
                    disabled={!r.eligibleForSweep && !r.eligibleForTopUp}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-[#E4E5E8]">
                  <div className="max-w-[180px] truncate" title={r.userEmail ?? r.userMobile ?? ''}>{r.userEmail ?? r.userMobile ?? '—'}</div>
                  <div className="text-[10px] text-[#70737E]">idx {r.derivationIndex ?? '—'} · gen {r.custodyGeneration}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[#F5F5F7]" title={r.depositAddress}>{short(r.depositAddress)}</td>
                <td className="px-3 py-2 text-xs text-[#F5F5F7]">{r.usdtBalance}</td>
                <td className="px-3 py-2 text-xs text-[#F5F5F7]">{r.bnbBalance}</td>
                <td className="px-3 py-2 text-xs text-[#E4E5E8]">{r.requiredGasBnb}</td>
                <td className="px-3 py-2 text-xs text-[#E8B931]">{r.gasShortfallBnb}</td>
                <td className="px-3 py-2 text-xs text-[#12B76A]">{r.recommendedBnb}</td>
                <td className="px-3 py-2 text-xs text-[#E4E5E8]">{r.sweepStatus ?? '—'}</td>
                <td className="px-3 py-2"><Badge variant={STATUS_VARIANT[r.opStatus] ?? 'neutral'}>{r.opStatus}</Badge></td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {r.opStatus === 'GAS_REQUIRED' && (
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openPreview([r.depositAddress])}>
                        <Fuel size={13} className="mr-1" /> Top-up BNB
                      </Button>
                    )}
                    {r.opStatus === 'READY' && (
                      <Button variant="primary" size="sm" disabled={busy} onClick={() => setSweepConfirm(r)}>
                        <Zap size={13} className="mr-1" /> Sweep
                      </Button>
                    )}
                    {['SWEEPING', 'MANUAL_REVIEW', 'COMPLETED', 'NO_USDT'].includes(r.opStatus) && (
                      <span className="text-[11px] text-[#70737E]">{r.opStatus === 'NO_USDT' ? 'view' : r.opStatus.toLowerCase()}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="px-3 py-6 text-center text-xs text-[#A1A4AE]">No BSC deposit addresses in this state.</p>}
      </section>
      {previewOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-[640px] rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
            <h3 className="text-sm font-black text-[#F5F5F7]">Confirm BNB batch — BSC / ChainId 56</h3>
            <p className="mt-1 text-xs text-[#A1A4AE]">
              Recipients {preview.recipientCount} · Total {preview.totalBnb} BNB · Gas wallet {short(preview.gasWallet ?? '')} (server-side)
            </p>
            <div className="mt-2 max-h-[280px] overflow-y-auto">
              {preview.eligible.map((e) => (
                <div key={e.address} className="flex justify-between gap-2 border-b border-[#202229] py-1.5 text-xs">
                  <span className="font-mono text-[#F5F5F7]">{short(e.address)}</span>
                  <span className="text-[#A1A4AE]">bnb {e.currentBnb} · req {e.requiredGasBnb}</span>
                  <span className="font-bold text-[#12B76A]">+{e.fundingBnb}</span>
                </div>
              ))}
              {preview.rejected.map((e) => (
                <div key={'rej-' + e.address} className="flex justify-between gap-2 py-1.5 text-xs text-[#F97066]">
                  <span className="font-mono">{short(e.address)}</span>
                  <span>rejected: {e.rejectReason}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setPreviewOpen(false); setPreview(null); }}>Cancel</Button>
              <Button variant="primary" size="sm" loading={busy} disabled={busy || preview.eligible.length === 0} onClick={confirmSend}>
                Confirm &amp; send BNB
              </Button>
            </div>
          </div>
        </div>
      )}

      {sweepConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-[520px] rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
            <h3 className="text-sm font-black text-[#F5F5F7]">Confirm sweep — hardened path</h3>
            <div className="mt-2 space-y-1 text-xs text-[#E4E5E8]">
              <p>Source: <span className="font-mono text-[#F5F5F7]">{sweepConfirm.depositAddress}</span></p>
              <p>USDT: {sweepConfirm.usdtBalance} · BNB: {sweepConfirm.bnbBalance} · Required: {sweepConfirm.requiredGasBnb}</p>
              <p>Treasury: <span className="font-mono">{sweepConfirm.treasury}</span></p>
              <p>Network: BSC / 56 · Sweep: <span className="font-mono">{sweepConfirm.sweepId ?? '—'}</span></p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setSweepConfirm(null)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={confirmSweep}>Confirm sweep</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
