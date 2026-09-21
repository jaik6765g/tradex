// frontend/src/wallet/withdrawal/utils/money.ts
//
// Exact decimal-string helpers for withdrawal display and limit checks.
// Financial values MUST NOT use floating-point arithmetic: every comparison
// operates on normalized decimal strings, mirroring the backend's
// Decimal.js enforcement (100 TDX = 1 USDT, exact shifts by powers of ten
// only).

/** True when the value is an exact decimal string usable for comparisons. */
export function isDecimalString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value.trim())
  );
}

function splitDecimal(raw: string): { sign: -1 | 1; int: string; frac: string } | null {
  if (!isDecimalString(raw)) return null;
  const text = raw.trim();
  const sign: -1 | 1 = text.startsWith('-') ? -1 : 1;
  const unsigned = sign === -1 ? text.slice(1) : text;
  const [intRaw, fracRaw = ''] = unsigned.split('.');
  return {
    sign,
    int: intRaw.replace(/^0+(?=\d)/, ''),
    frac: fracRaw,
  };
}

/**
 * Compares two exact decimal strings: -1 / 0 / 1.
 * Returns null when either operand is not a valid decimal string.
 */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 | null {
  const left = splitDecimal(a);
  const right = splitDecimal(b);
  if (!left || !right) return null;

  if (left.sign !== right.sign) {
    return left.sign < right.sign ? -1 : 1;
  }

  const rawMagnitude = (() => {
    const lenDiff = left.int.length - right.int.length;
    if (lenDiff !== 0) return lenDiff > 0 ? 1 : -1;
    if (left.int !== right.int) return left.int > right.int ? 1 : -1;
    const maxFrac = Math.max(left.frac.length, right.frac.length);
    const lf = left.frac.padEnd(maxFrac, '0');
    const rf = right.frac.padEnd(maxFrac, '0');
    if (lf === rf) return 0;
    return lf > rf ? 1 : -1;
  })();

  if (rawMagnitude === 0) return 0;
  return left.sign === 1
    ? (rawMagnitude as -1 | 1)
    : ((0 - rawMagnitude) as -1 | 1);
}

/** True when the value is a positive decimal amount (> 0). */
export function isPositiveDecimal(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isDecimalString(value) &&
    compareDecimalStrings(value, '0') === 1
  );
}

/**
 * Trims insignificant trailing zeros without ever touching a float.
 * Returns the original string when it is not an exact decimal.
 *
 * Only the FRACTION's trailing zeros are removed; the integer part is never
 * touched (trailing zeros there are significant: '1000' must stay '1000').
 * The previous implementation appended `int + '.' + frac` before trimming,
 * so an empty fraction produced '1000.' — the anchored `\.?0+$` regex could
 * then never match (the dot blocks it), and the trailing dot made the result
 * fail isDecimalString() downstream (integer balances rendered as 0.00 USDT).
 */
export function trimDecimalZeros(value: string): string {
  const parts = splitDecimal(value);
  if (!parts) return value;
  const frac = parts.frac.replace(/0+$/, '');
  const canonical = frac ? `${parts.int}.${frac}` : parts.int;
  return parts.sign === -1 && canonical !== '0' ? `-${canonical}` : canonical;
}

/**
 * Formats an exact decimal string for display with a bounded decimal count.
 * Never parses the value into a float.
 */
export function formatDecimalString(
  value: string | number | null | undefined,
  maxDecimals = 2,
): string {
  if (value === null || value === undefined) return '0.00';
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  const parts = splitDecimal(raw);
  if (!parts) return '0.00';
  const frac = parts.frac.slice(0, maxDecimals).padEnd(Math.max(maxDecimals, 1), '0');
  const intPart = parts.int === '' ? '0' : parts.int;
  const out = maxDecimals > 0 ? `${intPart}.${frac}` : intPart;
  return parts.sign === -1 && out.replace(/^[0.]+$/, '') !== '' ? `-${out}` : out;
}


