import type { LedgerType } from '../ledger.entity';

export interface AdminLedgerItemDto {
  id: string;
  userId: string;
  walletAddress: string | null;
  type: LedgerType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceId: string | null;
  referenceType: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AdminLedgerListResponseDto {
  items: AdminLedgerItemDto[];
  total: number;
  limit: number;
  offset: number;
}
