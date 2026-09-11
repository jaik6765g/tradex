// src/marketplace/games/lotto/components/LottoNumberGrid.jsx

import React from 'react';
import { Eraser } from 'lucide-react';

import {
  isGroupFullySelected,
  isGroupPartiallySelected,
  getNumberGroups,
  GROUP_TONE,
} from '../utils/lottoUi';
import { COLOR_GROUPS } from '../utils/lottoState';

// ✅ 4 color groups
const COLOR_GROUP_DEFS = [
  { key: 'GREEN',  label: 'Green',  tone: GROUP_TONE.GREEN,  range: '0 – 7',           numbers: COLOR_GROUPS.GREEN  },
  { key: 'RED',    label: 'Red',    tone: GROUP_TONE.RED,    range: '8 – F',           numbers: COLOR_GROUPS.RED    },
  { key: 'YELLOW', label: 'Yellow', tone: GROUP_TONE.YELLOW, range: '0,1,4,5,8,9,C,D', numbers: COLOR_GROUPS.YELLOW },
  { key: 'BLUE',   label: 'Blue',   tone: GROUP_TONE.BLUE,   range: '2,3,6,7,A,B,E,F', numbers: COLOR_GROUPS.BLUE   },
];

// ✅ 2×2 dot patterns for the GROUP buttons (5th column) — keyed by group key
const GROUP_DOT_PATTERNS = {
  GREEN: [
    { filled: true,  tone: GROUP_TONE.GREEN },
    { filled: true,  tone: GROUP_TONE.GREEN },
    { filled: false, tone: GROUP_TONE.GREEN },
    { filled: false, tone: GROUP_TONE.GREEN },
  ],
  RED: [
    { filled: false, tone: GROUP_TONE.RED },
    { filled: false, tone: GROUP_TONE.RED },
    { filled: true,  tone: GROUP_TONE.RED },
    { filled: true,  tone: GROUP_TONE.RED },
  ],
  YELLOW: [
    { filled: true,  tone: GROUP_TONE.YELLOW },
    { filled: false, tone: GROUP_TONE.YELLOW },
    { filled: true,  tone: GROUP_TONE.YELLOW },
    { filled: false, tone: GROUP_TONE.YELLOW },
  ],
  BLUE: [
    { filled: false, tone: GROUP_TONE.BLUE },
    { filled: true,  tone: GROUP_TONE.BLUE },
    { filled: false, tone: GROUP_TONE.BLUE },
    { filled: true,  tone: GROUP_TONE.BLUE },
  ],
};

