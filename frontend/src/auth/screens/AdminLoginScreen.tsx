import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Lock, Phone, ShieldCheck, Zap } from 'lucide-react';
import { useAppAuth } from '../authContext';
import { verifyAdminAccess } from '../../admin/services/adminAuth.service';

export default function AdminLoginScreen() {
  const { login } = useAppAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  const from = state?.from ?? '/admin';
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
      // Backend verification is the authority: routes to setup / verify /
      // dashboard based on role + MFA/AAL2 state — never frontend claims.
      const verified = await verifyAdminAccess();
      const next = verified.data.nextStep;
      if (next === 'MFA_SETUP') {
        navigate('/admin/mfa/setup', { replace: true, state: { from } });
      } else if (next === 'MFA_VERIFY') {
        navigate('/admin/mfa/verify', { replace: true, state: { from } });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      if (/403|denied|forbidden/i.test(message)) {
        setError('Admin access denied. This account is not an authorized admin.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  // NOTE: this screen deliberately does NOT call useAdminSecurity().
  // /admin/login renders OUTSIDE <AdminSecurityProvider> (see App.tsx) so an
  // unauthenticated operator can always reach it. Post-login routing comes
  // from the direct verifyAdminAccess() response below — the backend is the
  // authority, never frontend context state.
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-10">
      <div className="relative w-full max-w-[460px]">
        <div className="rounded-[28px] bg-[#0F0F14]/95 p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}>
              <ShieldCheck size={20} className="text-[#111217]" />
            </div>
            <div>
              <p className="text-lg font-black text-[#F5F5F7]">TradeX Admin</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#A1A4AE]">Operations control panel</p>
            </div>
          </div>
          <h1 className="mt-6 text-[24px] font-black text-[#F5F5F7]">Admin sign in</h1>
          <p className="mt-2 text-sm text-[#A1A4AE]">TradeX account (mobile + password). Access verified server-side.</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">Mobile Number</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#70737E]"><Phone size={16} /></span>
                <input type="tel" placeholder="+91 98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value)}
                  className="w-full rounded-xl border border-[#292B33] bg-[#0E0E12] py-3 pl-11 pr-4 text-sm text-[#F5F5F7] outline-none placeholder:text-[#4F525C] focus:border-[#FF7A18]" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">Password</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#70737E]"><Lock size={16} /></span>
                <input type={showPassword ? 'text' : 'password'} placeholder="........" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#292B33] bg-[#0E0E12] py-3 pl-11 pr-12 text-sm text-[#F5F5F7] outline-none placeholder:text-[#4F525C] focus:border-[#FF7A18]" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="rounded-lg p-1 text-[#70737E] hover:text-[#F5F5F7]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs font-semibold text-[#F87171]">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-[#111217] disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}>
              {busy ? 'Verifying admin access...' : 'Sign in as Admin'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-center gap-4 border-t border-[#1E1E26] pt-5 text-[11px] text-[#A1A4AE]">
            <span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-[#22C55E]" />Server-verified</span>
            <span className="flex items-center gap-1.5"><Zap size={13} className="text-[#FF7A18]" />Supabase session</span>
          </div>
          <p className="mt-4 text-center text-sm text-[#A1A4AE]">
            Not an admin? <Link to="/login" className="font-bold text-[#FF8F3D]">User login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
