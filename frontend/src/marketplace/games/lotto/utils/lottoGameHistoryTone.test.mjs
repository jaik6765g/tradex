// ============================================================
// Lotto game-history tone mapping — dependency-free checks.
// Run: node --test frontend/src/marketplace/games/lotto/utils/lottoGameHistoryTone.test.mjs
// Verifies that the Number + Even/Odd columns of the game history
// resolve to the drawn number's ACTUAL colour group (GREEN 0-7 /
// RED 8-F) — the same source the Colour column uses.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getNumberGroups, GROUP_TONE } from './lottoUi.js';

/**
 * Mirrors the history component's tone resolution — kept in sync with
 * LottoGameHistory.jsx (`groupTone`). If the component changes, this
 * must change with it.
 */
const historyToneFor = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]$/.test(normalized)) return null;
  const groups = getNumberGroups(normalized);
  return groups ? GROUP_TONE[groups.primary] : null;
};

/** Mirrors the component's even/odd derivation. */
const evenOddFor = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]$/.test(normalized)) return null;
  return parseInt(normalized, 16) % 2 === 0 ? 'Even' : 'Odd';
};

describe('lotto game history tone mapping', () => {
  it('maps every GREEN group number (0-7) to the GREEN tone', () => {
    for (const n of ['0', '1', '2', '3', '4', '5', '6', '7']) {
      assert.equal(historyToneFor(n), GROUP_TONE.GREEN, `symbol ${n}`);
      assert.equal(getNumberGroups(n).primary, 'GREEN', `symbol ${n}`);
    }
  });

  it('maps every RED group number (8-F) to the RED tone', () => {
    for (const n of ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F']) {
      assert.equal(historyToneFor(n), GROUP_TONE.RED, `symbol ${n}`);
      assert.equal(getNumberGroups(n).primary, 'RED', `symbol ${n}`);
    }
  });

  it('uses exactly the two group tones — no digit-position scheme', () => {
    const tones = new Set(
      '0123456789ABCDEF'.split('').map((n) => historyToneFor(n)),
    );
    assert.deepEqual([...tones].sort(), [GROUP_TONE.GREEN, GROUP_TONE.RED]);
  });

  it('Even/Odd derivation is by hex parity, independent of tone', () => {
    // GREEN group contains both parities
    assert.equal(evenOddFor('0'), 'Even');
    assert.equal(evenOddFor('1'), 'Odd');
    assert.equal(evenOddFor('4'), 'Even');
    assert.equal(evenOddFor('7'), 'Odd');
    // RED group contains both parities
    assert.equal(evenOddFor('8'), 'Even');
    assert.equal(evenOddFor('9'), 'Odd');
    assert.equal(evenOddFor('E'), 'Even');
    assert.equal(evenOddFor('F'), 'Odd');
  });

  it('lowercase and padded values normalize to the same tone', () => {
    assert.equal(historyToneFor('a'), GROUP_TONE.RED);
    assert.equal(historyToneFor(' f '), GROUP_TONE.RED);
    assert.equal(historyToneFor('3'), GROUP_TONE.GREEN);
    assert.equal(evenOddFor('c'), 'Even');
  });

  it('invalid / missing values resolve to no tone (never a colour)', () => {
    for (const bad of [null, undefined, '', 'G', 'X', '10', 'AB', 12]) {
      assert.equal(historyToneFor(bad), null, `input ${String(bad)}`);
      assert.equal(evenOddFor(bad), null, `input ${String(bad)}`);
    }
  });

  it('Number tone matches the Colour column primary chip for all 16 symbols', () => {
    for (const n of '0123456789ABCDEF'.split('')) {
      const groups = getNumberGroups(n);
      // history tone must equal the PRIMARY group colour shown in the Colour column
      assert.equal(historyToneFor(n), GROUP_TONE[groups.primary]);
    }
  });
});
