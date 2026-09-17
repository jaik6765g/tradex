// src/marketplace/games/lotto/components/LottoNumberGrid.jsx

import React from 'react';

import { GROUP_TONE } from '../utils/lottoUi';
import { COLOR_GROUPS } from '../utils/lottoState';
import { getBallImage } from '../utils/ballAssets';

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
  disabled,
  maxSelections,
  forbiddenGroup,
  selectionError,
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
    <section className="w-full rounded-[16px] border border-[#33333E] bg-gradient-to-br from-[#2C2C36] to-[#1F1F27] p-3 shadow-md">
      <div className="space-y-2">
        {rows.map((row, index) => {
          // Row 0 → GREEN, Row 1 → RED, Row 2 → YELLOW, Row 3 → BLUE
          const groupDef = COLOR_GROUP_DEFS[index];

          const isForbidden = forbiddenGroup === groupDef.key;
          const groupDots = GROUP_DOT_PATTERNS[groupDef.key];

          return (
            <div key={row.color} className="grid grid-cols-5 gap-2">
              {/* 4 Numbers */}
              {row.numbers.map((value) => {
                const selected = selectedNumbers.includes(value);
                const isDisabled = disabled || (!selected && isMaxSelected);
                const ballImage = getBallImage(value);
                const isBlocked = !selected && isDisabled;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => !isDisabled && onToggleNumber(value)}
                    disabled={isDisabled}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Remove' : 'Pick'} number ${value}`}
                    className={`
                      relative mx-auto flex h-11 w-11 items-center justify-center rounded-full
                      transition-all duration-150 active:scale-95
                      ${
                        selected
                          ? 'scale-105 ring-2 ring-[#FB923C] shadow-[0_0_14px_rgba(251,146,60,0.55)]'
                          : 'hover:scale-105'
                      }
                      ${
                        isBlocked
                          ? 'opacity-35 cursor-not-allowed'
                          : 'cursor-pointer'
                      }
                    `}
                  >
                    {ballImage ? (
                      // The ball artwork has an opaque (black) background, so the
                      // image is zoomed slightly and clipped to a circle: the ball
                      // fills the circle and no background ever shows.
                      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                        <img
                          src={ballImage}
                          alt={`Ball ${value}`}
                          draggable={false}
                          className="pointer-events-none h-[112%] w-[112%] max-w-none select-none object-cover"
                        />
                      </span>
                    ) : (
                      <span className="text-[15px] font-black text-white">
                        {value}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Group quick-select (5th column) — CIRCLE, same shape as the
                  number balls. Purely clickable: no selected ring, no badge and
                  no dimming. Every tap routes to onToggleGroup, which opens the
                  colour bet Buy Card; the forbidden-pair rule is enforced in one
                  place only (handleBetSelection). */}
              <button
                type="button"
                onClick={() =>
                  !disabled && onToggleGroup?.(groupDef.key, groupDef.numbers)
                }
                disabled={disabled}
                aria-label={`Bet on ${groupDef.label} group (${groupDef.range})`}
                title={
                  isForbidden
                    ? `${groupDef.label} cannot combine with the selected group`
                    : `${groupDef.label}: ${groupDef.range}`
                }
                className={`
                  mx-auto flex h-11 w-11 items-center justify-center
                  rounded-full border border-[#3A3A46]
                  bg-gradient-to-b from-[#24242E] to-[#1C1C24] shadow-sm
                  transition-all duration-150 active:scale-95
                  ${
                    disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'cursor-pointer hover:shadow-md'
                  }
                `}
              >
                <div className="grid grid-cols-2 gap-1.5 place-items-center">
                  {groupDots.map((dot, dotIndex) => (
                    <span
                      key={dotIndex}
                      className="block w-2.5 h-2.5 rounded-full"
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
              </button>
            </div>
          );
        })}
      </div>

      {/* Blocked-action feedback (e.g. a colour group that would cover all 16
          outcomes). Replaces the old red ✕ badge with a single muted line so the
          tiles themselves stay purely clickable. */}
      {selectionError && (
        <p className="mt-2 text-center text-[10px] font-semibold text-[#F59E0B]">
          {selectionError}
        </p>
      )}
    </section>
  );
};

export default LottoNumberGrid;