const LottoNumberGrid = ({
  selectedNumbers,
  onToggleNumber,
  onToggleGroup,
  onClearSelection,
  disabled,
  maxSelections,
  forbiddenGroup,
}) => {
  const isMaxSelected = selectedNumbers.length >= maxSelections;

  // Rows for the 4×5 number grid
  const rows = [
    { numbers: ['0', '1', '2', '3'], color: 'green'  },
    { numbers: ['4', '5', '6', '7'], color: 'red'    },
    { numbers: ['8', '9', 'A', 'B'], color: 'yellow' },
    { numbers: ['C', 'D', 'E', 'F'], color: 'cyan'   },
  ];

  return (
    <section className="rounded-[16px] bg-white border border-[#E5E7EB] shadow-sm p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#667085]">
            Pick Numbers
          </span>
          <span className="inline-flex items-center rounded-md bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] px-2 py-0.5 text-[10px] font-black text-white">
            {selectedNumbers.length}/{maxSelections}
          </span>
        </div>

        {selectedNumbers.length > 0 && !disabled && (
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[10px] font-bold text-[#475467] hover:bg-[#F9FAFB]"
          >
            <Eraser size={11} strokeWidth={2.4} />
            Clear
          </button>
        )}
      </div>

      {/* Purple Container */}
      <div className="rounded-[14px] bg-gradient-to-br from-[#7C3AED] via-[#8B5CF6] to-[#7C3AED] p-3 shadow-md">
        <div className="space-y-2">
          {rows.map((row, index) => {
            // Row 0 → GREEN, Row 1 → RED, Row 2 → YELLOW, Row 3 → BLUE
            const groupDef = COLOR_GROUP_DEFS[index];

            const allSelected = isGroupFullySelected(
              groupDef.numbers,
              selectedNumbers,
            );
            const someSelected = isGroupPartiallySelected(
              groupDef.numbers,
              selectedNumbers,
            );
            const isForbidden = forbiddenGroup === groupDef.key;
            const groupDots = GROUP_DOT_PATTERNS[groupDef.key];

            return (
              <div key={row.color} className="grid grid-cols-5 gap-2">
                {/* 4 Numbers */}
                {row.numbers.map((value) => {
                  const selected = selectedNumbers.includes(value);
                  const isDisabled = disabled || (!selected && isMaxSelected);

                  // ✅ TWO overlapping groups for this number
                  const { primary, secondary } = getNumberGroups(value);
                  const primaryTone = GROUP_TONE[primary];
                  const secondaryTone = GROUP_TONE[secondary];

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => !isDisabled && onToggleNumber(value)}
                      disabled={isDisabled}
                      aria-pressed={selected}
                      className={`
                        relative h-10 rounded-[8px] font-black text-[15px]
                        transition-all duration-150 active:scale-95
                        flex items-center justify-center
                        ${
                          selected
                            ? 'bg-gradient-to-br from-[#FFD54D] to-[#F59E0B] text-white shadow-md shadow-[#F59E0B]/40'
                            : 'bg-gradient-to-b from-white to-[#F3F4F6] text-[#4C1D95] shadow-sm hover:shadow-md'
                        }
                        ${
                          !selected && isDisabled
                            ? 'opacity-40 cursor-not-allowed'
                            : 'cursor-pointer'
                        }
                      `}
                    >
                      {value}

                      {/* ✅ TWO color dots at the bottom */}
                      <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 flex items-center gap-[3px]">
                        <span
                          className="block w-[6px] h-[6px] rounded-full"
                          style={{
                            backgroundColor: selected
                              ? '#FFFFFF'
                              : primaryTone,
                          }}
                        />
                        <span
                          className="block w-[6px] h-[6px] rounded-full"
                          style={{
                            backgroundColor: selected
                              ? '#FFFFFF'
                              : secondaryTone,
                          }}
                        />
                      </span>

                      {selected && (
                        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[8px] font-black text-[#F59E0B] shadow-sm">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Group button (5th column) — same height as number buttons */}
                <button
                  type="button"
                  onClick={() =>
                    !disabled &&
                    !isForbidden &&
                    onToggleGroup?.(groupDef.key, groupDef.numbers)
                  }
                  disabled={disabled || isForbidden}
                  aria-pressed={allSelected}
                  aria-label={`Toggle ${groupDef.label} group (${groupDef.range})`}
                  title={
                    isForbidden
                      ? `${groupDef.label} cannot combine with the selected group`
                      : `${groupDef.label}: ${groupDef.range}`
                  }
                  className={`
                    relative h-10 rounded-[8px]
                    bg-gradient-to-b from-white to-[#F3F4F6] shadow-sm
                    transition-all duration-150 active:scale-95
                    flex items-center justify-center
                    ${allSelected ? 'ring-2 ring-[#F59E0B]' : ''}
                    ${
                      someSelected && !allSelected
                        ? 'ring-1 ring-[#FBBF24]'
                        : ''
                    }
                    ${
                      isForbidden || disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'cursor-pointer hover:shadow-md'
                    }
                  `}
                >
                  <div className="grid grid-cols-2 gap-1.5 place-items-center">
                    {groupDots.map((dot, dotIndex) => (
                      <span
                        key={dotIndex}
                        className="block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: dot.filled
                            ? dot.tone
                            : 'transparent',
                          border: dot.filled
                            ? 'none'
                            : `2px solid ${dot.tone}`,
                          boxSizing: 'border-box',
                        }}
                      />
                    ))}
                  </div>

                  {allSelected && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#22C55E] text-[8px] font-black text-white">
                      ✓
                    </span>
                  )}

                  {isForbidden && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#EF4444] text-[8px] font-black text-white">
                      ✕
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Helper Text */}
      <p className="mt-2 text-[9px] font-semibold text-[#98A2B3] text-center">
        {isMaxSelected && !disabled
          ? 'Selection full — deselect to pick more.'
          : forbiddenGroup
          ? 'Some groups cannot combine. Tap a group to toggle all its numbers.'
          : `Pick up to ${maxSelections} (0–9, A–F). Tap the right-side button to toggle a group.`}
      </p>
    </section>
  );
};

export default LottoNumberGrid;