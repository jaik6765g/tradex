import {
  classifyAccountStatus,
  computeTronAccounting,
} from './tron-reconciliation.service';

describe('TRON full-balance accounting', () => {
  it('accounts multiple deposits minus completed sweeps', () => {
    const acc = computeTronAccounting({
      balanceSun: 4000000n,
      confirmedDepositSun: [1000000n, 5000000n],
      completedSweepSun: [2000000n],
    });
    expect(acc.depositedSun).toBe(6000000n);
    expect(acc.sweptSun).toBe(2000000n);
    expect(acc.expectedRemainingSun).toBe(4000000n);
    expect(acc.residualSun).toBe(0n);
  });

  it('never double-credits: balance equal to expected is MATCHED', () => {
    const acc = computeTronAccounting({
      balanceSun: 3000000n,
      confirmedDepositSun: [1000000n, 2000000n],
      completedSweepSun: [0n],
    });
    expect(acc.residualSun).toBe(0n);
    expect(classifyAccountStatus(acc.residualSun, 3000000n, 0n)).toBe('MATCHED');
  });

  it('flags RESIDUAL when balance exceeds accounted funds (never auto-credits)', () => {
    const acc = computeTronAccounting({
      balanceSun: 6000000n,
      confirmedDepositSun: [5000000n],
      completedSweepSun: [1000000n],
    });
    expect(acc.residualSun).toBe(2000000n);
    expect(classifyAccountStatus(acc.residualSun, 6000000n, 0n)).toBe('RESIDUAL');
  });

  it('flags UNDER when balance is below expected or pending sweeps', () => {
    const acc = computeTronAccounting({
      balanceSun: 500000n,
      confirmedDepositSun: [1000000n],
      completedSweepSun: [],
    });
    expect(acc.residualSun).toBe(-500000n);
    expect(classifyAccountStatus(acc.residualSun, 500000n, 0n)).toBe('UNDER');
  });

  it('accounts failed sweeps as not swept (their amount stays in expected)', () => {
    const acc = computeTronAccounting({
      balanceSun: 1000000n,
      confirmedDepositSun: [1000000n],
      completedSweepSun: [], // sweep failed → not completed
    });
    expect(acc.sweptSun).toBe(0n);
    expect(acc.expectedRemainingSun).toBe(1000000n);
    expect(classifyAccountStatus(acc.residualSun, 1000000n, 0n)).toBe('MATCHED');
  });
});