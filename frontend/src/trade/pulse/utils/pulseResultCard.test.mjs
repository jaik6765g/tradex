// ============================================================
// Pulse Trade result-card resolver — dependency-free checks.
// Run: node --test frontend/src/trade/pulse/utils/pulseResultCard.test.mjs
// (also runnable via: node frontend/src/trade/pulse/utils/pulseResultCard.test.mjs)
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The resolver is a pure TS module with no imports — load it by
// stripping types so the test needs no build step or extra deps.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'pulseResultCard.ts'), 'utf8');
const jsSource = source
  .replace(/^(export )?type[^;]+;/gm, '')
  .replace(/^export interface[\s\S]*?^}/gm, '')
  .replace(/:\s*PulseResultCardResolution/g, '')
  .replace(/:\s*PulseDirectionInput/g, '')
  .replace(/:\s*PulseOutcomeInput/g, '')
  .replace(/:\s*NormalizedDirection/g, '')
  .replace(/:\s*NormalizedOutcome/g, '')
  .replace(/:\s*ResolvePulseResultCardInput/g, '')
  .replace(/:\s*PriceMovementInput/g, '')
  .replace(/\}:\s*[A-Za-z_][A-Za-z0-9_.<>\[\] |]*\)/g, '})')
  .replace(/:\s*PulseResultCardDirection \| null/g, '')
  .replace(/:\s*PulseResultToneStyle/g, '')
  .replace(/:\s*string \| null \| undefined/g, '')
  .replace(/:\s*string/g, '')
  .replace(/\bexport function\b/g, 'function');
const factory = new Function(
  `${jsSource}; return { resolvePulseResultCard, normalizePulseDirection, normalizePulseOutcome, resolvePriceMovement, resolvePulseResultToneStyle };`,
);
const {
  resolvePulseResultCard,
  normalizePulseDirection,
  normalizePulseOutcome,
  resolvePriceMovement,
  resolvePulseResultToneStyle,
} = factory();

describe('pulseResultCard — required LONG/SHORT x WIN/LOSS mapping', () => {
  it('LONG + WIN -> UP card + GREEN', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'LONG', outcome: 'WIN' }), {
      card: 'UP',
      tone: 'GREEN',
      isWinLoss: true,
    });
  });

  it('LONG + LOSS -> DOWN card + RED', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'LONG', outcome: 'LOSS' }), {
      card: 'DOWN',
      tone: 'RED',
      isWinLoss: true,
    });
  });

  it('SHORT + WIN -> DOWN card + GREEN', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'SHORT', outcome: 'WIN' }), {
      card: 'DOWN',
      tone: 'GREEN',
      isWinLoss: true,
    });
  });

  it('SHORT + LOSS -> UP card + RED', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'SHORT', outcome: 'LOSS' }), {
      card: 'UP',
      tone: 'RED',
      isWinLoss: true,
    });
  });
});

describe('pulseResultCard — normalization (lowercase + aliases)', () => {
  it('lowercase values resolve identically', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'long', outcome: 'win' }), {
      card: 'UP',
      tone: 'GREEN',
      isWinLoss: true,
    });
    assert.deepEqual(resolvePulseResultCard({ direction: 'short', outcome: 'loss' }), {
      card: 'UP',
      tone: 'RED',
      isWinLoss: true,
    });
  });

  it('legacy WON/LOST aliases resolve like WIN/LOSS', () => {
    assert.equal(normalizePulseOutcome('WON'), 'WIN');
    assert.equal(normalizePulseOutcome('lost'), 'LOSS');
  });

  it('DRAW stays neutral and never WIN/LOSS', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: 'LONG', outcome: 'DRAW' }), {
      card: null,
      tone: 'NEUTRAL',
      isWinLoss: false,
    });
    assert.deepEqual(resolvePulseResultCard({ direction: 'SHORT', outcome: 'draw' }), {
      card: null,
      tone: 'NEUTRAL',
      isWinLoss: false,
    });
  });
});

