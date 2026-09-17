import React, { useMemo, useState } from 'react';
import { Activity, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import { useLottoExposure } from './useLottoExposure';
import { formatTdx, formatCountdown } from './adminLottoUtils';
import type { AdminLottoExposureOption } from '../services/adminLotto.service';

const STATUS_TONE: Record<string, string> = {
  SYNCED: 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]',
  SYNC_DEGRADED: 'border-[#4A2323] bg-[#281313] text-[#F87171]',
  SYNC_ERROR: 'border-[#4A2323] bg-[#281313] text-[#F87171]',
  UNKNOWN: 'border-[#292B33] bg-[#1B1917] text-[#A1A4AE]',
};

const SyncBadge = ({ syncStatus }: { syncStatus: string }) => (
  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[syncStatus] ?? STATUS_TONE.UNKNOWN}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
    {syncStatus}
  </span>
);

const formatRemaining = (ms: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  return formatCountdown(safe);
};

const CATEGORY_OPTIONS = [
  { value: 'THIRTY_SEC', label: '30 SEC' },
  { value: 'ONE_MIN', label: '1 MIN' },
  { value: 'THREE_MIN', label: '3 MIN' },
  { value: 'FIVE_MIN', label: '5 MIN' },
  { value: 'TEN_MIN', label: '10 MIN' },
];

