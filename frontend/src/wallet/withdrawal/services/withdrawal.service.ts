import { AxiosError } from 'axios';
import { getAddress } from 'ethers';
import { apiClient } from '../../../core/api/client';

export type CreateWithdrawalRequest = {
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  tdxAmount: string;
  /**
   * Optional user-scoped idempotency key. Replaying the same value never
   * creates a second withdrawal; reusing it with a different payload is
   * rejected by the backend (409 WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH).
   */
  clientRequestId?: string;
};

export type WithdrawalStatus =
  | 'REQUESTED'
  | 'RISK_CHECKING'
  | 'LIQUIDITY_CHECK'
  | 'PENDING_ADMIN_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'HOLD';

export type WithdrawalResponse = {
  id: string;
  userId: string;
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  tdxAmount: string;
  usdtAmount: string;
  fee: string;
  status: WithdrawalStatus;
  riskPassed: boolean;
  liquidityPassed: boolean;
  adminApproved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  txHash?: string;
  metadata?: Record<string, unknown>;
  payoutAttempted: boolean;
  payoutIdempotencyKey?: string;
  payoutSubmittedAt?: string;
  payoutConfirmedAt?: string;
  rejectionReason?: string;
  riskReason?: string;
  verifiedAt?: string;
  processedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type CreateWithdrawalOptions = {
  signal?: AbortSignal;
};

type RequestWithdrawalResponse = {
  withdrawalId: string;
  usdtAmount: string;
  status: WithdrawalStatus;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type WithdrawalApiErrorPayload = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
  remainingWagering?: string;
};

const ACTIVE_WITHDRAWAL_CONFLICT_MESSAGE =
  'You already have an active withdrawal request. Please wait for it to finish before requesting another withdrawal.';

const IDEMPOTENCY_PAYLOAD_MISMATCH_MESSAGE =
  'This withdrawal request was already submitted with different details. Please start a new request.';

/**
 * Generates a user-scoped idempotency key for a single withdrawal attempt.
 * A double-click / network retry therefore reuses the SAME key and can never
 * create two withdrawals.
 */
const createWithdrawalClientRequestId = (): string => {
  const globalCrypto = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }
  return `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * EIP-55 checksum normalization of the payout address.
 *
 * Linked wallets are stored checksummed on the backend, so submitting the
 * address in that exact form removes every casing ambiguity from the
 * ownership lookup. This is the SAME normalization the backend uses when it
 * links a wallet (ethers `getAddress`).
 *
 * - uniform lowercase / uppercase input is normalized to the checksummed form
 * - a mixed-case address whose checksum does not verify is REJECTED: that
 *   mismatch almost always means a typo, and a mistyped payout address cannot
 *   be recovered once the funds leave the platform
 * - malformed input (wrong length, non-hex, empty) is rejected up-front with
 *   a clear message instead of a confusing backend "wallet not found"
 */
const normalizeWalletAddress = (rawAddress: string): string => {
  const trimmed = typeof rawAddress === 'string' ? rawAddress.trim() : '';

  if (!trimmed) {
    throw new Error('Enter your payout wallet address.');
  }

  // ethers verifies the EIP-55 checksum and only accepts uniform-lowercase
  // input as "unchecksummed", so a uniformly cased address is folded to lower
  // case first. The checksum only carries information in MIXED case — which
  // is still validated strictly below.
  const isUniformCase =
    trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase();
  const candidate = isUniformCase ? trimmed.toLowerCase() : trimmed;

  try {
    return getAddress(candidate);
  } catch {
    throw new Error(
      'Invalid wallet address. Please enter a valid BSC (BEP-20) address.',
    );
  }
};

const normalizeErrorMessage = (message?: string | string[]): string | undefined => {
  if (typeof message === 'string') {
    return message.trim() || undefined;
  }

  if (Array.isArray(message)) {
    const merged = message
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join(' ');

    return merged || undefined;
  }

  return undefined;
};

export const parseWithdrawalApiError = (error: unknown): Error => {
  if (!(error instanceof AxiosError)) {
    return error instanceof Error ? error : new Error('Withdrawal request failed');
  }

  const status = error.response?.status;
  const data = (error.response?.data ?? {}) as WithdrawalApiErrorPayload;
  const backendMessage = normalizeErrorMessage(data.message);
  const upperMessage = (backendMessage ?? '').toUpperCase();

  if (status === 401) {
    return new Error('Authentication expired. Please reconnect wallet and login again.');
  }

  // Wagering requirement enforcement (backend-authoritative, machine-readable).
  if (status === 403 && data.code === 'WAGERING_REQUIREMENT_INCOMPLETE') {
    const remaining = data.remainingWagering;
    const trimmed =
      remaining !== undefined && remaining !== null
        ? String(remaining).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
        : null;
    return new Error(
      trimmed
        ? `Wagering requirement not complete. ${trimmed} TDX of wagering is still required before you can withdraw.`
        : 'Wagering requirement not complete. Wager the required amount before withdrawing.',
    );
  }

  if (status === 409) {
    if (data.code === 'WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH') {
      return new Error(IDEMPOTENCY_PAYLOAD_MISMATCH_MESSAGE);
    }

    if (upperMessage.includes('ACTIVE WITHDRAWAL REQUEST ALREADY EXISTS')) {
      return new Error(ACTIVE_WITHDRAWAL_CONFLICT_MESSAGE);
    }

    return new Error(backendMessage || ACTIVE_WITHDRAWAL_CONFLICT_MESSAGE);
  }

  if (status === 400 || status === 422) {
    return new Error(backendMessage || 'Invalid withdrawal request. Please verify your input.');
  }

  if (status === 500) {
    return new Error('Withdrawal service is temporarily unavailable. Please try again shortly.');
  }

  return new Error(backendMessage || error.message || 'Withdrawal request failed');
};

export const withdrawalService = {
  createWithdrawal: async (
    payload: CreateWithdrawalRequest,
    options?: CreateWithdrawalOptions,
  ): Promise<WithdrawalResponse> => {
    try {
      const response = await apiClient.post<ApiEnvelope<WithdrawalResponse>>(
        '/withdrawals',
        {
          walletAddress: payload.walletAddress,
          chainId: payload.chainId,
          tokenAddress: payload.tokenAddress,
          tdxAmount: payload.tdxAmount,
          ...(payload.clientRequestId
            ? { clientRequestId: payload.clientRequestId }
            : {}),
        },
        options,
      );

      return response.data.data;
    } catch (error) {
      throw parseWithdrawalApiError(error);
    }
  },

  requestWithdrawal: async (
    walletAddress: string,
    tdxAmount: string,
    options?: CreateWithdrawalOptions,
  ): Promise<RequestWithdrawalResponse> => {
    const chainId = Number(import.meta.env.VITE_BSC_CHAIN_ID || '56');
    const tokenAddress = import.meta.env.VITE_BSC_USDT_CONTRACT || '';
    // Throws a clear validation error for malformed / mistyped addresses.
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

    const withdrawal = await withdrawalService.createWithdrawal(
      {
        walletAddress: normalizedWalletAddress,
        chainId,
        tokenAddress,
        tdxAmount,
        clientRequestId: createWithdrawalClientRequestId(),
      },
      options,
    );

    return {
      withdrawalId: withdrawal.id,
      usdtAmount: withdrawal.usdtAmount,
      status: withdrawal.status,
    };
  },

  getWithdrawalById: async (
    withdrawalId: string,
  ): Promise<WithdrawalResponse> => {
    const response = await apiClient.get<ApiEnvelope<WithdrawalResponse>>(
      `/withdrawals/my/${encodeURIComponent(withdrawalId)}`,
    );

    return response.data.data;
  },
};

export const WithdrawalService = withdrawalService;