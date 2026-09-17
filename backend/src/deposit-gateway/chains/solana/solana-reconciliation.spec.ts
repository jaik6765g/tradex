import {
  computeSolanaAccounting,
} from './solana-reconciliation.service';

describe('computeSolanaAccounting', () => {
  it('MATCHED when balance equals expected remaining', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 5000000n,
      confirmedDepositRaw: [10000000n],
      completedSweepRaw: [5000000n],
      pendingSweepRaw: 0n,
    });
    expect(result.status).toBe('MATCHED');
    expect(result.depositedRaw).toBe(10000000n);
    expect(result.sweptRaw).toBe(5000000n);
    expect(result.expectedRemainingRaw).toBe(5000000n);
    expect(result.residualRaw).toBe(0n);
  });

  it('RESIDUAL when on-chain balance exceeds expected', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 7000000n,
      confirmedDepositRaw: [10000000n],
      completedSweepRaw: [5000000n],
      pendingSweepRaw: 0n,
    });
    expect(result.status).toBe('RESIDUAL');
    expect(result.residualRaw).toBe(2000000n);
  });

  it('UNDER when on-chain balance is less than expected', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 3000000n,
      confirmedDepositRaw: [10000000n],
      completedSweepRaw: [5000000n],
      pendingSweepRaw: 0n,
    });
    expect(result.status).toBe('UNDER');
    expect(result.residualRaw).toBe(-2000000n);
  });

  it('MATCHED when both balance and expected are zero', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 0n,
      confirmedDepositRaw: [],
      completedSweepRaw: [],
      pendingSweepRaw: 0n,
    });
    expect(result.status).toBe('MATCHED');
  });

  it('excludes pending sweeps from completed', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 8000000n,
      confirmedDepositRaw: [10000000n],
      completedSweepRaw: [2000000n],
      pendingSweepRaw: 3000000n,
    });
    expect(result.status).toBe('MATCHED');
    expect(result.sweptRaw).toBe(2000000n);
  });

  it('handles multiple deposits and sweeps', () => {
    const result = computeSolanaAccounting({
      balanceRaw: 15000000n,
      confirmedDepositRaw: [10000000n, 20000000n],
      completedSweepRaw: [5000000n, 10000000n],
      pendingSweepRaw: 0n,
    });
    expect(result.status).toBe('MATCHED');
    expect(result.depositedRaw).toBe(30000000n);
    expect(result.sweptRaw).toBe(15000000n);
  });

  it('is read-only (no input mutation)', () => {
    const input = {
      balanceRaw: 5000000n,
      confirmedDepositRaw: [10000000n],
      completedSweepRaw: [5000000n],
      pendingSweepRaw: 0n,
    };
    computeSolanaAccounting(input);
    expect(input.balanceRaw).toBe(5000000n);
    expect(input.confirmedDepositRaw).toEqual([10000000n]);
  });
});