// src/marketplace/games/lotto/utils/constants.js

export const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

// Frozen LOTTO-01 selection shortcuts (LOTTO-01-Full-Game-Logic §13).
// GREEN  = top two horizontal rows     : 0 1 2 3 / 4 5 6 7
// RED    = bottom two horizontal rows  : 8 9 A B / C D E F
// YELLOW = left two vertical columns   : 0 1 / 4 5 / 8 9 / C D
// BLUE   = right two vertical columns  : 2 3 / 6 7 / A B / E F
export const COLOR_GROUPS = {
  GREEN: ['0', '1', '2', '3', '4', '5', '6', '7'],
  RED: ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F'],
  YELLOW: ['0', '1', '4', '5', '8', '9', 'C', 'D'],
  BLUE: ['2', '3', '6', '7', 'A', 'B', 'E', 'F'],
};

// Forbidden opposite pairs (would select all 16 / 100%):
// GREEN + RED  |  YELLOW + BLUE
export const FORBIDDEN_GROUP_PAIRS = [['GREEN', 'RED'], ['YELLOW', 'BLUE']];

export const GROUP_COLORS = {
  GREEN: 'green',
  RED: 'red',
  YELLOW: 'yellow',
  BLUE: 'blue',
};

// Canonical duration (seconds) per backend category.
export const CATEGORY_DURATION_SECONDS = {
  THIRTY_SEC: 30,
  ONE_MIN: 60,
  THREE_MIN: 180,
  FIVE_MIN: 300,
};

export const MULTIPLIERS = {
  1: 16,
  2: 8,
  3: 5.33,
  4: 4,
  5: 3.2,
  6: 2.67,
  7: 2.29,
  8: 2,
  9: 1.78,
  10: 1.6,
  11: 1.45,
  12: 1.33,
  13: 1.23,
  14: 1.14,
  15: 1.07,
  16: 1,
};

export const LOTTO_CONSTANTS = {
  NUMBER_COUNT: 16, // 0-F
  MAX_SELECTIONS: 15,
  MIN_BET: 1,
  MAX_BET: 100000,
  PLATFORM_FEE: 0.03, // 3%
  // Single betting-cutoff boundary — MUST match the backend's
  // LOTTO_TICKET_CUTOFF_SECONDS. In the last CUTOFF_SECONDS of a period:
  // betting is closed (Buy Card shuts, taps are ignored) AND the backend has
  // already pre-computed the result this round will reveal at 00.
  CUTOFF_SECONDS: 5,
  CATEGORY: 'THIRTY_SEC',
  GAME_ID: '1',
};

export const PRESET_AMOUNTS = [10, 50, 100, 250, 500];