describe('pulseResultCard — invalid / missing data never shows a movement card', () => {
  const cases = [
    { direction: null, outcome: null },
    { direction: undefined, outcome: undefined },
    { direction: '', outcome: '' },
    { direction: 'LONG', outcome: null },
    { direction: 'LONG', outcome: 'SETTLED' },
    { direction: 'LONG', outcome: 'OPEN' },
    { direction: 'LONG', outcome: 'SETTLING' },
    { direction: 'LONG', outcome: 'GARBAGE' },
    { direction: 'SIDEWAYS', outcome: 'DRAW' },
    { direction: null, outcome: 'DRAW' },
  ];

  for (const input of cases) {
    it(`no movement card for ${JSON.stringify(input)}`, () => {
      const resolved = resolvePulseResultCard(input);
      // Never invent UP/DOWN artwork from unknown data; colour may
      // still follow a KNOWN WIN/LOSS outcome (covered below).
      assert.equal(resolved.card, null);
      assert.equal(resolved.isWinLoss, false);
    });
  }

  it('unknown outcome never resolves to WIN/LOSS colours', () => {
    for (const outcome of ['SETTLED', 'OPEN', 'SETTLING', 'GARBAGE', '', null, undefined]) {
      const resolved = resolvePulseResultCard({ direction: 'LONG', outcome });
      assert.equal(resolved.isWinLoss, false);
      assert.equal(resolved.tone === 'GREEN' || resolved.tone === 'RED', false);
    }
  });

  it('unknown direction + WIN keeps GREEN but no movement card', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: '???', outcome: 'WIN' }), {
      card: null,
      tone: 'GREEN',
      isWinLoss: true,
    });
  });

  it('unknown direction + LOSS keeps RED but no movement card', () => {
    assert.deepEqual(resolvePulseResultCard({ direction: null, outcome: 'LOSS' }), {
      card: null,
      tone: 'RED',
      isWinLoss: true,
    });
  });

  it('normalizePulseDirection rejects non LONG/SHORT', () => {
    assert.equal(normalizePulseDirection('UP'), null);
    assert.equal(normalizePulseDirection(''), null);
    assert.equal(normalizePulseDirection(null), null);
  });
});

describe('pulseResultCard — price-based movement helper', () => {
  it('exit above entry -> UP', () => {
    assert.equal(resolvePriceMovement({ entryPrice: '100', exitPrice: '101' }), 'UP');
  });

  it('exit below entry -> DOWN', () => {
    assert.equal(resolvePriceMovement({ entryPrice: 200, exitPrice: 199.5 }), 'DOWN');
  });

  it('equal or unparseable prices -> null (no card)', () => {
    assert.equal(resolvePriceMovement({ entryPrice: '100', exitPrice: '100' }), null);
    assert.equal(resolvePriceMovement({ entryPrice: null, exitPrice: '100' }), null);
    assert.equal(resolvePriceMovement({ entryPrice: 'abc', exitPrice: '100' }), null);
  });
});
describe('pulseResultCard — GREEN (win) / RED (loss) card colour state', () => {
  it('GREEN tone -> green card (win)', () => {
    const style = resolvePulseResultToneStyle('GREEN');
    assert.equal(style.isWin, true);
    assert.equal(style.chip, '#22C55E');
    assert.equal(style.accent, '#16A34A');
    assert.match(style.frameFilter, /hue-rotate/);
  });

  it('RED tone -> red card (loss)', () => {
    const style = resolvePulseResultToneStyle('RED');
    assert.equal(style.isWin, false);
    assert.equal(style.chip, '#EF4444');
    assert.equal(style.accent, '#E5484D');
    assert.match(style.frameFilter, /hue-rotate/);
  });

  it('lowercase / padded tone values normalize', () => {
    assert.equal(resolvePulseResultToneStyle(' green ').isWin, true);
    assert.equal(resolvePulseResultToneStyle('red').chip, '#EF4444');
  });

  it('unknown / blank tone never resolves to the green WIN state', () => {
    for (const tone of ['', '   ', null, undefined, 'NEUTRAL', 'BLUE', 'GARBAGE']) {
      const style = resolvePulseResultToneStyle(tone);
      assert.equal(style.isWin, false);
      assert.notEqual(style.chip, '#22C55E');
      assert.notEqual(style.accent, '#16A34A');
    }
  });

  it('resolver tone drives the card colour end-to-end', () => {
    const win = resolvePulseResultCard({ direction: 'SHORT', outcome: 'WIN' });
    const loss = resolvePulseResultCard({ direction: 'SHORT', outcome: 'LOSS' });
    assert.equal(win.card, 'DOWN');
    assert.equal(resolvePulseResultToneStyle(win.tone).isWin, true);
    assert.equal(loss.card, 'UP');
    assert.equal(resolvePulseResultToneStyle(loss.tone).isWin, false);

    // DRAW keeps the existing neutral styling (unchanged behaviour).
    const draw = resolvePulseResultCard({ direction: 'LONG', outcome: 'DRAW' });
    assert.equal(resolvePulseResultToneStyle(draw.tone).chip, '#FF8F3D');
    assert.equal(resolvePulseResultToneStyle(draw.tone).isWin, false);
  });
});
