// ============================================================
// AUTH USER
// ============================================================

export interface AuthUser {
  id: string;
  mobileNumber: string | null;
  email: string | null;
  walletAddress: string | null;
  role: 'admin' | 'user';
  referralCode: string | null;
  referredBy: string | null;
  status: string;
  createdAt: string;
}

// ============================================================
// AUTH WALLET — crypto wallet linked post-login (NOT auth).
// ============================================================

export interface AuthWallet {
  id: string;
  address: string;
  chainId: number;
  isPrimary?: boolean;
}
