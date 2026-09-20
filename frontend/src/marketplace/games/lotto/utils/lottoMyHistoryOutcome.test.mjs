// ============================================================
// Lotto MY HISTORY — number colour + win/loss outcome checks.
// Run: node --test frontend/src/marketplace/games/lotto/utils/lottoMyHistoryOutcome.test.mjs
//
// Locks the two conventions of the My History card:
//   1) number chips use the number's ACTUAL colour group
//      (GREEN 0-7 / RED 8-F) — the same source as the game-history
//      Number column and the result popup, NOT the 4-tone grid scheme;
//   2) settled tickets always resolve to a clear WIN or LOSS — an
//      ambiguous "SETTLED" is never shown in the outcome badge.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { symbolGroupTone, GROUP_TONE } from './lottoUi.js';
import { deriveTicketOutcomeStatus } from './lottoState.js';

describe('lotto my-history number colour', () => {
  it('maps every GREEN group number (0-7) to the GREEN tone', () => {
    for (const n of ['0', '1', '2', '3', '4', '5', '6', '7']) {
      assert.equal(symbolGroupTone(n), GROUP_TONE.GREEN, `symbol ${n}`);
    }
  });

  it('maps every RED group number (8-F) to the RED tone', () => {
    for (const n of ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F']) {
      assert.equal(symbolGroupTone(n), GROUP_TONE.RED, `symbol ${n}`);
    }
  });

  it('uses exactly the two group tones — no digit-position scheme', () => {
    const tones = new Set(
      '0123456789ABCDEF'.split('').map((n) => symbolGroupTone(n)),
    );
    assert.deepEqual([...tones].sort(), [GROUP_TONE.GREEN, GROUP_TONE.RED]);
  });

  it('normalizes lowercase, padded and numeric symbols', () => {
    assert.equal(symbolGroupTone('a'), GROUP_TONE.RED);
    assert.equal(symbolGroupTone(' f '), GROUP_TONE.RED);
    assert.equal(symbolGroupTone('3'), GROUP_TONE.GREEN);
    assert.equal(symbolGroupTone(0), GROUP_TONE.GREEN);
  });

  it('invalid / missing symbols resolve to no tone (never a colour)', () => {
    for (const bad of [null, undefined, '', 'G', 'X', '10', 'AB', 12]) {
      assert.equal(symbolGroupTone(bad), null, `input ${String(bad)}`);
    }
  });
});

describe('lotto my-history win/loss display status', () => {
  it('keeps explicit WIN and LOSS statuses (case-insensitive)', () => {
    assert.equal(deriveTicketOutcomeStatus('WIN', 250), 'WIN');
    assert.equal(deriveTicketOutcomeStatus('LOSS', 0), 'LOSS');
    assert.equal(deriveTicketOutcomeStatus('win', 5), 'WIN');
    assert.equal(deriveTicketOutcomeStatus('loss', 0), 'LOSS');
  });

  it('derives WIN for a settled ticket with a payout', () => {
    assert.equal(deriveTicketOutcomeStatus('SETTLED', 100), 'WIN');
    assert.equal(deriveTicketOutcomeStatus('SETTLED', '12.5'), 'WIN');
  });

  it('derives LOSS for a settled ticket with no payout — never "SETTLED"', () => {
    assert.equal(deriveTicketOutcomeStatus('SETTLED', 0), 'LOSS');
    assert.equal(deriveTicketOutcomeStatus('SETTLED', null), 'LOSS');
    assert.equal(deriveTicketOutcomeStatus('SETTLED', undefined), 'LOSS');
    assert.equal(deriveTicketOutcomeStatus('SETTLED', Number.NaN), 'LOSS');
  });

  it('passes refunded / cancelled outcomes through unchanged', () => {
    assert.equal(deriveTicketOutcomeStatus('REFUNDED', 0), 'REFUNDED');
    assert.equal(deriveTicketOutcomeStatus('CANCELLED', 0), 'CANCELLED');
  });

  it('in-flight tickets report PENDING (no fabricated outcome)', () => {
    assert.equal(deriveTicketOutcomeStatus('ACTIVE', 0), 'PENDING');
    assert.equal(deriveTicketOutcomeStatus('CUTOFF', 0), 'PENDING');
    assert.equal(deriveTicketOutcomeStatus(null, 0), 'PENDING');
    assert.equal(deriveTicketOutcomeStatus('SOMETHING_ELSE', 0), 'PENDING');
  });
});
