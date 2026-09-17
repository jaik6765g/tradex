import {
  buildWinPotentialLadder,
  buildWinPotentialTiers,
  getHighestWinPotential,
  getLowestWinPotential,
  normalizeWinStrategy,
  selectWinPotentialOption,
} from './lotto-win-strategy.util';

// Real-shaped ladder: 4 numbers staked, the other 12 at zero.
const sampleRows = [
  { option: '5', betCount: 6, winPotential: '2549.00' },
  { option: '9', betCount: 3, winPotential: '300.00' },
  { option: '7', betCount: 1, winPotential: '200.00' },
  { option: '3', betCount: 1, winPotential: '150.00' },
];

describe('lotto-win-strategy util', () => {
  describe('normalizeWinStrategy', () => {
    it('accepts the supported strategies case-insensitively', () => {
      expect(normalizeWinStrategy('high')).toBe('HIGH');
      expect(normalizeWinStrategy(' Medium ')).toBe('MEDIUM');
      expect(normalizeWinStrategy('LOW')).toBe('LOW');
      expect(normalizeWinStrategy('RANDOM')).toBe('RANDOM');
    });

    it('falls back to RANDOM for missing/unknown values', () => {
      expect(normalizeWinStrategy(null)).toBe('RANDOM');
      expect(normalizeWinStrategy(undefined)).toBe('RANDOM');
      expect(normalizeWinStrategy('')).toBe('RANDOM');
      expect(normalizeWinStrategy('HOUSE_ALWAYS_WINS')).toBe('RANDOM');
    });
  });

  describe('buildWinPotentialLadder', () => {
    it('always yields all 16 symbols with numeric values', () => {
      const ladder = buildWinPotentialLadder(sampleRows);

      expect(ladder).toHaveLength(16);
      expect(ladder.map((entry) => entry.option).sort()).toEqual(
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'].sort(),
      );
      expect(ladder.every((entry) => typeof entry.winPotential === 'number')).toBe(true);
    });

    it('sorts ascending by win potential then by symbol order', () => {
      const ladder = buildWinPotentialLadder(sampleRows);

      expect(ladder[ladder.length - 1].option).toBe('5');
      expect(getHighestWinPotential(ladder)).toBe(2549);
      expect(getLowestWinPotential(ladder)).toBe(0);

      // The first 12 entries are the zero-potential numbers in symbol order.
      expect(ladder.slice(0, 12).map((entry) => entry.option)).toEqual([
        '0', '1', '2', '4', '6', '8', 'A', 'B', 'C', 'D', 'E', 'F',
      ]);
      expect(ladder.slice(12).map((entry) => entry.option)).toEqual(['3', '7', '9', '5']);
    });

    it('merges duplicate rows and coerces string amounts', () => {
      const ladder = buildWinPotentialLadder([
        { option: 'a', betCount: '1', winPotential: '10.005' },
        { option: 'A', betCount: 2, winPotential: 5 },
        { option: 'not-a-symbol', betCount: 9, winPotential: 1000 },
      ]);

      const entry = ladder.find((item) => item.option === 'A')!;
      expect(entry.betCount).toBe(3);
      expect(entry.winPotential).toBe(15.01);
      // Unknown symbols are ignored, never create phantom entries.
      expect(ladder).toHaveLength(16);
    });
  });

  describe('selectWinPotentialOption', () => {
    const ladder = buildWinPotentialLadder(sampleRows);

    it('RANDOM never steers the draw', () => {
      expect(selectWinPotentialOption('RANDOM', ladder)).toBeNull();
    });

    it('HIGH picks the number with the highest win potential', () => {
      expect(selectWinPotentialOption('HIGH', ladder)?.option).toBe('5');
    });

    it('LOW picks a number with zero win potential (lowest)', () => {
      const picked = selectWinPotentialOption('LOW', ladder);
      expect(picked?.option).toBe('0');
      expect(picked?.winPotential).toBe(0);
    });

    it('MEDIUM picks the number closest to the mid-point of the range', () => {
      // range = [0, 2549] → mid-point 1274.5 → closest is '9' (300).
      expect(selectWinPotentialOption('MEDIUM', ladder)?.option).toBe('9');
    });

    it('returns null when no number carries any stake (random fallback)', () => {
      const empty = buildWinPotentialLadder([]);
      expect(selectWinPotentialOption('HIGH', empty)).toBeNull();
      expect(selectWinPotentialOption('MEDIUM', empty)).toBeNull();
      expect(selectWinPotentialOption('LOW', empty)).toBeNull();
    });

    it('breaks ties deterministically on the lowest symbol', () => {
      const tied = buildWinPotentialLadder([
        { option: 'C', betCount: 1, winPotential: 500 },
        { option: '4', betCount: 1, winPotential: 500 },
      ]);

      expect(selectWinPotentialOption('HIGH', tied)?.option).toBe('4');
      expect(selectWinPotentialOption('LOW', tied)?.option).toBe('0');
    });
  });

  describe('buildWinPotentialTiers', () => {
    it('bands numbers by the same rules the draw uses', () => {
      const tiers = buildWinPotentialTiers(buildWinPotentialLadder(sampleRows));

      expect(tiers.highest).toEqual(['5']);
      expect(tiers.medium).toEqual(['9']);
      expect(tiers.lowest).toEqual([
        '0', '1', '2', '4', '6', '8', 'A', 'B', 'C', 'D', 'E', 'F',
      ]);
    });

    it('handles an empty ladder without throwing', () => {
      expect(buildWinPotentialTiers([])).toEqual({
        highest: [],
        medium: [],
        lowest: [],
      });
    });
  });
});