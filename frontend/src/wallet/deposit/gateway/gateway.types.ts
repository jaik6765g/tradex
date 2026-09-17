export type OrderStatus =
  | 'CREATED'
  | 'AWAITING_PAYMENT'
  | 'DETECTED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'UNDERPAID'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED';

export interface DepositOrder {
  id: string;
  chainId: number;
  asset: string;
  tokenAddress: string;
  amount: string;
  tdxAmount: string;
  depositAddress: string | null;
  provider?: string;
  development?: boolean;
  expiresAt: string;
  status: OrderStatus;
  transactionHash: string | null;
  confirmations: number;
  requiredConfirmations: number | null;
  credited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderStatusResponse {
  status: OrderStatus;
  confirmations: number;
  requiredConfirmations: number | null;
  credited: boolean;
  transactionHash: string | null;
}

export interface DepositNetwork {
  id: string;
  name: string;
  protocol: 'EVM' | 'TRON' | 'SOLANA';
  chainId: number | null;
  usdtContract: string;
  usdtDecimals: number;
  confirmations: number;
  explorer: string;
  configured: boolean;
  depositEnabled: boolean;
  watcherEnabled: boolean;
  sweepEnabled: boolean;
  treasuryAddress: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'DISABLED';
}

export interface GatewayConfig {
  mode: string;
  provider: {
    name: string;
    development: boolean;
  };
  sweepEnabled: boolean;
  networks: DepositNetwork[];
  chains: Array<{ chainId: number; nativeSymbol: string }>;
  tdxRate: number;
  asset: string;
}

export interface CreateOrderPayload {
  chainId: number;
  asset: string;
  amount: string;
}
