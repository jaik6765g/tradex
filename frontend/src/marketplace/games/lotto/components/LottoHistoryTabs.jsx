// src/marketplace/games/lotto/components/LottoHistoryTabs.jsx
// Tabbed wrapper for Game History (public draws) and My History (user tickets).

import React, { useState } from 'react';

import { ChevronLeft, ChevronRight, History } from 'lucide-react';

import LottoGameHistory from './LottoGameHistory';
import LottoMyHistory from './LottoMyHistory';

const TABS = [
  { id: 'game', label: 'Game History' },
  { id: 'mine', label: 'My History' },
];

const PAGE_STRIDE = 5;
const MAX_PAGES = 10;

// Build a numbered pagination bar (Prev | 1 2 3 … 10 | Next).
// 5 items per page, at most 10 page buttons. Hidden when only one page.
const buildPagination = ({ meta, loading, onGoToPage }) => {
  if (typeof onGoToPage !== 'function') return null;

  const limit = Math.max(1, Number(meta?.limit) || PAGE_STRIDE);
  const total = Math.max(0, Number(meta?.total) || 0);
  const offset = Math.max(0, Number(meta?.offset) || 0);
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  const lastPage = Math.min(totalPages, MAX_PAGES);
  const pages = [];
  for (let p = 1; p <= lastPage; p += 1) pages.push(p);

  const navClass =
    'inline-flex h-7 items-center justify-center gap-0.5 rounded-lg border border-[#26262E] bg-[#16161C] px-2 text-[10px] font-bold text-[#B9BAC6] transition-colors hover:bg-[#16161C] disabled:cursor-not-allowed disabled:opacity-40';
  const idleClass =
    'min-w-7 h-7 rounded-lg border border-[#26262E] bg-[#16161C] text-[10px] font-black text-[#9A9BA8] transition-colors hover:bg-[#16161C]';
  const activeClass =
    'min-w-7 h-7 rounded-lg bg-gradient-to-b from-[#F97316] to-[#FB923C] text-[10px] font-black text-white shadow-sm';

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        className={navClass}
        disabled={loading || currentPage <= 1}
        onClick={() => onGoToPage(currentPage - 1)}
      >
        <ChevronLeft size={11} strokeWidth={2.6} />
        Prev
      </button>

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={p === currentPage ? activeClass : idleClass}
          disabled={loading}
          onClick={() => onGoToPage(p)}
        >
          {p}
        </button>
      ))}

      <button
        type="button"
        className={navClass}
        disabled={loading || currentPage >= totalPages}
        onClick={() => onGoToPage(currentPage + 1)}
      >
        Next
        <ChevronRight size={11} strokeWidth={2.6} />
      </button>
    </div>
  );
};

const LottoHistoryTabs = ({
  // Game history props
  recentResults,
  gameLoading,
  onRefreshGame,
  category,
  resultsMeta,
  onGoToResultsPage,
  // My history props
  history,
  historyLoading,
  historyMeta,
  onGoToHistoryPage,
}) => {
  const [activeTab, setActiveTab] = useState('game');

  const gamePagination = buildPagination({
    meta: resultsMeta,
    loading: gameLoading,
    onGoToPage: onGoToResultsPage,
  });
  const minePagination = buildPagination({
    meta: historyMeta,
    loading: historyLoading,
    onGoToPage: onGoToHistoryPage,
  });

  return (
    <section className="lotto-card lotto-card--pad lotto-rise lotto-rise--d4">
      {/* Header + Tabs */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#F5F5F7]">
          <History size={15} strokeWidth={2.4} className="text-[#7C3AED]" />
          History
        </h3>

        {/* Tab pills */}
        <div className="inline-flex rounded-xl border border-[#26262E] bg-[#16161C] p-0.5 shadow-sm">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`
                  rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider
                  transition-all duration-150
                  ${
                    isActive
                      ? 'bg-gradient-to-b from-[#FB923C] to-[#FB923C] text-[#7C2D12] shadow-sm'
                      : 'text-[#9A9BA8] hover:text-[#F5F5F7]'
                  }
                `}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="mt-3">
        {activeTab === 'game' ? (
          <LottoGameHistory
            recentResults={recentResults}
            loading={gameLoading}
            onRefresh={onRefreshGame}
            category={category}
            pagination={gamePagination}
            embedded
          />
        ) : (
          <LottoMyHistory
            history={history}
            historyLoading={historyLoading}
            pagination={minePagination}
            embedded
          />
        )}
      </div>
    </section>
  );
};

export default LottoHistoryTabs;