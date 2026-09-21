// ============================================================
// money.ts — exact decimal-string conversion checks.
// Run: node --test frontend/src/wallet/withdrawal/utils/money.test.mjs
// (also runnable via: node frontend/src/wallet/withdrawal/utils/money.test.mjs)
// ============================================================
//
// Pins the withdrawal screen's money math:
//   - tdxToUsdt (÷100)  — the conversion behind "You will receive"
//     (1000 TDX MUST be 10 USDT, never ~1e-17). The "Withdrawable
//     Balance" line shows the raw TDX balance — no conversion.
//   - usdtToTdx (×100)  — limit conversions (min/max USDT → TDX)
//   - 18-decimal precision + truncation (never rounded, never a float)
//   - invalid input → null (the screen must show "Conversion unavailable",
//     never a silent 0.00 USDT)
//
// money.ts is a pure TS module with no imports — its (simple) type
// annotations are stripped so the test needs no build step, mirroring the
// pulseResultCard.test.mjs convention.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'money.ts'), 'utf8');

const jsSource = source
  // Type predicates: `): value is string`
  .replace(/\)\s*:\s*value is string/g, ')')
  // splitDecimal's object return type: `): { sign: -1 | 1; ... } | null`
  .replace(/\)\s*:\s*\{[^{}]*\}\s*\|\s*null/g, ')')
  // `): -1 | 0 | 1 | null`
  .replace(/\)\s*:\s*-1\s*\|\s*0\s*\|\s*1\s*\|\s*null/g, ')')
  // Local annotated const: `const sign: -1 | 1 =`
  .replace(/const sign:\s*-1\s*\|\s*1\s*=/g, 'const sign =')
  // `as -1 | 1` casts
  .replace(/\s*as\s*-1\s*\|\s*1/g, '')
  // Union annotations — longest first
  .replace(/:\s*string\s*\|\s*number\s*\|\s*null\s*\|\s*undefined/g, '')
  .replace(/:\s*string\s*\|\s*null/g, '')
  .replace(/:\s*string\s*\|\s*number/g, '')
  .replace(/:\s*string/g, '')
  .replace(/:\s*number/g, '')
  .replace(/:\s*unknown/g, '')
  // `export function` is invalid inside `new Function`
  .replace(/\bexport function\b/g, 'function');

const factory = new Function(
  `${jsSource}; return { isDecimalString, isPositiveDecimal, trimDecimalZeros, formatDecimalString, compareDecimalStrings, multiplyDecimalByInteger, divideDecimalByInteger, usdtToTdx, tdxToUsdt };`,
);
const {
  isDecimalString,
  isPositiveDecimal,
  trimDecimalZeros,
  formatDecimalString,
  compareDecimalStrings,
  multiplyDecimalByInteger,
  divideDecimalByInteger,
  usdtToTdx,
  tdxToUsdt,
} = factory();

describe('money.ts loads', () => {
  it('exposes every export the withdrawal screen consumes', () => {
    for (const fn of [
      isDecimalString,
      isPositiveDecimal,
      trimDecimalZeros,
      formatDecimalString,
      compareDecimalStrings,
      multiplyDecimalByInteger,
      divideDecimalByInteger,
      usdtToTdx,
      tdxToUsdt,
    ]) {
      assert.equal(typeof fn, 'function', 'missing export from money.ts');
    }
  });
});

describe('tdxToUsdt — TDX→USDT (÷100), the withdrawal-screen conversion', () => {
  it('converts 1000 TDX = 10 USDT (regression: was 1e-17 → shown as 0.00)', () => {
    assert.equal(tdxToUsdt('1000'), '10');
  });

  it('converts 16430.17 TDX = 164.3017 USDT (regression: was 1.643e-16)', () => {
    assert.equal(tdxToUsdt('16430.17'), '164.3017');
  });

  it('converts 100 TDX = 1 USDT', () => {
    assert.equal(tdxToUsdt('100'), '1');
  });

  it('converts 50 TDX = 0.5 USDT (0.50 displayed)', () => {
    assert.equal(tdxToUsdt('50'), '0.5');
    assert.equal(formatDecimalString(tdxToUsdt('50')), '0.50');
  });

  it('converts 1 TDX = 0.01 USDT', () => {
    assert.equal(tdxToUsdt('1'), '0.01');
  });

  it('converts 0.5 TDX = 0.005 USDT', () => {
    assert.equal(tdxToUsdt('0.5'), '0.005');
  });
});

