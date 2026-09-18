// Referral deep-link parsing for the signup flow.
//
// The ONLY supported query parameter is `ref` — exactly the parameter the
// backend already uses when it builds a user's referral link
// (UsersService.buildReferralLink → <origin>/register?ref=CODE). No second
// parameter name is introduced, so links stay interchangeable between
// /signup and /register.
//
// Pure and side-effect free: it never mutates state, never calls an API and
// therefore can never award commission — opening a link only pre-fills a form.

export interface ReferralLinkState {
  /** Normalized (trimmed + upper-cased) referral code; '' when absent. */
  code: string;
  /** True when a referral code was present in the invitation link. */
  fromLink: boolean;
}

export function readReferralFromUrl(href: string): ReferralLinkState {
  try {
    const url = new URL(href);
    const fromQuery = url.searchParams.get('ref');
    // Legacy path form /ref/<CODE> is still honoured (it was already parsed by
    // the signup screen before this helper existed).
    const fromPath = url.pathname.match(/^\/ref\/([^/]+)/i)?.[1] ?? null;
    const code = (fromQuery ?? fromPath ?? '').trim().toUpperCase();

    return { code, fromLink: code.length > 0 };
  } catch {
    // Malformed URLs must never break signup — behave exactly like "no code".
    return { code: '', fromLink: false };
  }
}
