import { apiClient } from '../../core/api/client';

import type { AuthUser, AuthWallet } from '../hooks/auth.types';

export interface AuthSession {
  access_token: string | null;
  refresh_token: string | null;
  user: AuthUser;
}

interface MessageResponse {
  message: string;
}

export interface LinkWalletPayload {
  walletAddress: string;
  signature: string;
  message: string;
  chainId: number;
}

export interface ClaimWalletPayload extends LinkWalletPayload {
  accessToken: string;
}

export class AuthService {
  private static readonly TOKEN_KEY = 'token';
  private static readonly USER_KEY = 'tradex_user';

  // ============================================================
  // AUTH API
  // ============================================================

  static async signup(params: {
    mobileNumber: string;
    email: string;
    password: string;
    referralCode?: string;
  }): Promise<AuthSession> {
    const { data } = await apiClient.post<AuthSession>('/auth/signup', params);
    return data;
  }

  static async login(params: {
    mobileNumber: string;
    password: string;
  }): Promise<AuthSession> {
    const { data } = await apiClient.post<AuthSession>('/auth/login', params);
    return data;
  }

  static async forgotPassword(mobileNumber: string): Promise<void> {
    await apiClient.post<MessageResponse>('/auth/forgot-password', {
      mobileNumber,
    });
  }

  static async resetPassword(params: {
    mobileNumber: string;
    token: string;
    password: string;
  }): Promise<void> {
    await apiClient.post<MessageResponse>('/auth/reset-password', params);
  }

  static async fetchMe(): Promise<AuthUser> {
    const response = await apiClient.get<{ user: AuthUser }>('/auth/me');
    return response.data.user;
  }

  static async linkWallet(payload: LinkWalletPayload): Promise<AuthWallet> {
    const response = await apiClient.post<AuthWallet>(
      '/auth/wallet/link',
      payload,
    );
    return response.data;
  }

  static async claimWallet(payload: ClaimWalletPayload): Promise<AuthUser> {
    const response = await apiClient.post<{ user: AuthUser }>(
      '/auth/wallet/claim',
      payload,
    );
    return response.data.user;
  }

  // ============================================================
  // SESSION STORAGE
  // ============================================================

  static saveToken(accessToken: string): void {
    if (accessToken) {
      localStorage.setItem(this.TOKEN_KEY, accessToken);
    }
  }

  static getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  static saveUser(user: AuthUser): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  static getSavedUser(): AuthUser | null {
    const raw = localStorage.getItem(this.USER_KEY);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AuthUser;
      return parsed && parsed.id ? parsed : null;
    } catch {
      return null;
    }
  }

  static clearSession(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  static isAuthenticated(): boolean {
    return Boolean(this.getToken() && this.getSavedUser());
  }

  static getErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as {
        response?: { data?: { message?: string | string[] } };
      };
      const msg = e.response?.data?.message;
      if (Array.isArray(msg)) {
        return msg.join(', ');
      }
      if (typeof msg === 'string' && msg) {
        return msg;
      }
    }

    if (err instanceof Error && err.message) {
      return err.message;
    }

    return 'Something went wrong';
  }
}