describe('tdxToUsdt — sign, padding and fail-closed conversion', () => {
  it('converts 0 TDX = 0 and keeps negative signs exact', () => {
    assert.equal(tdxToUsdt('0'), '0');
    assert.equal(tdxToUsdt('-100'), '-1');
    assert.equal(tdxToUsdt('-0.5'), '-0.005');
  });

  it('trims insignificant zeros and accepts padded whitespace', () => {
    assert.equal(tdxToUsdt('100.00'), '1');
    assert.equal(tdxToUsdt(' 100 '), '1');
  });

  it('returns null (Conversion unavailable) for invalid input — never a fake 0', () => {
    for (const bad of [
      '',
      '   ',
      'abc',
      '1e3',
      'NaN',
      'Infinity',
      '12,5',
      '100.',
      '.5',
      '+100',
      // Leading zeros are non-canonical per isDecimalString (pre-existing
      // semantics; the screen rejects them as AMOUNT_INVALID).
      '001000',
    ]) {
      assert.equal(tdxToUsdt(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('displays through formatDecimalString with 2-decimal truncation', () => {
    assert.equal(formatDecimalString(tdxToUsdt('16430.17')), '164.30');
    assert.equal(formatDecimalString(tdxToUsdt('1000')), '10.00');
    assert.equal(formatDecimalString(tdxToUsdt('100')), '1.00');
    assert.equal(formatDecimalString(tdxToUsdt('50')), '0.50');
    assert.equal(formatDecimalString(tdxToUsdt('1')), '0.01');
  });
});

describe('divideDecimalByInteger — 18-decimal precision + truncation', () => {
  it('round-trips an 18dp-safe amount exactly', () => {
    assert.equal(divideDecimalByInteger('1643017', 100), '16430.17');
  });

  it('truncates (never rounds) beyond maxDecimals', () => {
    // 1e-18 ÷ 100 = 1e-20 → below 18dp resolution → exact 0
    assert.equal(divideDecimalByInteger('0.000000000000000001', 100), '0');
    // Repeating decimal: truncates at 18 digits, never rounds up
    assert.equal(divideDecimalByInteger('1', 3), '0.333333333333333333');
    assert.equal(divideDecimalByInteger('2', 3), '0.666666666666666666');
  });

  it('honours an explicit maxDecimals bound', () => {
    assert.equal(divideDecimalByInteger('1', 100, 2), '0.01');
    assert.equal(divideDecimalByInteger('1', 3, 2), '0.33');
    assert.equal(divideDecimalByInteger('1', 7, 4), '0.1428');
    // Module convention: trailing fractional zeros are trimmed ('164.3'),
    // the display formatter restores the 2-dp view ('164.30').
    assert.equal(divideDecimalByInteger('16430.17', 100, 2), '164.3');
    assert.equal(formatDecimalString(divideDecimalByInteger('16430.17', 100, 2)), '164.30');
  });

  it('stays exact on very large values (no float drift)', () => {
    assert.equal(
      divideDecimalByInteger('123456789012345678.123456789012345678', 100),
      '1234567890123456.781234567890123456',
    );
  });

  it('fails closed: zero/negative/non-integer/unsafe divisor → null', () => {
    assert.equal(divideDecimalByInteger('1000', 0), null);
    assert.equal(divideDecimalByInteger('1000', -100), null);
    assert.equal(divideDecimalByInteger('1000', 12.5), null);
    assert.equal(divideDecimalByInteger('1000', Number.MAX_SAFE_INTEGER), null);
  });

  it('fails closed: invalid maxDecimals → null', () => {
    assert.equal(divideDecimalByInteger('1000', 100, -1), null);
    assert.equal(divideDecimalByInteger('1000', 100, 2.5), null);
  });
});

describe('usdtToTdx — USDT→TDX (×100) limit conversions stay exact', () => {
  it('converts limits exactly (min 5 USDT → 500 TDX, max 500 USDT → 50000 TDX)', () => {
    assert.equal(usdtToTdx('5'), '500');
    assert.equal(usdtToTdx('500'), '50000');
  });

  it('keeps prior behaviour intact', () => {
    assert.equal(usdtToTdx('10'), '1000');
    assert.equal(usdtToTdx('0.01'), '1');
    assert.equal(usdtToTdx('164.30'), '16430');
    assert.equal(usdtToTdx('1'), '100');
    assert.equal(usdtToTdx('0.5'), '50');
    assert.equal(usdtToTdx('0'), '0');
  });

  it('returns null for invalid input', () => {
    assert.equal(usdtToTdx('abc'), null);
    assert.equal(usdtToTdx(''), null);
    assert.equal(usdtToTdx('1e2'), null);
  });

  it('round-trips through tdxToUsdt without drift', () => {
    for (const tdx of ['1000', '16430.17', '100', '50', '1', '0.01']) {
      assert.equal(usdtToTdx(tdxToUsdt(tdx)), trimDecimalZeros(tdx), `round-trip failed for ${tdx}`);
    }
  });
});

describe('multiplyDecimalByInteger — exact integer factor math', () => {
  it('multiplies exactly (regression guard for usdtToTdx)', () => {
    assert.equal(multiplyDecimalByInteger('1', 100), '100');
    assert.equal(multiplyDecimalByInteger('0.01', 100), '1');
    assert.equal(multiplyDecimalByInteger('123.45', 100), '12345');
    assert.equal(multiplyDecimalByInteger('0', 100), '0');
    assert.equal(multiplyDecimalByInteger('abc', 100), null);
    assert.equal(multiplyDecimalByInteger('1', 0), '0');
  });
});

describe('trimDecimalZeros — fraction-only trimming (integer balances stay valid)', () => {
  it('never touches significant integer trailing zeros', () => {
    assert.equal(trimDecimalZeros('1000'), '1000');
    assert.equal(trimDecimalZeros('100'), '100');
    assert.equal(trimDecimalZeros('10'), '10');
    assert.equal(trimDecimalZeros('0'), '0');
  });

  it('trims fraction trailing zeros and drops the dot when the fraction empties', () => {
    assert.equal(trimDecimalZeros('16430.17'), '16430.17');
    assert.equal(trimDecimalZeros('100.50'), '100.5');
    assert.equal(trimDecimalZeros('100.00'), '100');
    assert.equal(trimDecimalZeros('0.500'), '0.5');
    assert.equal(trimDecimalZeros('0.000'), '0');
    assert.equal(trimDecimalZeros('-0.500'), '-0.5');
    assert.equal(trimDecimalZeros('-1000'), '-1000');
  });

  it('passes invalid input through unchanged', () => {
    assert.equal(trimDecimalZeros('abc'), 'abc');
    assert.equal(trimDecimalZeros(''), '');
  });

  it('results remain valid exact decimal strings (screen re-validation safe)', () => {
    for (const v of ['1000', '100', '10', '0', '16430.17', '100.50', '0.500', '-0.500']) {
      assert.equal(isDecimalString(trimDecimalZeros(v)), true, `invalid output for ${v}`);
    }
  });
});

describe('screen helper sanity (no floats introduced)', () => {
  it('classifies amounts for gating and comparison', () => {
    assert.equal(isPositiveDecimal('0'), false);
    assert.equal(isPositiveDecimal('1000'), true);
    assert.equal(isDecimalString('16430.17'), true);
    assert.equal(compareDecimalStrings('1000', '500'), 1);
    assert.equal(compareDecimalStrings('1000', '50000'), -1);
    assert.equal(compareDecimalStrings('abc', '1'), null);
  });

  it('formats missing values as 0.00 only for display fallbacks', () => {
    assert.equal(formatDecimalString(null), '0.00');
    assert.equal(formatDecimalString(undefined), '0.00');
    assert.equal(formatDecimalString('0'), '0.00');
  });
});