/**
 * Multiplies an exact decimal string by an integer factor (use 100 for
 * TDX = USDT × 100). Operates on string digits only — no floats.
 */
export function multiplyDecimalByInteger(value: string, factor: number): string | null {
  const parts = splitDecimal(value);
  if (!parts || !Number.isInteger(factor) || factor < 0) return null;

  const plain = (parts.int.replace(/^0+(?=\d)/, '') || '0') + parts.frac;
  let product = '';
  let carry = 0;
  for (let index = plain.length - 1; index >= 0; index -= 1) {
    const total = Number(plain[index]) * factor + carry;
    product = String(total % 10) + product;
    carry = Math.floor(total / 10);
  }
  while (carry > 0) {
    product = String(carry % 10) + product;
    carry = Math.floor(carry / 10);
  }

  const fracLen = parts.frac.length;
  if (fracLen === 0) {
    const out = product.replace(/^0+(?=\d)/, '') || '0';
    return parts.sign === -1 && out !== '0' ? `-${out}` : out;
  }

  const padded = product.padStart(fracLen + 1, '0');
  const intPart = padded.slice(0, padded.length - fracLen).replace(/^0+(?=\d)/, '') || '0';
  const fracPart = padded.slice(padded.length - fracLen).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return parts.sign === -1 && out !== '0' ? `-${out}` : out;
}

/**
 * Divides an exact decimal string by an integer divisor (use 100 for
 * USDT = TDX ÷ 100). Terminating short division only — no floats.
 */
export function divideDecimalByInteger(
  value: string,
  divisor: number,
  maxDecimals = 18,
): string | null {
  const parts = splitDecimal(value);
  if (
    !parts ||
    !Number.isInteger(divisor) ||
    divisor <= 0 ||
    // The digit loop keeps `remainder < 10 × divisor` in a JS number; an
    // unsafe divisor would silently corrupt the result, so fail closed.
    !Number.isSafeInteger(divisor * 10) ||
    !Number.isInteger(maxDecimals) ||
    maxDecimals < 0
  ) {
    return null;
  }

  // Exact long division. X = N × 10^f (N = int+frac digits, f = frac length),
  // so the dividend for floor(X × 10^maxDecimals ÷ divisor) is the digit
  // string of N × 10^(maxDecimals − f):
  //   - append (maxDecimals − f) zeros when f ≤ maxDecimals;
  //   - when f > maxDecimals, TRUNCATE the surplus fractional digits first
  //     (floor semantics — digits beyond maxDecimals are dropped, never
  //     rounded).
  // The quotient is then re-pointed maxDecimals positions from the right.
  // The previous implementation appended NO zeros (fractional quotient digits
  // were never generated, turning 1000 ÷ 100 into 1e-17).
  const intDigits = parts.int.replace(/^0+(?=\d)/, '') || '0';
  const fracLen = parts.frac.length;
  const allDigits = intDigits + parts.frac;
  const digits =
    fracLen > maxDecimals
      ? allDigits.slice(0, allDigits.length - (fracLen - maxDecimals))
      : allDigits + '0'.repeat(maxDecimals - fracLen);

  let remainder = 0;
  let quotient = '';
  for (const ch of digits) {
    remainder = remainder * 10 + Number(ch);
    quotient += String(Math.floor(remainder / divisor));
    remainder %= divisor;
  }
  quotient = quotient.replace(/^0+(?=\d)/, '') || '0';

  const padded = quotient.padStart(maxDecimals + 1, '0');
  const intPart = padded.slice(0, padded.length - maxDecimals) || '0';
  const fracPart = padded.slice(padded.length - maxDecimals).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return parts.sign === -1 && out !== '0' ? `-${out}` : out;
}

/** Converts an exact USDT decimal string to TDX (× 100), no floats. */
export function usdtToTdx(usdt: string): string | null {
  return multiplyDecimalByInteger(usdt, 100);
}

/** Converts an exact TDX decimal string to USDT (÷ 100), no floats. */
export function tdxToUsdt(tdx: string): string | null {
  return divideDecimalByInteger(tdx, 100);
}
