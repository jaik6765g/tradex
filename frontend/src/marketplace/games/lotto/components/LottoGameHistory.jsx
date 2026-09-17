// src/marketplace/games/lotto/components/LottoGameHistory.jsx
// Public game history — recent draws shown as a compact table:
//   Period | Number | Even/Odd | Colour
// Date removed. Colour shows BOTH overlapping groups (primary + secondary)
// as compact rounded dice chips — same two-colour look as before, but tight
// spacing so everything fits on one screen without scrolling.

import React from 'react';

import { Gamepad2, RefreshCw } from 'lucide-react';

import {
  DOT_PATTERNS_2x2,
  getNumberGroups,
  GROUP_TONE,
  symbolToneClassName,
} from '../utils/lottoUi';

/** Result symbol → 'Even' | 'Odd' (hex: A=10 … F=15). */
const toEvenOdd = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]$/.test(normalized)) return null;
  return parseInt(normalized, 16) % 2 === 0 ? 'Even' : 'Odd';
};

const LottoGameHistory = ({
  recentResults,
  loading,
  onRefresh,
  embedded,
  category,
  pagination,
}) => {
  const allDraws = Array.isArray(recentResults) ? recentResults : [];
  const draws = category
    ? allDraws.filter((draw) => draw.category === category)
    : allDraws;
  const hasDraws = draws.length > 0;

  return (
    <section className={`lotto-rise lotto-rise--d4 ${embedded ? '' : 'lotto-card lotto-card--pad'}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#F5F5F7]">
          <Gamepad2 size={15} strokeWidth={2.4} className="text-[#7C3AED]" />
          Game History
        </h3>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#26262E] bg-[#16161C] px-2.5 py-1.5 text-[10px] font-bold text-[#B9BAC6] transition-colors hover:bg-[#16161C] disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      </div>

      {hasDraws ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-[#1C1C24] bg-[#101014] text-left text-[10px] font-black uppercase tracking-wider text-[#7C7D8A]">
                <th className="px-2 py-1">Period</th>
                <th className="px-2 py-1">Number</th>
                <th className="px-1.5 py-1">Even/Odd</th>
                <th className="px-1.5 py-1">Colour</th>
              </tr>
            </thead>
            <tbody>
              {draws.map((draw) => {
                const periodLabel = draw.roundNumber ?? draw.period ?? draw.id ?? '—';
                const resultValue = String(draw.result ?? '').trim().toUpperCase();
                const isValidSymbol = /^[0-9A-F]$/.test(resultValue);
                const evenOdd = toEvenOdd(resultValue);
                const groups = getNumberGroups(resultValue);

                return (
                  <tr
                    key={draw.id ?? draw.roundNumber ?? draw.drawAt ?? resultValue}
                    className="border-b border-[#1C1C24] transition-colors hover:bg-[#16161C]"
                  >
                    <td className="py-1 pl-1 pr-2 text-xs font-black text-[#7C3AED] tabular-nums">
                      {periodLabel}
                    </td>

                    <td className="px-2 py-1">
                      {isValidSymbol ? (
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#26262E] bg-[#101014] text-[10px] font-black ${symbolToneClassName(resultValue)}`}
                          title={`Result: ${resultValue}`}
                        >
                          {resultValue}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#7C7D8A]">—</span>
                      )}
                    </td>

                    <td className="px-1.5 py-1">
                      {evenOdd ? (
                        <span
                          className={`text-[10px] font-bold ${evenOdd === 'Even' ? 'text-[#4ADE80]' : 'text-[#F87171]'}`}
                        >
                          {evenOdd}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#7C7D8A]">—</span>
                      )}
                    </td>

                    {/* Colour — two compact dice chips (primary + secondary), no text names */}
                    <td className="whitespace-nowrap px-1.5 py-1">
                      {groups ? (
                        <span className="inline-flex items-center gap-0.5">
                          {[groups.primary, groups.secondary].map((group) => (
                            <span
                              key={group}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[#26262E] bg-[#101014]"
                              title={`${group.charAt(0)}${group.slice(1).toLowerCase()} group`}
                            >
                              <span
                                className="grid grid-cols-2 gap-0.5 place-content-center place-items-center"
                                style={{ width: 11, height: 11 }}
                              >
                                {DOT_PATTERNS_2x2[group].map((dot, i) => (
                                  <span
                                    key={i}
                                    className="block rounded-full"
                                    style={{
                                      width: 4,
                                      height: 4,
                                      backgroundColor: dot.filled
                                        ? GROUP_TONE[group]
                                        : 'transparent',
                                      border: dot.filled
                                        ? 'none'
                                        : `1.5px solid ${GROUP_TONE[group]}`,
                                      boxSizing: 'border-box',
                                    }}
                                  />
                                ))}
                              </span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#7C7D8A]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pagination}
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#34343E] py-8 text-center">
          <Gamepad2 size={26} strokeWidth={1.6} className="text-[#7C7D8A]" />
          <p className="mt-2 text-xs font-bold text-[#9A9BA8]">No draws yet</p>
          <p className="mt-1 text-[10px] text-[#7C7D8A]">
            {category ? 'No results for this period yet' : 'Recent results will appear here'}
          </p>
        </div>
      )}
    </section>
  );
};

export default LottoGameHistory;