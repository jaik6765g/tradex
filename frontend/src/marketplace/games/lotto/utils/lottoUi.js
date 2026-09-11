// src/marketplace/games/lotto/utils/lottoUi.js
// Shared presentation helpers for the premium Lotto UI.
// Pure functions are framework-agnostic (unit tested in lottoUi.test.mjs).
// The hook at the bottom is browser-only and used for responsive layouts.

import { useEffect, useState } from 'react';

import { COLOR_GROUPS } from './lottoState.js';

// ---------------------------------------------------------------------------
// Symbol → colour tone (visual only; does not change game rules)
// ---------------------------------------------------------------------------

/**
 * Maps a hex symbol (0-F) to its visual colour group.
 * @param {string|number|undefined} symbol
 * @returns {'green'|'red'|'yellow'|'cyan'|'neutral'}
 */
export const symbolToneName = (symbol) => {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  const tones = {
    0: 'green', 1: 'green', 2: 'green', 3: 'green',
    4: 'red', 5: 'red', 6: 'red', 7: 'red',
    8: 'yellow', 9: 'yellow', A: 'yellow', B: 'yellow',
    C: 'cyan', D: 'cyan', E: 'cyan', F: 'cyan',
  };
  return tones[normalized] ?? 'neutral';
};

/**
 * CSS modifier suffix for the lotto-num / lotto-result-dot components.
 * @param {string|number|undefined} symbol
 * @returns {string} e.g. 'lotto-num--green' (cyan fallback for unknown)
 */
export const symbolToneClassName = (symbol) => {
  const tone = symbolToneName(symbol);
  if (tone === 'neutral') {
    return 'lotto-num--cyan';
  }
  return `lotto-num--${tone}`;
};

/** Dice-face cell modifier for a symbol. */
export const diceCellToneClassName = (symbol) => {
  const tone = symbolToneName(symbol);
  return `lotto-dice-cell--${tone}`;
};

/** Small indicator-dot modifier for a symbol (lotto-num-dot instances). */
export const symbolDotToneClassName = (symbol) => {
  const tone = symbolToneName(symbol);
  return `lotto-num-dot--${tone}`;
};

/** Recent-result chip modifier for a symbol (lotto-result-dot instances). */
export const resultDotToneClassName = (symbol) => {
  const tone = symbolToneName(symbol);
  return `lotto-result-dot--${tone}`;
};

/**
 * Deterministic CSS colour for a symbol dot (used by number chips).
 * @param {string|number|undefined} symbol
 * @returns {string}
 */
export const symbolHexColor = (symbol) => {
  const tones = {
    green: '#34d399',
    red: '#fb7185',
    yellow: '#fbbf24',
    cyan: '#22d3ee',
    neutral: '#94a3b8',
  };
  return tones[symbolToneName(symbol)];
};

// ---------------------------------------------------------------------------
// Countdown helpers
// ---------------------------------------------------------------------------

/**
 * Splits a whole-second countdown into padded MM:SS parts.
 * @param {number} seconds
 * @returns {{ minutes: string, seconds: string, display: string }}
 */
export const toCountdownParts = (seconds) => {
  const safe = Number.isFinite(Number(seconds))
    ? Math.max(0, Math.floor(Number(seconds)))
    : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return {
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(remainder).padStart(2, '0'),
    display: `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`,
  };
};

/**
 * Progressive ring percentage for the countdown ring (0..100).
 * @param {number} remainingSeconds
 * @param {number} totalSeconds
 * @returns {number}
 */
export const toRingPercent = (remainingSeconds, totalSeconds) => {
  const total = Number(totalSeconds);
  const remaining = Number(remainingSeconds);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(remaining)) return 0;
  return Math.min(100, Math.max(0, (remaining / total) * 100));
};

// ---------------------------------------------------------------------------
// Display formatting helpers
// ---------------------------------------------------------------------------

/**
 * Shortens a long id for compact UI ("…" middle truncation).
 * @param {string|number|null|undefined} id
 * @param {number} max - max total characters
 * @returns {string}
 */
export const shortenId = (id, max = 18) => {
  if (id === null || id === undefined || id === '') {
    return '—';
  }
  const text = String(id);
  const limit = Math.max(8, Math.floor(max));
  if (text.length <= limit) {
    return text;
  }
  const head = Math.ceil(limit * 0.6);
  const tail = limit - head;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
};

/** Human friendly result-mode label (SERVER_RANDOM → "Provably fair"). */
export const resultModeLabel = (mode) => {
  const labels = {
    SERVER_RANDOM: 'Server random',
    ADMIN_RESULT: 'Admin result',
    VERIFIED_RANDOM: 'Verified random',
  };
  const key = String(mode ?? '').trim().toUpperCase();
  if (labels[key]) {
    return labels[key];
  }
  return mode ? String(mode).replace(/_/g, ' ').toLowerCase() : 'Fair';
};
// ---------------------------------------------------------------------------
// Status → premium badge class maps (dark theme)
// ---------------------------------------------------------------------------

/**
 * Badge tone for a normalized round status.
 * @param {string} status
 * @returns {string} lotto-badge--* modifier
 */
