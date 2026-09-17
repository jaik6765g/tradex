// frontend/src/auth/screens/AdminMfaVerifyScreen.tsx
//
// AAL1 -> AAL2 step-up for an admin who already has a verified TOTP factor.
//
// The 6-digit code is submitted to Supabase Auth only (mfa.challenge/verify).
// It is never sent to, stored by, or logged by the TradeX backend — the backend
// only ever sees the signature-verified `aal` claim in the access token, plus
// the outcome event recorded via /admin/auth/mfa/events.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';

import { useAdminSecurity } from '../../admin/context/AdminSecurityContext';
import { AdminMfaService } from '../../admin/services/adminMfa.service';

export default function AdminMfaVerifyScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mfa, refresh, loading } = useAdminSecurity();

  const from = (location.state as { from?: string } | null)?.from ?? '/admin/overview';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factor = useMemo(
    () => (mfa?.factors ?? []).find((f) => f.status === 'verified') ?? null,
    [mfa?.factors],
  );

  // Already stepped up this session -> straight through.
  useEffect(() => {
    if (mfa?.aal === 'aal2') {
      navigate(from, { replace: true });
    }
  }, [from, mfa?.aal, navigate]);

  const submit = useCallback(async () => {
    if (!factor) {
      setError('No verified authenticator found. Set up 2FA first.');
      return;
    }
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from Google Authenticator.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await AdminMfaService.verifyCode(factor.id, code);

      if (!result.ok) {
        // Only the OUTCOME is audited — the submitted code is never recorded.
        await AdminMfaService.recordEvent({
          event: 'ADMIN_MFA_VERIFY_FAILED',
          factorId: factor.id,
          result: 'invalid_code',
        }).catch(() => undefined);
        setError(result.message ?? 'That code is not valid. Try again.');
        return;
      }

      await AdminMfaService.recordEvent({
        event: 'ADMIN_MFA_VERIFY_SUCCESS',
        factorId: factor.id,
        result: 'ok',
      }).catch(() => undefined);

      setCode('');

      // Re-verify with the backend: routing is only ever driven by the
      // backend-verified state, never by frontend claims.
      const status = await refresh();
      navigate(status?.nextStep === 'ADMIN_DASHBOARD' ? from : '/admin/mfa/verify', {
        replace: true,
      });
    } catch (err) {
      setError(AdminMfaService.getErrorMessage(err, 'Verification failed.'));
    } finally {
      setBusy(false);
    }
  }, [code, factor, from, navigate, refresh]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-10">
      <div className="w-full max-w-[440px] rounded-[24px] border border-[#1E1E26] bg-[#0F0F14]/95 p-7">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
          >
            <ShieldCheck size={18} className="text-[#111217]" />
          </div>
          <div>
            <p className="text-lg font-black text-[#F5F5F7]">Two-factor verification</p>
            <p className="text-[11px] text-[#A1A4AE]">
              Enter the code from Google Authenticator to continue.
            </p>
          </div>
        </div>

        {mfa?.throttle?.blocked && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs font-semibold text-[#F87171]">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>
              Too many invalid codes. Try again in {mfa.throttle.retryAfterSeconds}s.
            </span>
          </div>
        )}

        <div className="mt-5">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
            6-digit code
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#70737E]">
              <KeyRound size={16} />
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="123456"
              className="w-full rounded-xl border border-[#292B33] bg-[#0E0E12] py-3 pl-11 pr-4 text-center text-lg font-black tracking-[0.3em] text-[#F5F5F7] outline-none placeholder:text-[#4F525C] focus:border-[#FF7A18]"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs font-semibold text-[#F87171]">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || loading || mfa?.throttle?.blocked === true}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-[#111217] disabled:opacity-70"
          style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
        >
          {busy ? 'Verifying…' : 'Verify and continue'}
        </button>

        <button
          type="button"
          onClick={() =>
            void AdminMfaService.signOut().then(() => navigate('/admin/login', { replace: true }))
          }
          className="mt-5 w-full text-center text-xs font-bold text-[#A1A4AE] hover:text-[#F5F5F7]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}