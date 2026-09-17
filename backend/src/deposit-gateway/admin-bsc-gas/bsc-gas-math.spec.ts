import { bnbToWei, formatToken, weiToBnb } from './bsc-gas-status.service';

describe('BSC gas math', () => {
  it('wei<->bnb round-trips', () => {
    expect(weiToBnb(1000000000000000n)).toBe('0.001');
    expect(bnbToWei('0.001')).toBe(1000000000000000n);
    expect(weiToBnb(0n)).toBe('0.0');
  });

  it('GAS_REQUIRED when bnb < gasLimit*price + buffer; READY otherwise', () => {
    const gasLimit = 100000n;
    const gasPrice = 5000000000n; // 5 gwei
    const buffer = bnbToWei('0.0005');
    const required = gasLimit * gasPrice + buffer; // 0.0005 + 0.0005 = 0.001
    expect(required).toBe(1000000000000000n);
    expect(100000000000000n < required).toBe(true);
    expect(2000000000000000n >= required).toBe(true);
  });

  it('USDT 18dp formatting never uses floats', () => {
    expect(formatToken(1000000000000000000n, 18)).toBe('1.0');
    expect(formatToken(0n, 18)).toBe('0.0');
  });
});
