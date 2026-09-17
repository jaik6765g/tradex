// frontend/src/auth/screens/AdminMfaSetupScreen.tsx
//
// Mandatory admin TOTP enrollment (Supabase Auth MFA).
//
// The TOTP secret / QR data is produced by Supabase during enrollment and is
// held in React state ONLY — never localStorage, never the TradeX backend,
// never an API response after enrollment completes, never logged.

import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Copy, KeyRound, ShieldCheck } from 'lucide-react';

import { useAdminSecurity } from '../../admin/context/AdminSecurityContext';
import {
  AdminMfaService,
  type AdminMfaEnrollment,
} from '../../admin/services/adminMfa.service';

/** Supabase returns the QR either as a data-URI or as raw SVG markup. */
function qrToSrc(qr: string): string {
  const trimmed = qr.trim();
  if (trimmed.startsWith('data:image')) return trimmed;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(trimmed)}`;
}

export default function AdminMfaSetupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mfa, refresh, loading } = useAdminSecurity();

  const from = (location.state as { from?: string } | null)?.from ?? '/admin/overview';
  const [enrollment, setEnrollment] = useState<AdminMfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factorCount = mfa?.factors.length ?? 0;

  // An admin who already reached AAL2 this session never re-enrolls here.
  useEffect(() => {
    if (mfa?.aal === 'aal2') {
      navigate(from, { replace: true });
    }
  }, [from, mfa?.aal, navigate]);

  // Enrollment material must not survive leaving the screen.
  useEffect(() => {
    return () => setEnrollment(null);
  }, []);

  const beginSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Records ADMIN_MFA_ENROLL_STARTED internally; any existing factor is
      // left untouched until the new factor is verified.
      setEnrollment(await AdminMfaService.startEnrollment(factorCount));
    } catch (err) {
      setError(AdminMfaService.getErrorMessage(err, 'Unable to start authenticator setup.'));
    } finally {
      setBusy(false);
    }
  }, [factorCount]);

  const copyKey = useCallback(async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [enrollment]);

  const confirmCode = useCallback(async () => {
    if (!enrollment) return;
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code shown in Google Authenticator.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await AdminMfaService.verifyCode(enrollment.factorId, code);

      if (!result.ok) {
        // The submitted code is NEVER audited or logged — only the outcome.
        await AdminMfaService.recordEvent({
          event: 'ADMIN_MFA_VERIFY_FAILED',
          factorId: enrollment.factorId,
          result: 'enroll_verify_failed',
        }).catch(() => undefined);
        setError(result.message ?? 'That code is not valid. Try again.');
        return;
      }

      await AdminMfaService.recordEvent({
        event: 'ADMIN_MFA_ENROLL_SUCCESS',
        factorId: enrollment.factorId,
        factorCount: factorCount + 1,
        result: 'enrolled',
      }).catch(() => undefined);

      // Enrollment material is no longer needed: drop it from memory.
      setEnrollment(null);
      setCode('');

      const status = await refresh();
      navigate(status?.nextStep === 'ADMIN_DASHBOARD' ? from : '/admin/mfa/verify', {
        replace: true,
      });
    } catch (err) {
      setError(AdminMfaService.getErrorMessage(err, 'Verification failed.'));
    } finally {
      setBusy(false);
    }
  }, [code, enrollment, factorCount, from, navigate, refresh]);

  const qrSrc = enrollment ? qrToSrc(enrollment.qrCode) : null;

  return (
    <Shell>
      <Header />
      {!enrollment ? (
        <StartPanel busy={busy || loading} onStart={() => void beginSetup()} />
      ) : (
        <EnrollPanel
          qrSrc={qrSrc}
          secret={enrollment.secret}
          code={code}
          copied={copied}
          busy={busy}
          onCode={setCode}
          onCopy={() => void copyKey()}
          onConfirm={() => void confirmCode()}
        />
      )}
      {error ? <ErrorNote message={error} /> : null}
      <SignOutLink
        onSignOut={() =>
          void AdminMfaService.signOut().then(() => navigate('/admin/login', { replace: true }))
        }
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Presentational sub-components.
// `secret` is enrollment material produced by Supabase and is rendered only
// while an enrollment is in progress — never persisted, never logged.
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-10">
      <div className="w-full max-w-[460px] rounded-[24px] border border-[#1E1E26] bg-[#0F0F14]/95 p-7">
        {children}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-2xl"
        style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
      >
        <ShieldCheck size={20} className="text-[#111217]" />
      </div>
      <div>
        <p className="text-lg font-black text-[#F5F5F7]">Admin two-factor setup</p>
        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#A1A4AE]">
          Google Authenticator · TOTP
        </p>
      </div>
    </div>
  );
}

function StartPanel({ busy, onStart }: { busy: boolean; onStart: () => void }) {
  return (
    <div className="mt-6">
      <p className="text-sm text-[#A1A4AE]">
        Two-factor authentication is mandatory for every TradeX admin. Your TradeX account
        uses the existing Supabase session — this adds a TOTP factor on top of it.
      </p>
      <ol className="mt-4 space-y-1.5 text-xs text-[#A1A4AE]">
        <li>1. Install Google Authenticator (or any TOTP app).</li>
        <li>2. Scan the QR code, or enter the setup key manually.</li>
        <li>3. Enter the 6-digit code to activate admin access.</li>
      </ol>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-[#111217] disabled:opacity-70"
        style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
      >
        <KeyRound size={16} />
        {busy ? 'Starting setup…' : 'Begin authenticator setup'}
      </button>
    </div>
  );
}


function EnrollPanel({
  qrSrc,
  secret,
  code,
  copied,
  busy,
  onCode,
  onCopy,
  onConfirm,
}: {
  qrSrc: string | null;
  secret: string;
  code: string;
  copied: boolean;
  busy: boolean;
  onCode: (value: string) => void;
  onCopy: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-col items-center rounded-[16px] border border-[#292B33] bg-[#0E0E12] p-4">
        {qrSrc ? (
          <img
            src={qrSrc}
            alt="Google Authenticator setup QR code"
            className="h-[180px] w-[180px] rounded-xl bg-white p-2"
          />
        ) : null}
        <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[#A1A4AE]">
          Manual setup key
        </p>
        <div className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-[#292B33] bg-[#15161C] px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-center text-sm font-bold tracking-[0.18em] text-[#F5F5F7]">
            {secret}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="rounded-lg p-1.5 text-[#A1A4AE] hover:text-[#F5F5F7]"
            aria-label="Copy setup key"
          >
            {copied ? <Check size={15} className="text-[#22C55E]" /> : <Copy size={15} />}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-[#70737E]">
          Shown once during setup. TradeX never stores this key.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
          6-digit code
        </label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => onCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="w-full rounded-xl border border-[#292B33] bg-[#0E0E12] px-4 py-3 text-center text-lg font-black tracking-[0.3em] text-[#F5F5F7] outline-none placeholder:text-[#4F525C] focus:border-[#FF7A18]"
        />
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-[#111217] disabled:opacity-70"
        style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
      >
        {busy ? 'Verifying…' : 'Activate admin 2FA'}
      </button>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs font-semibold text-[#F87171]">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SignOutLink({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className="mt-6 w-full text-center text-xs font-bold text-[#A1A4AE] hover:text-[#F5F5F7]"
    >
      Sign out
    </button>
  );
}