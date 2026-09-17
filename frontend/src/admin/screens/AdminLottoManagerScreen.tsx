import React, { useState } from 'react';
import { Pause, Play, RefreshCw, Trophy } from 'lucide-react';
import { AdminService } from '../services/admin.service';
import { AdminLottoService, type AdminLottoDashboard, type AdminLottoSettings } from '../services/adminLotto.service';
import { Button, ErrorState, Skeleton } from '../../components/ui';
import { RESULT_SYMBOLS, CATEGORIES, statusTone, formatTdx, formatDateTime, formatCountdown } from './adminLottoUtils';
import RoundCard from './AdminLottoRoundCard';
import SettlementCard from './AdminLottoSettlementCard';
import LiquidityCard from './AdminLottoLiquidityCard';
import RecentResultsCard from './AdminLottoRecentResultsCard';
import ManualResultControl from './AdminLottoManualResultControl';
import SettingsCard from './AdminLottoSettingsCard';
import ConfirmModal from './AdminLottoConfirmModal';
import { useLottoManager } from './useLottoManager';

// Re-exports so sub-components keep importing from the screen without a cycle.
export { RESULT_SYMBOLS, CATEGORIES, statusTone, formatTdx, formatDateTime, formatCountdown };

type ConfirmState = { kind: 'pause' } | { kind: 'resume' } | { kind: 'manualResult'; round: any; symbol: string } | { kind: 'addLiquidity' } | { kind: 'removeLiquidity' } | null;

export default function AdminLottoManagerScreen() {
  const m = useLottoManager();
  if (m.loading) return (<div className="space-y-3"><Skeleton className="h-24 w-full" /><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div></div>);
  if (m.error && !m.dashboard) return <ErrorState title="Failed to load" description={m.error} onRetry={() => void m.load(true)} />;

  return (<>
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-[20px] font-black text-[#F5F5F7]"><Trophy size={22} className="text-[#FF7A18]" /> Lotto Game Manager</h1><p className="mt-0.5 text-xs text-[#A1A4AE]">Monitor and control all supported Lotto game settings and operations. All values are live from the backend.</p></div>
        <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" loading={m.refreshing} onClick={() => void m.load()}><RefreshCw size={14} className="mr-1.5" /> Refresh</Button>
      </div>
      {m.actionError && <div className="mt-3 rounded-lg border border-[#4A2323] bg-[#281313] px-3 py-2 text-xs text-[#F87171]">{m.actionError}</div>}
      {m.notice && <div className="mt-3 rounded-lg border border-[#1E4A32] bg-[#10251A] px-3 py-2 text-xs text-[#4ADE80]">{m.notice}</div>}
    </section>
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${m.isPaused ? 'border-[#4A2323] bg-[#281313] text-[#F87171]' : 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]'}`}>{m.isPaused ? <Pause size={14}/> : <Play size={14}/>} {m.isPaused ? 'GAME PAUSED' : 'GAME RUNNING'}</span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-[#292B33] bg-[#111217] px-3 py-1.5 text-xs font-bold text-[#A1A4AE]">Win strategy: <span className="text-[#FF8F3D]">{m.winStrategy}</span></span>
        {m.isPaused ? <Button size="sm" className="h-9 px-3 text-xs" onClick={() => m.setConfirm({ kind: 'resume' })}><Play size={14} className="mr-1.5"/> Resume</Button> : <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" onClick={() => m.setConfirm({ kind: 'pause' })}><Pause size={14} className="mr-1.5"/> Pause</Button>}
      </div>
    </section>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {CATEGORIES.map((c) => <RoundCard key={c} category={c} card={m.dashboard?.categoryCards?.find((x) => x.category === c) ?? null} onRequestResult={(r) => m.setConfirm({ kind: 'manualResult', round: r, symbol: '0' })}/>)}
    </div>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <SettlementCard dashboard={m.dashboard}/>
      <LiquidityCard dashboard={m.dashboard} onAdd={() => m.setConfirm({ kind: 'addLiquidity' })} onRemove={() => m.setConfirm({ kind: 'removeLiquidity' })}/>
      <RecentResultsCard results={m.dashboard?.recentResults ?? []}/>
    </div>
    <ManualResultControl rounds={m.dashboard?.categoryCards?.map((c) => c.round).filter((r): r is NonNullable<typeof r> => r !== null) ?? []} onConfirm={(r, s) => m.setConfirm({ kind: 'manualResult', round: r, symbol: s })}/>
    <SettingsCard
      settings={m.settings}
      onSetResultMode={(mode) => void m.setMode(mode)}
      onSetWinStrategy={(strategy) => void m.setWinStrategy(strategy)}
      busy={m.busy}
    />
    <ConfirmModal state={m.confirm} busy={m.busy} onClose={() => m.setConfirm(null)} onPause={() => void m.pause()} onResume={() => void m.resume()} onManualResult={(r, s, re) => void m.manualResult(r, s, re)} onAddLiquidity={(a, r) => void m.addLiquidity(a, r)} onRemoveLiquidity={(a, r) => void m.removeLiquidity(a, r)}/>
  </>);
}