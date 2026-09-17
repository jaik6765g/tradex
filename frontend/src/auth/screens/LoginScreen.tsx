import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Gift,
  Lock,
  Phone,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

import { useAppAuth } from '../authContext';

export default function LoginScreen() {
  const { login } = useAppAuth();
  const navigate = useNavigate();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await login(mobile, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0B0C10] px-4 py-10">
      {/* Ambient premium glows */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, #FF7A18, transparent 70%)' }} />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full opacity-20 blur-3xl" style={{ background: 'radial-gradient(circle, #C99752, transparent 70%)' }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full opacity-15 blur-3xl" style={{ background: 'radial-gradient(circle, #FF8F3D, transparent 70%)' }} />

      <div className="relative w-full max-w-[460px]">
        <div className="rounded-[28px] p-px" style={{ background: 'linear-gradient(160deg, rgba(255,122,24,0.65), rgba(38,38,46,0.5) 40%, rgba(124,58,237,0.45))' }}>
          <div className="rounded-[28px] bg-[#0F0F14]/95 p-7 backdrop-blur" style={{ boxShadow: '0 24px 80px -24px rgba(255,122,24,0.35)' }}>
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)', boxShadow: '0 8px 24px -8px rgba(255,122,24,0.7)' }}>
                <Sparkles size={20} className="text-[#111217]" />
              </div>
              <div>
                <p className="text-lg font-black leading-none tracking-tight text-[#F5F5F7]">TradeX</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#A1A4AE]">Crypto Trading</p>
              </div>
            </div>

            {/* Heading */}
            <h1 className="mt-6 text-[28px] font-black leading-tight tracking-tight text-[#F5F5F7]">
              Welcome back to{' '}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg, #FF8F3D, #FF7A18)' }}>TradeX</span>
            </h1>
            <p className="mt-2 text-sm text-[#A1A4AE]">Login with your mobile number and password.</p>

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
                label="Password"
                icon={<Lock size={16} />}
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                right={<ToggleButton shown={showPassword} onClick={() => setShowPassword((v) => !v)} />}
              />

              <div className="text-right">
                <Link to="/forgot-password" className="text-xs font-bold text-[#FF8F3D] transition-colors hover:text-[#FF7A18]">
                  Forgot Password?
                </Link>
              </div>

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
                style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)', boxShadow: '0 14px 34px -12px rgba(255,122,24,0.65)' }}
              >
                {busy ? 'Logging in…' : 'Login'}
                {!busy && <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />}
              </button>
            </form>

            {/* Trust strip */}
            <div className="mt-6 flex items-center justify-center gap-4 border-t border-[#1E1E26] pt-5 text-[11px] font-medium text-[#A1A4AE]">
              <span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-[#22C55E]" />Secure</span>
              <span className="flex items-center gap-1.5"><Zap size={13} className="text-[#FF7A18]" />No OTP</span>
              <span className="flex items-center gap-1.5"><Gift size={13} className="text-[#FF8F3D]" />Rewards</span>
            </div>

            <p className="mt-4 text-center text-sm text-[#A1A4AE]">
              Don&apos;t have an account?{' '}
              <Link to="/signup" className="font-bold text-[#FF8F3D] transition-colors hover:text-[#FF7A18]">Sign Up</Link>
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
  ...inputProps
}: {
  label: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
        {label}
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