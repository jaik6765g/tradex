import { apiClient } from '../../core/api/client';

export interface ReferralUser {
  userId: string;
  walletAddress: string;
  level: number;
  percentage: string;
  earned: string;
  tradeVolume: string;
  active: boolean;
  joinedAt: string;
}

export interface ReferralLevel {
  level: number;
  percentage: string;
  direct: boolean;
  users: ReferralUser[];
  totalEarned: string;
  totalUsers: number;
  activeUsers: number;
}

export interface ReferralStats {
  totalNetwork: number;
  totalActive: number;
  totalEarned: string;
}

export interface ReferralDashboardResponse {
  referralCode: string;
  referralLink: string;
  stats: ReferralStats;
  levels: ReferralLevel[];
}

export async function getReferralDashboard(
  options?: {
    signal?: AbortSignal;
  },
): Promise<ReferralDashboardResponse> {
  const response =
    await apiClient.get<ReferralDashboardResponse>(
      '/users/referral/me',
      options,
    );

  return response.data;
}

export const ReferralService = {
  getReferralDashboard,
};

export default ReferralService;