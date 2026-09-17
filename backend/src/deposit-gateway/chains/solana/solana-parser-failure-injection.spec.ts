import {
  computeSolanaConfirmations,
  extractSplTransfer,
} from './solana-token-transfer.parser';

const MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SIG = '5VERv8gZk4LSybDucvCL2DUhv7yqY34MLu1kCPDYFhM8vi7zYXXzD2ygS3WmmowqTiyAB4KK9mwJgX7Ffw8vYPT6';
const OWNER = 'B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY';
const DEST = '634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje';

function tx(overrides: Record<string, unknown> = {}): any {
  return {
    slot: 285000000,
    blockTime: 1700000000,
    meta: { err: null, confirmationStatus: 'confirmed' },
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: [{ pubkey: MINT, signer: false, writable: true }],
        instructions: [
          {
            program: 'spl-token',
            programId: 'TokenkegQfeZyiNpHphEwDiK5kQSXmKbt8sDgNUvE9c1vGwB',
            parsed: {
              type: 'transfer',
              info: {
                amount: '1000000',
                destination: DEST,
                source: 'SRC',
                authority: OWNER,
              },
            },
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('SOLANA parser — failure injection & edge cases', () => {
  it('rejects transfers from an unknown program', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed.program = 'unknown-program';
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('rejects native SOL (lamports) transfers', () => {
    const sol = tx();
    sol.transaction.message.instructions[0].parsed.info = {
      source: 'S1',
      destination: DEST,
      lamports: 1000,
    };
    expect(extractSplTransfer(sol, SIG)).toBeNull();
  });

  it('rejects null/undefined/non-object transactions', () => {
    expect(extractSplTransfer(null, SIG)).toBeNull();
    expect(extractSplTransfer(undefined, SIG)).toBeNull();
    expect(extractSplTransfer('string', SIG)).toBeNull();
    expect(extractSplTransfer(123, SIG)).toBeNull();
  });

  it('rejects transaction with no instructions', () => {
    expect(extractSplTransfer({ slot: 1 }, SIG)).toBeNull();
  });

  it('rejects instruction with non-object parsed', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed = 'not-an-object';
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('rejects missing destination (unknown recipient)', () => {
    const noDest = tx();
    noDest.transaction.message.instructions[0].parsed.info.destination = undefined;
    expect(extractSplTransfer(noDest, SIG)).toBeNull();
  });

  it('rejects non-string destination', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed.info.destination = 12345;
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('rejects empty destination', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed.info.destination = '';
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('rejects zero/negative/non-numeric amounts', () => {
    const zero = tx();
    zero.transaction.message.instructions[0].parsed.info.amount = '0';
    expect(extractSplTransfer(zero, SIG)).toBeNull();

    const neg = tx();
    neg.transaction.message.instructions[0].parsed.info.amount = '-1000';
    expect(extractSplTransfer(neg, SIG)).toBeNull();

    const bad = tx();
    bad.transaction.message.instructions[0].parsed.info.amount = 'abc';
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('accepts very large amounts (bigint-safe)', () => {
    const large = tx();
    large.transaction.message.instructions[0].parsed.info.amount = '999999999999999999999';
    const t = extractSplTransfer(large, SIG);
    expect(t).not.toBeNull();
    expect(t!.amountRaw).toBe('999999999999999999999');
  });

  it('marks failed transactions with error', () => {
    const failed = tx({ meta: { err: { InstructionError: [0, 'Custom(1)'] } } });
    const t = extractSplTransfer(failed, SIG);
    expect(t).not.toBeNull();
    expect(t!.success).toBe(false);
    expect(t!.error).not.toBeNull();
  });
});

describe('SOLANA confirmations — edge cases', () => {
  it('returns exactly threshold at boundary', () => {
    expect(computeSolanaConfirmations(285000031, 285000000)).toBe(32);
  });

  it('returns 1 when latest equals tx slot', () => {
    expect(computeSolanaConfirmations(285000000, 285000000)).toBe(1);
  });

  it('returns 0 when latest is behind tx slot', () => {
    expect(computeSolanaConfirmations(285000000, 285000010)).toBe(0);
  });

  it('handles large slot differences', () => {
    expect(computeSolanaConfirmations(285001000, 285000000)).toBe(1001);
  });

  it('never returns negative even with extreme values', () => {
    expect(computeSolanaConfirmations(0, 100)).toBe(0);
  });
});