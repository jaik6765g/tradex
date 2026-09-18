import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Gift,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

import { useAppAuth } from '../authContext';
import { readReferralFromUrl } from '../utils/referralLink';

function passwordStrength(password: string): number {
  if (!password) {
    return 0;
  }

  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  return Math.min(score, 4);
}

export default function SignupScreen() {
  const { signup } = useAppAuth();
  const navigate = useNavigate();

  // Read once on mount: the code must survive every re-render and stay
  // visible while the user fills mobile/email/password.
  const initialReferral = useMemo(
    () => readReferralFromUrl(window.location.href),
    [],
  );

  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referral, setReferral] = useState(initialReferral.code);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // The invitation hint stays only while the untouched link code is applied.
  // The field itself remains editable — existing rules treat it as optional
  // and the backend re-validates it authoritatively.
  const linkReferralApplied =
    initialReferral.fromLink &&
    referral.trim().toUpperCase() === initialReferral.code;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^\+?[1-9]\d{6,14}$/.test(mobile.replace(/[\s-]/g, ''))) {
      setError('Enter a valid mobile number (e.g. +911234567890)');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);

    try {
      await signup(mobile, email, password, referral.trim() || undefined);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0B0C10] px-4 py-10">
      {/* Ambient premium glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF7A18, transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #C99752, transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF8F3D, transparent 70%)' }}
      />

      <div className="relative w-full max-w-[460px]">
        <div
          className="rounded-[28px] p-px"
          style={{
            background:
              'linear-gradient(160deg, rgba(255,122,24,0.65), rgba(38,38,46,0.5) 40%, rgba(124,58,237,0.45))',
          }}
        >
          <div
            className="rounded-[28px] bg-[#0F0F14]/95 p-7 backdrop-blur"
            style={{ boxShadow: '0 24px 80px -24px rgba(255,122,24,0.35)' }}
          >
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{
                  background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)',
                  boxShadow: '0 8px 24px -8px rgba(255,122,24,0.7)',
                }}
              >
                <Sparkles size={20} className="text-[#111217]" />
              </div>
              <div>
                <p className="text-lg font-black leading-none tracking-tight text-[#F5F5F7]">
                  TradeX
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#A1A4AE]">
                  Crypto Trading
                </p>
              </div>
            </div>

            {/* Tagline — now the primary heading (the "Create your premium
                account" heading was removed by request). `mt-6` kept so the
                card spacing is unchanged. */}
            <p className="mt-6 text-[22px] font-black leading-tight tracking-tight text-[#F5F5F7]">
              Join TradeX and start trading.
            </p>

            {/* Form */}
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <Field
                label="Mobile Number"
                icon={<Phone size={16} />}
                type="tel"
                placeholder="+91 98765 43210"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                required
                autoComplete="tel"
              />

              <Field
                label="Email Address"
                icon={<Mail size={16} />}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />

              <div>
                <Field
                  label="Password"
                  icon={<Lock size={16} />}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  right={
                    <ToggleButton
                      shown={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    />
                  }
                />
                <PasswordStrength password={password} />
              </div>

              <Field
                label="Confirm Password"
                icon={<Lock size={16} />}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                right={
                  <ToggleButton
                    shown={showConfirm}
                    onClick={() => setShowConfirm((v) => !v)}
                  />
                }
              />

              <Field
                label="Referral Code"
                icon={<Gift size={16} />}
                type="text"
                placeholder="TDX12345"
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
                optional
                hint={
                  linkReferralApplied
                    ? 'Referral code applied from invitation link.'
                    : 'Have a code? Unlock exclusive rewards.'
                }
                hintTone={linkReferralApplied ? 'success' : 'muted'}
              />

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs font-semibold text-[#F87171]">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="group mt-1 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-[#111217] transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                style={{
                  background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)',
                  boxShadow: '0 14px 34px -12px rgba(255,122,24,0.65)',
                }}
              >
                {busy ? 'Creating account…' : 'Create Account'}
                {!busy && (
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                )}
              </button>
            </form>

            {/* Trust strip */}
            <div className="mt-6 flex items-center justify-center gap-4 border-t border-[#1E1E26] pt-5 text-[11px] font-medium text-[#A1A4AE]">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-[#22C55E]" />
                Secure
              </span>
              <span className="flex items-center gap-1.5">
                <Zap size={13} className="text-[#FF7A18]" />
                No OTP
              </span>
              <span className="flex items-center gap-1.5">
                <Gift size={13} className="text-[#FF8F3D]" />
                Rewards
              </span>
            </div>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-[#70737E]">
              By continuing you agree to TradeX&apos;s Terms &amp; Privacy
              Policy.
            </p>

            <p className="mt-4 text-center text-sm text-[#A1A4AE]">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-bold text-[#FF8F3D] transition-colors hover:text-[#FF7A18]"
              >
                Log in
              </Link>
            </p>
              </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  right,
  hint,
  hintTone = 'muted',
  optional,
  ...inputProps
}: {
  label: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  hint?: string;
  hintTone?: 'muted' | 'success';
  optional?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
        {label}
        {optional && (
          <span className="rounded-full border border-[#2A2A33] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#70737E]">
            Optional
          </span>
        )}
      </label>

      <div className="group relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#70737E] transition-colors group-focus-within:text-[#FF7A18]">
          {icon}
        </span>

        <input
          {...inputProps}
          className={`w-full rounded-xl border border-[#292B33] bg-[#0E0E12] py-3 text-sm text-[#F5F5F7] outline-none transition placeholder:text-[#4F525C] focus:border-[#FF7A18] focus:ring-2 focus:ring-[#FF7A18]/20 ${
            right ? 'pl-11 pr-12' : 'pl-11 pr-4'
          }`}
        />

        {right && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {right}
          </span>
        )}
      </div>

      {hint && (
        <p
          className={`mt-1 text-[11px] ${
            hintTone === 'success'
              ? 'font-semibold text-[#22C55E]'
              : 'text-[#70737E]'
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function ToggleButton({
  shown,
  onClick,
}: {
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="rounded-lg p-1 text-[#70737E] transition-colors hover:text-[#F5F5F7]"
    >
      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );
}

function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return null;
  }

  const score = passwordStrength(password);
  const color =
    score <= 1
      ? '#EF4444'
      : score === 2
        ? '#FF7A18'
        : score === 3
          ? '#F59E0B'
          : '#22C55E';
  const label =
    score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors duration-300"
            style={{ background: i < score ? color : '#292B33' }}
          />
        ))}
      </div>
      <p className="mt-1 text-right text-[11px] font-semibold" style={{ color }}>
        {label}
      </p>
    </div>
  );
}