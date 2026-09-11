// ============================================================
// TRADEX REFERRAL SERVICE
// ============================================================

import { apiClient } from '../../core/api/client';

// ============================================================
// REFERRAL USER
// ============================================================

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

// ============================================================
// REFERRAL LEVEL
// ============================================================

export interface ReferralLevel {
  level: number;
  percentage: string;
  direct: boolean;
  users: ReferralUser[];
  totalEarned: string;
  totalUsers: number;
  activeUsers: number;
}

// ============================================================
// REFERRAL STATS
// ============================================================

export interface ReferralStats {
  totalNetwork: number;
  totalActive: number;
  totalEarned: string;
}

// ============================================================
// REFERRAL DASHBOARD RESPONSE
// ============================================================

export interface ReferralDashboardResponse {
  referralCode: string;
  referralLink: string;
  stats: ReferralStats;
  levels: ReferralLevel[];
}

// ============================================================
// GET MY REFERRAL DASHBOARD
// ============================================================

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

// ============================================================
// REFERRAL SERVICE OBJECT
// ============================================================

export const ReferralService = {
  getReferralDashboard,
};

export default ReferralService;