export const roundStatusBadgeClass = (status) => {
  const map = {
    OPEN: 'lotto-badge--open',
    CUTOFF: 'lotto-badge--amber',
    DRAWING: 'lotto-badge--drawing',
    RESULTED: 'lotto-badge--neutral',
    SETTLED: 'lotto-badge--neutral',
    FAILED: 'lotto-badge--danger',
    CANCELLED: 'lotto-badge--danger',
    REFUNDED: 'lotto-badge--amber',
  };
  return map[String(status ?? '').toUpperCase()] ?? 'lotto-badge--neutral';
};

/**
 * Badge tone for a normalized ticket status.
 * @param {string} status
 * @returns {string} lotto-badge--* modifier
 */
export const ticketStatusBadgeClass = (status) => {
  const map = {
    ACTIVE: 'lotto-badge--drawing',
    CUTOFF: 'lotto-badge--amber',
    WIN: 'lotto-badge--open',
    LOSS: 'lotto-badge--danger',
    SETTLED: 'lotto-badge--neutral',
    REFUNDED: 'lotto-badge--amber',
    CANCELLED: 'lotto-badge--danger',
  };
  return map[String(status ?? '').toUpperCase()] ?? 'lotto-badge--neutral';
};

// ---------------------------------------------------------------------------
// Responsive hook
// ---------------------------------------------------------------------------

/**
 * Returns whether the current viewport is below `breakpoint` px
 * (defaults to the Bootstrap `sm` boundary, 640px).
 * Falls back to `false` (desktop) in non-browser environments.
 * @param {number} breakpoint
 * @returns {boolean}
 */
export const useCompactView = (breakpoint = 640) => {
  const query = `(max-width: ${breakpoint}px)`;
  const getMatches = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  };

  const [isCompact, setIsCompact] = useState(() => getMatches());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(query);
    const onChange = (event) => setIsCompact(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isCompact;
};

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/**
 * True when the group should render as "partially selected".
 * @param {string[]} numbers
 * @param {string[]} selectedNumbers
 * @returns {boolean}
 */
export const isGroupPartiallySelected = (numbers, selectedNumbers) => {
  if (!Array.isArray(numbers) || !Array.isArray(selectedNumbers)) return false;
  const selected = new Set(selectedNumbers);
  const inGroup = numbers.filter((n) => selected.has(n)).length;
  return inGroup > 0 && inGroup < numbers.length;
};

/**
 * True when every member of the group is already selected.
 * @param {string[]} numbers
 * @param {string[]} selectedNumbers
 * @returns {boolean}
 */
export const isGroupFullySelected = (numbers, selectedNumbers) => {
  if (!Array.isArray(numbers) || !Array.isArray(selectedNumbers)) return false;
  const selected = new Set(selectedNumbers);
  return numbers.length > 0 && numbers.every((n) => selected.has(n));
};

// ---------------------------------------------------------------------------
// Overlapping group helpers (each number belongs to TWO groups)
// ---------------------------------------------------------------------------

/** Hex tone per group key. */
export const GROUP_TONE = {
  GREEN:  '#22C55E',
  RED:    '#EF4444',
  YELLOW: '#F59E0B',
  BLUE:   '#06B6D4',
};

/** Valid Lotto result symbols. */
const VALID_RESULT_VALUES = new Set([
  '0', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
]);

/**
 * Returns the two overlapping groups a number belongs to.
 * primary   = GREEN (0-7) or RED (8-F)
 * secondary = YELLOW or BLUE (alternate pattern)
 *
 * Works with either uppercase or lowercase COLOR_GROUPS keys — normalizes
 * the input map before lookup.
 *
 * @param {string|number} num
 * @returns {{ primary: 'GREEN'|'RED', secondary: 'YELLOW'|'BLUE' } | null}
 */
export const getNumberGroups = (num) => {
  const value = String(num ?? '').trim().toUpperCase();

  if (!VALID_RESULT_VALUES.has(value)) {
    return null;
  }

  // Normalize COLOR_GROUPS keys to uppercase (handles either shape)
  const groups = {};
  Object.entries(COLOR_GROUPS || {}).forEach(([k, v]) => {
    groups[String(k).toUpperCase()] = Array.isArray(v) ? v : [];
  });

  const isIn = (g) => groups[g].includes(value);

  return {
    primary:   isIn('GREEN') ? 'GREEN' : 'RED',
    secondary: isIn('YELLOW') ? 'YELLOW' : 'BLUE',
  };
};

/**
 * 2×2 dot-face patterns per group. Each pattern is an array of 4 dot
 * descriptors ordered: top-left, top-right, bottom-left, bottom-right.
 *
 * GREEN  : ● ● / ○ ○   RED : ○ ○ / ● ●
 * YELLOW: ● ○ / ● ○   BLUE: ○ ● / ○ ●
 */
export const DOT_PATTERNS_2x2 = {
  GREEN: [
    { filled: true },
    { filled: true },
    { filled: false },
    { filled: false },
  ],
  RED: [
    { filled: false },
    { filled: false },
    { filled: true },
    { filled: true },
  ],
  YELLOW: [
    { filled: true },
    { filled: false },
    { filled: true },
    { filled: false },
  ],
  BLUE: [
    { filled: false },
    { filled: true },
    { filled: false },
    { filled: true },
  ],
};