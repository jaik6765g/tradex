// Global Main Balance initialisation rules (pure + testable).
//
// The canonical Main Wallet balance is owned by WalletProvider. These two
// predicates capture the ONLY conditions that matter for it:
//
//  1. WHEN it may load — an authenticated identity exists (user id + token).
//     A connected web3 wallet or the selected network must never gate it:
//     the Main Balance is backend money (TDX), not on-chain money, and
//     mobile/email users have no wallet connection at all.
//
//  2. WHEN a response is still valid — it must belong to the identity that is
//     currently signed in, so a slow response for a previous user can never
//     overwrite the fresh balance of the user who is signed in now.

export interface BalanceIdentity {
  userId: string | null | undefined;
  token: string | null | undefined;
}

/** True when the Main Balance may be fetched for this identity. */
export function canLoadMainBalance(identity: BalanceIdentity): boolean {
  return Boolean(identity.userId && identity.token);
}

/**
 * True when a response fetched for `requestUserId` still describes the
 * currently signed-in account (`currentOwner`).
 */
export function isBalanceResponseCurrent(
  requestUserId: string,
  currentOwner: string | null,
): boolean {
  return requestUserId === currentOwner;
}
