import { apiClient } from '../../core/api/client';

import type {
  AuthUser,
  AuthWallet,
  NonceResponse,
  VerifyRequest,
  VerifyResponse,
  RegisterRequest,
  RegisterResponse,
} from '../hooks/auth.types';

export class AuthService {
  // ============================================================
  // STORAGE KEYS
  // ============================================================

  private static readonly TOKEN_KEY = 'token';
  private static readonly USER_KEY = 'tradex_user';

  // ============================================================
  // GET NONCE
  // ============================================================

  static async getNonce(
    walletAddress: string,
  ): Promise<NonceResponse> {
    const response =
      await apiClient.post<NonceResponse>(
        '/auth/nonce',
        {
          walletAddress,
        },
      );

    return response.data;
  }

  // ============================================================
  // VERIFY SIGNATURE
  // ============================================================

  static async verifySignature(
    request: VerifyRequest,
  ): Promise<VerifyResponse> {
    const response =
      await apiClient.post<VerifyResponse>(
        '/auth/verify',
        request,
      );

    return response.data;
  }

  // ============================================================
  // REGISTER USER
  // ============================================================

  static async registerUser(
    request: RegisterRequest,
  ): Promise<RegisterResponse> {
    const response =
      await apiClient.post<RegisterResponse>(
        '/auth/register',
        request,
      );

    return response.data;
  }

  // ============================================================
  // SAVE TOKEN
  // ============================================================

  static saveToken(
    accessToken: string,
  ): void {
    localStorage.setItem(this.TOKEN_KEY, accessToken);
  }

  // ============================================================
  // GET TOKEN
  // ============================================================

  static getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  // ============================================================
  // SAVE USER
  // ============================================================

  static saveUser(
    user: AuthUser,
  ): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  // ============================================================
  // GET USER
  // ============================================================

  static getSavedUser(): AuthUser | null {
    const raw = localStorage.getItem(this.USER_KEY);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AuthUser;

      if (!parsed || typeof parsed !== 'object') {
        this.clearSession();
        return null;
      }

      if (!parsed.id || !parsed.walletAddress) {
        this.clearSession();
        return null;
      }

      return parsed;
    } catch {
      this.clearSession();
      return null;
    }
  }

  // ============================================================
  // CLEAR SESSION
  // ============================================================

  static clearSession(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  // ============================================================
  // IS AUTHENTICATED
  // ============================================================

  static isAuthenticated(): boolean {
    return !!(
      this.getToken() &&
      this.getSavedUser()
    );
  }
}