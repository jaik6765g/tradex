// ============================================================
// NONCE RESPONSE
// ============================================================

export interface NonceResponse {
  walletAddress: string;
  nonce: string;
  expiresAt: string;
  message: string;
}

// ============================================================
// AUTH USER
// ============================================================

export interface AuthUser {
  id: string;
  walletAddress: string;
  role?: 'admin' | 'user';
  referralCode: string | null;
  referredBy: string | null;
  status: string;
  createdAt: string;
}

// ============================================================
// AUTH WALLET
// ============================================================

export interface AuthWallet {
  id: string;
  address: string;
  chainId: number;
}

// ============================================================
// VERIFY REQUEST
// ============================================================
//
// Sent after wallet signs the authentication message.
//
// POST /auth/verify
//
// This is where the wallet signature is verified.
//
// If the wallet already exists:
//   registered = true
//
// If the wallet does not exist:
//   registered = false
//   registrationRequired = true
//   registrationToken = ...
// ============================================================

export interface VerifyRequest {
  walletAddress: string;
  signature: string;
  nonce: string;
  chainId: number;
  referralCode?: string;
}

// ============================================================
// VERIFY RESPONSE
// ============================================================

export interface VerifyResponse {
  registered: boolean;

  // ==========================================================
  // NEW USER
  // ==========================================================

  registrationRequired?: boolean;

  registrationToken?: string;

  walletAddress?: string;

  chainId?: number;

  // ==========================================================
  // EXISTING USER
  // ==========================================================

  accessToken?: string;

  user?: AuthUser;

  wallet?: AuthWallet;
}

// ============================================================
// REGISTER REQUEST
// ============================================================
//
// IMPORTANT:
//
// Signature + nonce are NOT sent again.
//
// They have already been verified by:
//
// POST /auth/verify
//
// New registration uses the short-lived registrationToken
// returned by /auth/verify.
//
// POST /auth/register
// ============================================================

export interface RegisterRequest {
  walletAddress: string;

  chainId: number;

  registrationToken: string;

  referralCode?: string;
}

// ============================================================
// REGISTER RESPONSE
// ============================================================

export interface RegisterResponse {
  registered: true;

  accessToken: string;

  user: AuthUser;

  wallet: AuthWallet;
}