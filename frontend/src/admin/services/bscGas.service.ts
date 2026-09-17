// frontend/src/admin/services — BSC Gas & Sweep (admin-only, JWT via apiClient)
import { apiClient } from '../../core/api/client';

export interface BscGasRow {
  depositAddressId: string;
  userId: string | null;
  userEmail: string | null;
  userMobile: string | null;
  depositAddress: string;
  network: string;
  chainId: number;
  derivationIndex: number | null;
  custodyGeneration: number;
  bnbBalance: string;
  usdtBalance: string;
  requiredGasBnb: string;
  gasShortfallBnb: string;
  recommendedBnb: string;
  sweepStatus: string | null;
  sweepId: string | null;
  opStatus: 'NO_USDT' | 'READY' | 'GAS_REQUIRED' | 'SWEEPING' | 'COMPLETED' | 'MANUAL_REVIEW';
  eligibleForTopUp: boolean;
  eligibleForSweep: boolean;
  treasury: string;
  updatedAt: string;
}

export interface BscGasListResponse {
  network: string;
  chainId: number;
  treasury: string;
  gasWallet: { address: string | null; configured: boolean };
  rows: BscGasRow[];
  total: number;
}

export interface BscBatchPreview {
  idempotencyKey: string;
  network: string;
  chainId: number;
  gasWallet: string | null;
  gasWalletConfigured: boolean;
  treasury: string;
  recipientCount: number;
  totalBnb: string;
  totalWei: string;
  eligible: Array<{ address: string; fundingBnb: string; currentBnb: string; requiredGasBnb: string; shortfallBnb: string }>;
  rejected: Array<{ address: string; rejectReason: string | null }>;
}

export class BscGasService {
  static async list(status?: string): Promise<BscGasListResponse> {
    const res = await apiClient.get('/admin/deposit-gateway/bsc/gas', { params: status ? { status } : {} });
    return res.data as BscGasListResponse;
  }

  static exportUrl(): string {
    const base = (apiClient.defaults.baseURL ?? '').replace(/\/$/, '');
    return base + '/admin/deposit-gateway/bsc/gas/export';
  }

  static async preview(recipients: string[], allowZeroUsdt = false): Promise<BscBatchPreview> {
    const res = await apiClient.post('/admin/deposit-gateway/bsc/gas/batch-preview', { recipients, allowZeroUsdt });
    return res.data as BscBatchPreview;
  }

  static async send(recipients: string[], idempotencyKey: string, allowZeroUsdt = false) {
    const res = await apiClient.post('/admin/deposit-gateway/bsc/gas/batch-send', {
      recipients, idempotencyKey, confirmed: true, allowZeroUsdt,
    });
    return res.data;
  }

  static async batch(id: string) {
    const res = await apiClient.get('/admin/deposit-gateway/bsc/gas/batches/' + encodeURIComponent(id));
    return res.data;
  }

  static async sweepAddress(depositAddressId: string) {
    const res = await apiClient.post(
      '/admin/deposit-gateway/bsc/sweeps/address/' + encodeURIComponent(depositAddressId) + '/execute',
      {},
    );
    return res.data;
  }

  static async bulkSweep(depositAddressIds: string[]) {
    const res = await apiClient.post('/admin/deposit-gateway/bsc/sweeps/bulk-execute', { depositAddressIds });
    return res.data;
  }
}
