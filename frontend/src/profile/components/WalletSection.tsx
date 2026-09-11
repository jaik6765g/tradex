import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, Copy, Eye, Gift, Loader2, LockKeyhole, LogOut, UserPlus, Wallet, X,
  ArrowDownToLine, ArrowUpFromLine, History,
} from 'lucide-react';
import { useWalletContext } from '../../wallet/context/WalletContext';

export default function WalletSection() {
  const navigate = useNavigate();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const {
    address, isConnected, isConnecting, isWrongNetwork, requiredNetworkName,
    openWallet, disconnectWallet, switchToRequiredNetwork,
    authUser, isAuthenticating, authError, retryAuth,
    registrationRequired, registrationWalletAddress, registrationChainId,
    registerWallet, cancelRegistration, isRegistering, registrationError,
    usdtBalance, tdxBalance, nativeBalance, nativeSymbol,
  } = useWalletContext();

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatTDX = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatUSDT = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatBNB = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.000000' : n.toFixed(6);
  };

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyToClipboard = async (text: string, setState: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setState(true);
      setTimeout(() => setState(false), 1800);
    } catch {}
  };

  const handleCopyAddress = () => {
    const target = registrationWalletAddress || address;
    if (target) copyToClipboard(target, setCopiedAddress);
  };

  const handleCopyReferral = () => {
    if (authUser?.referralCode) copyToClipboard(authUser.referralCode, setCopiedReferral);
  };

  useEffect(() => {
    if (!registrationRequired) return;
    try {
      const url = new URL(window.location.href);
      const ref = url.searchParams.get('referralCode') || url.searchParams.get('ref');
      if (ref?.trim()) {
        setReferralCode(ref.trim().toUpperCase());
        return;
      }
      const match = url.pathname.match(/^\/ref\/([^/]+)/i);
      if (match?.[1]) setReferralCode(decodeURIComponent(match[1]).trim().toUpperCase());
    } catch {}
  }, [registrationRequired]);

  useEffect(() => {
    if (!registrationRequired) setReferralCode('');
  }, [registrationRequired]);

  // ============================================================
  // NOT CONNECTED
  // ============================================================

  if (!isConnected && !isConnecting) {
    return (
      <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Wallet size={20} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Wallet</h3>
              <p className="text-xs text-gray-500">Connect your wallet</p>
            </div>
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">Offline</span>
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-5 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center mb-3">
            <Wallet size={26} className="text-gray-400" />
          </div>
          <h4 className="text-sm font-bold text-gray-800">Wallet Not Connected</h4>
          <p className="text-xs text-gray-500 mt-1 max-w-[240px] mx-auto">Connect your wallet to access your TradeX account</p>
          <button onClick={openWallet} className="mt-4 w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition">
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // CONNECTING
  // ============================================================

  if (!isConnected && isConnecting) {
    return (
      <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Loader2 size={20} className="text-blue-600 animate-spin" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Wallet</h3>
            <p className="text-xs text-gray-500">Connecting...</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-6 text-center">
          <Loader2 size={28} className="mx-auto text-blue-600 animate-spin mb-3" />
          <p className="text-sm font-semibold text-gray-800">Connecting Wallet</p>
          <p className="text-xs text-gray-500 mt-1">Please complete in your wallet</p>
        </div>
      </div>
    );
  }

  // ============================================================
  // WRONG NETWORK
  // ============================================================

  if (isWrongNetwork) {
    return (
      <div className="w-full rounded-2xl bg-white border border-yellow-200 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
            <Wallet size={20} className="text-yellow-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Wrong Network</h3>
            <p className="text-xs text-yellow-600">Switch to {requiredNetworkName}</p>
          </div>
        </div>
        <button onClick={() => switchToRequiredNetwork()} className="mt-4 w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition">
          Switch Network
        </button>
      </div>
    );
  }

  // ============================================================
  // REGISTRATION REQUIRED
  // ============================================================

  if (registrationRequired) {
    const regAddress = registrationWalletAddress || address;
    return (
      <div className="w-full rounded-2xl bg-white border border-purple-200 shadow-sm overflow-hidden">
        <div className="bg-purple-50 border-b border-purple-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                <UserPlus size={18} className="text-purple-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Register on TradeX</h3>
                <p className="text-xs text-purple-600">Wallet not registered</p>
              </div>
            </div>
            <button onClick={cancelRegistration} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Wallet Address</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <Wallet size={16} className="text-gray-400" />
              <span className="flex-1 text-sm font-medium text-gray-800">{formatAddress(regAddress)}</span>
              <button onClick={handleCopyAddress} className="text-gray-400 hover:text-gray-600">
                {copiedAddress ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-3 py-2.5">
            <LockKeyhole size={16} className="text-green-500" />
            <span className="text-xs font-medium text-green-700">Wallet verified</span>
          </div>
          <div>
            <label htmlFor="referral" className="flex items-center justify-between text-xs font-semibold text-gray-700">
              <span>Referral Code</span>
              <span className="text-[10px] font-normal text-gray-400">Optional</span>
            </label>
            <input
              id="referral"
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder="Enter referral code"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
              disabled={isRegistering}
            />
          </div>
          {registrationError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
              <p className="text-xs text-red-600">{registrationError}</p>
            </div>
          )}
          <button
            onClick={() => registerWallet(referralCode.trim() || undefined)}
            disabled={isRegistering}
            className="w-full py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition"
          >
            {isRegistering ? (
              <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Creating...</span>
            ) : 'Register Wallet'}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // AUTHENTICATING
  // ============================================================

  if (isAuthenticating && !authUser) {
    return (
      <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="text-blue-600 animate-spin" />
          <div>
            <h3 className="text-sm font-bold text-gray-900">Verifying</h3>
            <p className="text-xs text-gray-500">Please confirm in wallet</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // AUTH ERROR
  // ============================================================

  if (authError && !authUser && !registrationRequired) {
    return (
      <div className="w-full rounded-2xl bg-white border border-red-200 shadow-sm p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <Wallet size={18} className="text-red-500" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-bold text-gray-900">Authentication Failed</h4>
            <p className="text-xs text-red-500 mt-0.5">{authError}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={retryAuth} className="flex-1 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-800 transition">
                Retry
              </button>
              <button onClick={disconnectWallet} className="flex-1 py-2 border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50 transition">
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // CONNECTED WALLET
  // ============================================================

  return (
    <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 pt-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Wallet size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Wallet</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-xs font-medium text-green-600">Connected</span>
            </div>
          </div>
        </div>
        <button onClick={disconnectWallet} className="text-xs font-medium text-red-500 hover:text-red-700 transition">
          Disconnect
        </button>
      </div>

      {/* Balance */}
      <div className="mx-5 mt-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Total Balance</span>
          <Eye size={13} className="text-gray-400" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-gray-900">{formatTDX(tdxBalance)}</span>
          <span className="text-sm font-semibold text-gray-500">TDX</span>
        </div>
        <div className="mt-3 flex gap-4">
          <div>
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">USDT</p>
            <p className="text-sm font-bold text-gray-800">{formatUSDT(usdtBalance)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">{nativeSymbol || 'BNB'}</p>
            <p className="text-sm font-bold text-gray-800">{formatBNB(nativeBalance)}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-2">
        <button onClick={() => navigate('/deposit')} className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-3 hover:bg-blue-50 hover:border-blue-200 transition">
          <ArrowDownToLine size={18} className="text-blue-600" />
          <span className="text-[10px] font-semibold text-gray-700">Deposit</span>
        </button>
        <button onClick={() => navigate('/withdraw')} className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-3 hover:bg-green-50 hover:border-green-200 transition">
          <ArrowUpFromLine size={18} className="text-green-600" />
          <span className="text-[10px] font-semibold text-gray-700">Withdraw</span>
        </button>
        <button onClick={() => navigate('/transactions')} className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-3 hover:bg-orange-50 hover:border-orange-200 transition">
          <History size={18} className="text-orange-600" />
          <span className="text-[10px] font-semibold text-gray-700">History</span>
        </button>
      </div>

      {/* Address */}
      <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
        <Wallet size={15} className="text-gray-400" />
        <span className="flex-1 text-sm font-mono text-gray-700">{formatAddress(address)}</span>
        <button onClick={handleCopyAddress} className="text-gray-400 hover:text-gray-600">
          {copiedAddress ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
        </button>
      </div>

      {/* Referral */}
      {authUser?.referralCode && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2.5">
          <Gift size={15} className="text-yellow-600" />
          <span className="flex-1 text-sm font-mono font-bold text-yellow-700">{authUser.referralCode}</span>
          <button onClick={handleCopyReferral} className="text-gray-400 hover:text-gray-600">
            {copiedReferral ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
          </button>
          <span className="text-[10px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">Active</span>
        </div>
      )}

      {/* Disconnect Button */}
      <div className="px-5 pb-5 pt-4">
        <button onClick={disconnectWallet} className="w-full py-2.5 text-sm font-medium text-red-600 border border-red-300 rounded-xl hover:bg-red-50 hover:border-red-400 transition">
          Disconnect Wallet
        </button>
      </div>
    </div>
  );
}