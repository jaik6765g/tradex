import { apiClient } from '../../../core/api/client';

import type {
  BotAccount,
  BotAccountStatus,
  BotAccountResponse,
  BotWallet,
  TransferBotWalletRequest,
  ActivateBotRequest,
  BotActivation,
  BotActivityQuery,
  BotActivityResponse,
  BotReferralPerformance,
} from '../types/bot.types';

type BotAccountEntityResponse = BotAccount & {
  botWallet?: BotWallet;
};

type BotAccountWireResponse =
  | BotAccountResponse
  | BotAccountEntityResponse;

function normalizeStatus(status: string | undefined): BotAccountStatus {
  const normalized = (status ?? '').toLowerCase();

  if (
    normalized === 'active' ||
    normalized === 'inactive' ||
    normalized === 'suspended' ||
    normalized === 'closed'
  ) {
    return normalized;
  }

  return 'inactive';
}

function normalizeBotAccountResponse(
  payload: BotAccountWireResponse,
): BotAccountResponse {
  if ('account' in payload) {
    const wallet =
      payload.wallet ??
      payload.account.wallet;

    return {
      account: {
        ...payload.account,
        status: normalizeStatus(payload.account.status),
        wallet,
      },
      wallet,
    };
  }

  const wallet =
    payload.wallet ??
    payload.botWallet;

  return {
    account: {
      ...payload,
      status: normalizeStatus(payload.status),
      wallet,
    },
    wallet,
  };
}

export class BotService {
  static async getBotAccount(): Promise<BotAccountResponse> {
    const response = await apiClient.get<BotAccountWireResponse>('/bot/account');
    return normalizeBotAccountResponse(response.data);
  }

  static async createBotAccount(): Promise<BotAccountResponse> {
    const response = await apiClient.post<BotAccountWireResponse>('/bot/account');
    return normalizeBotAccountResponse(response.data);
  }

  static async transferToBotWallet(
    request: TransferBotWalletRequest,
  ): Promise<unknown> {
    const response = await apiClient.post('/bot/wallet/transfer', request);
    return response.data;
  }

  static async activateBot(
    request: ActivateBotRequest,
  ): Promise<BotActivation> {
    const response = await apiClient.post<BotActivation>('/bot/account/activate', request);
    return response.data;
  }

  static async getBotActivity(
    query?: BotActivityQuery,
  ): Promise<BotActivityResponse> {
    const response = await apiClient.get<BotActivityResponse>('/bot/activity', {
      params: query,
    });

    return response.data;
  }

  static async getReferralPerformance(): Promise<BotReferralPerformance> {
    const response = await apiClient.get<BotReferralPerformance>(
      '/users/referral/performance/me',
    );

    return response.data;
  }
}
