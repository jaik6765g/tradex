import { useCallback, useEffect, useState } from 'react';
import { AdminService } from '../services/admin.service';
import { AdminLottoService, type AdminLottoDashboard, type AdminLottoSettings } from '../services/adminLotto.service';

type ConfirmState =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'manualResult'; round: any; symbol: string }
  | { kind: 'addLiquidity' }
  | { kind: 'removeLiquidity' }
  | null;

export function useLottoManager() {
  const [dashboard, setDashboard] = useState<AdminLottoDashboard | null>(null);
  const [settings, setSettings] = useState<AdminLottoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (loader = false) => {
    if (loader) setLoading(true); else setRefreshing(true); setError(null);
    try { setDashboard(await AdminLottoService.getDashboard()); }
    catch (e) { setError(AdminService.getErrorMessage(e)); }
    finally { if (loader) setLoading(false); else setRefreshing(false); }
  }, []);
  const loadSettings = useCallback(async () => { try { setSettings(await AdminLottoService.getSettings()); } catch (e) { setError(AdminService.getErrorMessage(e)); } }, []);
  useEffect(() => { void load(true); void loadSettings(); }, [load, loadSettings]);

  const act = useCallback(async (fn: () => Promise<void>) => { setBusy(true); setActionError(null); try { await fn(); } catch (e) { setActionError(AdminService.getErrorMessage(e)); } finally { setBusy(false); } }, []);
  const pause = useCallback(() => act(async () => { await AdminLottoService.pause(); await load(); setConfirm(null); }), [act, load]);
  const resume = useCallback(() => act(async () => { await AdminLottoService.resume(); await load(); setConfirm(null); }), [act, load]);
  const setMode = useCallback((mode: string) => act(async () => { await AdminLottoService.setResultMode(mode); await load(); await loadSettings(); }), [act, load, loadSettings]);
  const manualResult = useCallback((r: any, s: string, reason?: string) => act(async () => { await AdminLottoService.setManualResult(r.id, s, reason); await load(); setConfirm(null); }), [act, load]);
  const addLiquidity = useCallback((a: number, reason?: string) => act(async () => { await AdminLottoService.addLiquidity(a, reason); await load(); await loadSettings(); setConfirm(null); }), [act, load, loadSettings]);
  const removeLiquidity = useCallback((a: number, reason?: string) => act(async () => { await AdminLottoService.removeLiquidity(a, reason); await load(); await loadSettings(); setConfirm(null); }), [act, load, loadSettings]);

  return {
    dashboard, settings, loading, refreshing, error, actionError, confirm, busy,
    isPaused: dashboard?.controls?.paused ?? false,
    load, setConfirm, pause, resume, setMode, manualResult, addLiquidity, removeLiquidity,
  };
}