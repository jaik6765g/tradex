import { apiClient } from '../../core/api/client';

import { withTransientRetry } from './auth-resilience';
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

  /**
   * Bounded retry for TRANSIENT failures only (network error / timeout / 5xx)
   * so a sleeping backend does not fail the first login attempt. Invalid
   * credentials (401) and validation errors (4xx) are never retried, and
   * maxRetries stays low so a login is never submitted in bulk.
   */
  static async login(params: {
    mobileNumber: string;
    password: string;
  }): Promise<AuthSession> {
    return withTransientRetry(
      async () => {
        const { data } = await apiClient.post<AuthSession>(
          '/auth/login',
          params,
        );
        return data;
      },
      { maxRetries: 1, backoffMs: 1500 },
    );
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

  /** In-flight dedupe: concurrent callers share ONE /auth/me request. */
  private static meInFlight: Promise<AuthUser> | null = null;

  /**
   * Session check with bounded transient retry (network/timeout/5xx only).
   * A 401/403 is surfaced to the caller immediately and is never retried.
   */
  static async fetchMe(): Promise<AuthUser> {
    if (AuthService.meInFlight) {
      return AuthService.meInFlight;
    }

    AuthService.meInFlight = withTransientRetry(
      async () => {
        const response = await apiClient.get<{ user: AuthUser }>('/auth/me');
        return response.data.user;
      },
      { maxRetries: 2, backoffMs: 1500 },
    ).finally(() => {
      AuthService.meInFlight = null;
    });

    return AuthService.meInFlight;
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