export default function AdminLottoExposureScreen() {
  const [category, setCategory] = useState('THIRTY_SEC');
  const [sort, setSort] = useState<'number' | 'stake' | 'bets' | 'potential'>('number');
  const { exposure, loading, error, updatedAt, refresh } = useLottoExposure(category);

  const sortedOptions = useMemo<AdminLottoExposureOption[]>(() => {
    if (!exposure?.options) return [];
    const opts = [...exposure.options];
    if (sort === 'stake') opts.sort((a, b) => b.totalStake - a.totalStake);
    else if (sort === 'bets') opts.sort((a, b) => b.betCount - a.betCount);
    else if (sort === 'potential') opts.sort((a, b) => b.winPotential - a.winPotential);
    else opts.sort((a, b) => a.option.localeCompare(b.option));
    return opts;
  }, [exposure, sort]);

  const highest = useMemo<AdminLottoExposureOption | null>(() => {
    if (!exposure?.options?.length) return null;
    return exposure.options.reduce(
      (max, o) => (o.totalStake > max.totalStake ? o : max),
      exposure.options[0],
    );
  }, [exposure]);

  // Highest win-potential number(s) — the payout the house owes if it wins.
  const highestWinPotential = useMemo<AdminLottoExposureOption | null>(() => {
    if (!exposure?.options?.length) return null;
    return exposure.options.reduce(
      (max, o) => (o.winPotential > max.winPotential ? o : max),
      exposure.options[0],
    );
  }, [exposure]);

  // Strategy bands come straight from the backend so the display and the draw
  // engine always use exactly the same numbers.
  const winTiers = exposure?.winTiers ?? { highest: [], medium: [], lowest: [] };
  const strategyPick = exposure?.strategyPick ?? null;

  // Highest / Medium / Lowest bet classification across all 16 numbers.
  const betTiers = useMemo(() => {
    if (!exposure?.options?.length) {
      return { highestBet: [] as AdminLottoExposureOption[], mediumBet: [] as AdminLottoExposureOption[], lowestBet: [] as AdminLottoExposureOption[], avgStake: 0 };
    }
    const opts = exposure.options;
    const stakes = opts.map((o) => o.totalStake);
    const maxStake = Math.max(...stakes);
    const minStake = Math.min(...stakes);
    const avgStake = stakes.reduce((s, v) => s + v, 0) / stakes.length;

    const highestBet = opts.filter((o) => o.totalStake === maxStake);
    const lowestBet = opts.filter((o) => o.totalStake === minStake);

    // Medium = number(s) closest to the average stake.
    let mediumBet: AdminLottoExposureOption[] = [];
    let minDiff = Infinity;
    for (const o of opts) {
      const diff = Math.abs(o.totalStake - avgStake);
      if (diff < minDiff - 1e-9) {
        minDiff = diff;
        mediumBet = [o];
      } else if (Math.abs(diff - minDiff) <= 1e-9) {
        mediumBet.push(o);
      }
    }

    return { highestBet, mediumBet, lowestBet, avgStake };
  }, [exposure]);

  const totalStake = exposure?.totalStake ?? 0;

  return (
    <div className="space-y-3">

      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-black text-[#F5F5F7]">
              <Activity size={22} className="text-[#FF7A18]" /> Lotto Live Exposure
            </h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">
              Real-time TDX placed on each number for the current authoritative period.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-lg border border-[#292B33] bg-[#111217] px-2 text-xs text-[#A1A4AE]"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => void refresh()} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#292B33] px-3 text-xs font-bold text-[#A1A4AE] hover:bg-[#111217]">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-[#4A2323] bg-[#281313] px-3 py-2 text-xs text-[#F87171]">
          {error}
        </div>
      )}

      {!loading && exposure && exposure.periodNumber && exposure.syncStatus !== 'SYNCED' && (
        <div className="flex items-center gap-2 rounded-lg border border-[#4A2323] bg-[#281313] px-3 py-2 text-xs text-[#F87171]">
          <AlertTriangle size={14} />
          Period reference is {exposure.syncStatus}. Showing last verified period ({exposure.periodNumber}).
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Current Period</p>
          <p className="mt-1 truncate text-lg font-black tabular-nums text-[#F5F5F7]">
            {exposure?.periodNumber ?? '—'}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <SyncBadge syncStatus={exposure?.syncStatus ?? 'UNKNOWN'} />
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${exposure?.status === 'OPEN' ? 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]' : 'border-[#292B33] bg-[#1B1917] text-[#A1A4AE]'}`}>
              {exposure?.status ?? 'UNKNOWN'}
            </span>
          </div>
        </div>
        <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#70737E]">
            <Clock size={11} /> Time Remaining
          </p>
          <p className="mt-1 text-lg font-black tabular-nums text-[#F5F5F7]">
            {exposure ? formatRemaining(exposure.remainingMs) : '—'}
          </p>
          <p className="text-[10px] text-[#A1A4AE]">
            Draw at {exposure?.endTime ? new Date(exposure.endTime).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Total TDX</p>
          <p className="mt-1 text-lg font-black text-[#F5F5F7]">{formatTdx(totalStake)} TDX</p>
          <p className="text-[10px] text-[#A1A4AE]">{exposure?.totalBets ?? 0} bets</p>
        </div>
        <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Highest Exposure</p>
          {highest && highest.totalStake > 0 ? (
            <>
              <p className="mt-1 text-lg font-black text-[#FF8F3D]">Number {highest.option}</p>
              <p className="text-[10px] text-[#A1A4AE]">{formatTdx(highest.totalStake)} TDX · {highest.betCount} bets</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#A1A4AE]">No bets yet</p>
          )}
        </div>
      </div>

      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-[#F5F5F7]">Draw Outcome (Win Strategy)</h2>
            <p className="mt-0.5 text-[10px] text-[#A1A4AE]">
              Win potential = payout owed if that number wins (net stake × multiplier of every unsettled bet on it).
              The engine draws the number below for the active round unless an admin result is locked.
            </p>
          </div>
          <span className="rounded-lg border border-[#292B33] bg-[#111217] px-2 py-1 text-[10px] font-bold text-[#FF8F3D]">
            Strategy: {exposure?.winStrategy ?? '—'}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Engine will draw</p>
            {strategyPick ? (
              <>
                <p className="mt-1 text-2xl font-black text-[#FF8F3D]">{strategyPick.option}</p>
                <p className="text-[10px] text-[#A1A4AE]">
                  {strategyPick.strategy} · potential {formatTdx(strategyPick.winPotential)} TDX · {strategyPick.betCount} bets
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-black text-[#A1A4AE]">—</p>
                <p className="text-[10px] text-[#A1A4AE]">
                  {(exposure?.winStrategy ?? 'RANDOM') === 'RANDOM'
                    ? 'Random draw — no steering active'
                    : 'No staked number to steer with (random fallback)'}
                </p>
              </>
            )}
            {exposure?.activeRoundNumber && (
              <p className="mt-1 text-[10px] text-[#70737E]">Active round #{exposure.activeRoundNumber}</p>
            )}
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Highest Win Potential</p>
            {highestWinPotential && highestWinPotential.winPotential > 0 ? (
              <>
                <p className="mt-1 text-2xl font-black text-[#FF8F3D]">{highestWinPotential.option}</p>
                <p className="text-[10px] text-[#A1A4AE]">{formatTdx(highestWinPotential.winPotential)} TDX payout owed</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[#A1A4AE]">No bets yet</p>
            )}
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Worst-Case Payout</p>
            <p className="mt-1 text-2xl font-black text-[#F5F5F7]">{formatTdx(exposure?.maxWinPotential ?? 0)} TDX</p>
            <p className="text-[10px] text-[#A1A4AE]">If the highest-potential number wins</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#FF7A18] text-[9px] font-black text-white">H</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Highest win potential</p>
            </div>
            <p className="mt-2 text-sm font-black text-[#FF8F3D]">{winTiers.highest.join(', ') || '—'}</p>
            <p className="text-[10px] text-[#A1A4AE]">Wins when strategy = HIGH</p>
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#3B82F6] text-[9px] font-black text-white">M</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Medium win potential</p>
            </div>
            <p className="mt-2 text-sm font-black text-[#60A5FA]">{winTiers.medium.join(', ') || '—'}</p>
            <p className="text-[10px] text-[#A1A4AE]">Wins when strategy = MEDIUM</p>
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#34D399] text-[9px] font-black text-white">L</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Lowest win potential</p>
            </div>
            <p className="mt-2 text-sm font-black text-[#4ADE80]">{winTiers.lowest.join(', ') || '—'}</p>
            <p className="text-[10px] text-[#A1A4AE]">Wins when strategy = LOW</p>
          </div>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <h2 className="text-sm font-black text-[#F5F5F7]">Bet Stake Distribution</h2>
        <p className="mt-0.5 text-[10px] text-[#A1A4AE]">Numbers grouped by their total TDX stake relative to the period average ({formatTdx(betTiers.avgStake)} TDX).</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#FF7A18] text-[9px] font-black text-white">H</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Highest Bet</p>
            </div>
            {betTiers.highestBet.length > 0 && totalStake > 0 ? (
              <>
                <p className="mt-2 text-sm font-black text-[#FF8F3D]">{betTiers.highestBet.map((o) => o.option).join(', ')}</p>
                <p className="text-[10px] text-[#A1A4AE]">{betTiers.highestBet.length === 1 ? `${formatTdx(betTiers.highestBet[0].totalStake)} TDX` : `${betTiers.highestBet.length} numbers`}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[#A1A4AE]">No bets yet</p>
            )}
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#3B82F6] text-[9px] font-black text-white">M</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Medium Bet</p>
            </div>
            {betTiers.mediumBet.length > 0 && totalStake > 0 ? (
              <>
                <p className="mt-2 text-sm font-black text-[#60A5FA]">{betTiers.mediumBet.map((o) => o.option).join(', ')}</p>
                <p className="text-[10px] text-[#A1A4AE]">{betTiers.mediumBet.length === 1 ? `${formatTdx(betTiers.mediumBet[0].totalStake)} TDX` : `${betTiers.mediumBet.length} numbers`}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[#A1A4AE]">No bets yet</p>
            )}
          </div>
          <div className="rounded-xl border border-[#292B33] bg-[#111217] p-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#34D399] text-[9px] font-black text-white">L</span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Lowest Bet</p>
            </div>
            {betTiers.lowestBet.length > 0 && totalStake > 0 ? (
              <>
                <p className="mt-2 text-sm font-black text-[#4ADE80]">{betTiers.lowestBet.map((o) => o.option).join(', ')}</p>
                <p className="text-[10px] text-[#A1A4AE]">{betTiers.lowestBet.length === 1 ? `${formatTdx(betTiers.lowestBet[0].totalStake)} TDX` : `${betTiers.lowestBet.length} numbers`}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[#A1A4AE]">No bets yet</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-[#F5F5F7]">TDX by Number</h2>
          <div className="flex items-center gap-1">
            {(['number', 'stake', 'bets', 'potential'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`h-7 rounded-md px-2 text-[10px] font-bold ${sort === s ? 'border border-[#FF7A18] bg-[#2A190D] text-[#FF8F3D]' : 'border border-[#292B33] text-[#A1A4AE] hover:text-[#A1A4AE]'}`}
              >
                {s === 'number' ? '0 to F' : s === 'stake' ? 'Highest TDX' : s === 'bets' ? 'Highest Bets' : 'Highest Payout'}
              </button>
            ))}
          </div>
        </div>

        {loading && !exposure ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-[#111217]" />
            ))}
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-[#70737E]">
                  <th className="pb-2 pr-3">Number</th>
                  <th className="pb-2 pr-3 text-right">Bets</th>
                  <th className="pb-2 pr-3 text-right">TDX</th>
                  <th className="pb-2 pr-3 text-right">Win Potential</th>
                  <th className="pb-2 pr-3 text-right">House P/L</th>
                  <th className="pb-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {sortedOptions.map((o) => {
                  const share = totalStake > 0 ? (o.totalStake / totalStake) * 100 : 0;
                  const isHighest = highest && o.option === highest.option && o.totalStake > 0;
                  const isStrategyPick = strategyPick?.option === o.option;
                  const isTopPayout = highestWinPotential && o.option === highestWinPotential.option && o.winPotential > 0;
                  return (
                    <tr key={o.option} className={`border-t border-[#292B33] ${isStrategyPick ? 'bg-[#10251A]/50' : isHighest ? 'bg-[#2A190D]/40' : ''}`}>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg font-black ${isStrategyPick ? 'bg-[#4ADE80] text-[#06210F]' : isHighest ? 'bg-[#FF7A18] text-white' : 'bg-[#111217] text-[#F5F5F7]'}`}>
                            {o.option}
                          </span>
                          {isStrategyPick && <span className="rounded-md bg-[#10251A] px-1.5 py-0.5 text-[9px] font-black text-[#4ADE80]">DRAW</span>}
                          {!isStrategyPick && isTopPayout && <span className="rounded-md bg-[#2A190D] px-1.5 py-0.5 text-[9px] font-black text-[#FF8F3D]">MAX</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[#A1A4AE]">{o.betCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-bold text-[#F5F5F7]">{formatTdx(o.totalStake)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-bold text-[#FF8F3D]">{formatTdx(o.winPotential)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-bold ${o.netExposure < 0 ? 'text-[#F87171]' : 'text-[#4ADE80]'}`}>{formatTdx(o.netExposure)}</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#111217]">
                            <div className={`h-full ${isHighest ? 'bg-[#FF7A18]' : 'bg-[#3A3A44]'}`} style={{ width: `${Math.min(100, share)}%` }} />
                          </div>
                          <span className="w-12 text-right tabular-nums text-[#A1A4AE]">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {updatedAt && (
          <p className="mt-2 text-[10px] text-[#70737E]">Last updated: {new Date(updatedAt).toLocaleTimeString()}</p>
        )}
      </section>
    </div>
  );
}
