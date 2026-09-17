import {
  computeSolanaConfirmations,
  extractSplTransfer,
} from './solana-token-transfer.parser';

const MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SIG = '5VERv8gZk4LSybDucvCL2DUhv7yqY34MLu1kCPDYFhM8vi7zYXXzD2ygS3WmmowqTiyAB4KK9mwJgX7Ffw8vYPT6';
const OWNER = 'B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY';
const DEST = '634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje';

/** Build a parsed Solana transaction containing an SPL token transfer. */
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

describe('SOLANA SPL USDT transfer parser', () => {
  it('extracts a valid SPL USDT transfer', () => {
    const t = extractSplTransfer(tx(), SIG);
    expect(t).not.toBeNull();
    expect(t!.signature).toBe(SIG);
    expect(t!.amountRaw).toBe('1000000');
    expect(t!.destinationTokenAccount).toBe(DEST);
    expect(t!.sourceTokenAccount).toBe('SRC');
    expect(t!.authority).toBe(OWNER);
    expect(t!.success).toBe(true);
    expect(t!.slot).toBe(285000000);
  });

  it('rejects a wrong-mint transfer (non-SPL program instruction)', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed.program = 'system';
    bad.transaction.message.instructions[0].parsed.value = { lamports: 100 };
    expect(extractSplTransfer(bad, SIG)).toBeNull();
  });

  it('ignores native SOL (lamports) transfers', () => {
    const sol = tx();
    sol.transaction.message.instructions[0].parsed.info = {
      source: 'S1',
      destination: DEST,
      lamports: 1000,
    };
    expect(extractSplTransfer(sol, SIG)).toBeNull();
  });

  it('rejects a failed transaction but keeps it observable', () => {
    const failed = tx({ meta: { err: { InstructionError: [0, 'Custom'] } } });
    const t = extractSplTransfer(failed, SIG);
    expect(t?.success).toBe(false);
    expect(t?.error).not.toBeNull();
  });

  it('rejects zero amounts', () => {
    const zero = tx();
    zero.transaction.message.instructions[0].parsed.info.amount = '0';
    expect(extractSplTransfer(zero, SIG)).toBeNull();
  });

  it('rejects invalid/absent amounts', () => {
    const bad = tx();
    bad.transaction.message.instructions[0].parsed.info.amount = 'not-a-number';
    expect(extractSplTransfer(bad, SIG)).toBeNull();
    const missing = tx();
    delete missing.transaction.message.instructions[0].parsed.info.amount;
    expect(extractSplTransfer(missing, SIG)).toBeNull();
  });

  it('rejects unknown recipients (no destination token account)', () => {
    const noDest = tx();
    noDest.transaction.message.instructions[0].parsed.info.destination = undefined;
    expect(extractSplTransfer(noDest, SIG)).toBeNull();
  });

  it('ignores non-transfer instructions (memo/ATA/unknown)', () => {
    const memo = tx();
    memo.transaction.message.instructions[0].parsed = {
      type: 'memo',
      value: { memo: 'hello' },
    };
    expect(extractSplTransfer(memo, SIG)).toBeNull();
  });

  it('ignores malformed transactions', () => {
    expect(extractSplTransfer(null, SIG)).toBeNull();
    expect(extractSplTransfer({}, SIG)).toBeNull();
    expect(extractSplTransfer({ meta: { err: null } }, SIG)).toBeNull();
  });

  it('supports transferChecked format', () => {
    const checked = tx();
    checked.transaction.message.instructions[0].parsed.type = 'transferChecked';
    checked.transaction.message.instructions[0].parsed.info = {
      source: 'SRC',
      destination: DEST,
      mint: MINT,
      authority: OWNER,
      tokenAmount: { amount: '2000000', decimals: 6 },
    };
    const t = extractSplTransfer(checked, SIG);
    expect(t?.amountRaw).toBe('2000000');
  });
});

describe('SOLANA confirmations', () => {
  it('computes confirmations from slots', () => {
    expect(computeSolanaConfirmations(285000031, 285000000)).toBe(32);
    expect(computeSolanaConfirmations(285000030, 285000000)).toBe(31);
    expect(computeSolanaConfirmations(285000033, 285000000)).toBe(34);
  });

  it('never returns negative confirmations', () => {
    expect(computeSolanaConfirmations(285000000, 285000010)).toBe(0);
  });
});