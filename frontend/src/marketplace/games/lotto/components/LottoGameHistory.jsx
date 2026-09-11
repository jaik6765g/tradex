// src/marketplace/games/lotto/components/LottoGameHistory.jsx
// Public game history — recent draws shown as period + number chip with
// color tone. Read-only presentation from `recentResults`.

import React from 'react';

import { Gamepad2, RefreshCw } from 'lucide-react';

import { formatDateTime } from '../utils/lottoPresentation';
import {
  DOT_PATTERNS_2x2,
  getNumberGroups,
  GROUP_TONE,
  resultDotToneClassName,
  symbolToneClassName,
} from '../utils/lottoUi';

const LottoGameHistory = ({
  recentResults,
  loading,
  onRefresh,
  embedded,
  category,
  pagination,
}) => {
  const allDraws = Array.isArray(recentResults) ? recentResults : [];
  // Filter bylthe selected timer category (30 Sec → only 30-sec draws, etc.)
  const draws = category
    ? allDraws.filter((draw) => draw.category === category)
    : allDraws;
  const hasDraws = draws.length > 0;

  return (
    <section className={`lotto-rise lotto-rise--d4 ${embedded ? '' : 'lotto-card lotto-card--pad'}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#111827]">
          <Gamepad2 size={15} strokeWidth={2.4} className="text-[#7C3AED]" />
          Game History
        </h3>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#475467] transition-colors hover:bg-[#F9FAFB] disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      </div>

      {/* Draws list — each row is a period + number chip */}
      {hasDraws ? (
        <div className="mt-3 space-y-1.5">
          {draws.map((draw) => {
            const periodLabel =
              draw.roundNumber ?? draw.period ?? draw.id ?? '—';
            const resultValue = draw.result ?? '·';
            const drawDate =
              draw.drawAt ?? draw.generatedAt ?? draw.finalizedAt ?? null;
            const groups = getNumberGroups(resultValue);

            return (
              <div
                key={draw.id ?? draw.roundNumber ?? draw.drawAt ?? resultValue}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 transition-colors hover:bg-[#F9FAFB]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-xs font-black text-[#7C3AED] tabular-nums">
                    #{periodLabel}
                  </span>
                  {drawDate && (
                    <span className="text-[10px] font-medium text-[#98A2B3]">
                      {formatDateTime(drawDate)}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] text-[11px] font-black ${symbolToneClassName(
                      resultValue,
                    )}`}
                    title={`Result: ${resultValue}`}
                  >
                    {resultValue}
                  </span>

                  {groups && (
                    <div
                      className="flex items-center gap-1.5"
                      title={`${groups.primary} + ${groups.secondary}`}
                      aria-label={`${groups.primary} + ${groups.secondary}`}
                    >
                      {[groups.primary, groups.secondary].map((group) => (
                        <div
                          key={group}
                          className="grid grid-cols-2 gap-0.5 place-content-center place-items-center"
                          style={{ width: 14, height: 14 }}
                        >
                          {DOT_PATTERNS_2x2[group].map((dot, i) => (
                            <span
                              key={i}
                              className="block rounded-full"
                              style={{
                                width: 5,
                                height: 5,
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {pagination}
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D0D5DD] py-8 text-center">
          <Gamepad2 size={26} strokeWidth={1.6} className="text-[#98A2B3]" />
          <p className="mt-2 text-xs font-bold text-[#667085]">
            No draws yet
          </p>
          <p className="mt-1 text-[10px] text-[#98A2B3]">
            {category ? 'No results for this period yet' : 'Recent results will appear here'}
          </p>
        </div>
      )}
    </section>
  );
};

export default LottoGameHistory;