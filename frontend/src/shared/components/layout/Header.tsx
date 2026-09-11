// ============================================================
// TRADEX HEADER (PREMIUM BALANCE CARD)
// ============================================================
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { Eye, EyeOff, Coins } from 'lucide-react';

import { useWalletContext } from '../../../wallet/context/WalletContext';

import { formatBalanceAmount } from '../../../wallet/services/wallet.service';

// ============================================================
// LOGO IMPORT - frontend/assets/logo.png
// ============================================================
import logo from '/assets/logo.png';

export default function Header() {
  const {
    balance,
    isConnected,
  } = useWalletContext();

  const [showBalance, setShowBalance] = useState(true);

  const tdxBalance = formatBalanceAmount(
    balance.tdxAvailable || balance.tdx || '0',
    2,
  );

  const formattedBalance = Number(tdxBalance).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200/60 bg-white/95 backdrop-blur-sm px-3 py-2">
      <div className="mx-auto flex max-w-7xl items-center justify-between">

        {/* ====================================================
            LOGO WITH IMAGE
        ==================================================== */}
        <Link
          to="/"
          className="group flex items-center gap-2 text-base font-black tracking-tight text-blue-600"
        >
          <img 
            src={logo} 
            alt="TradeX Logo"
            className="h-9 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
          />
        </Link>

        {/* ====================================================
            PREMIUM TDX BALANCE CARD
        ==================================================== */}
        <div className="group relative flex items-center gap-2.5 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-50/80 via-white/80 to-purple-50/80 px-4 py-2 shadow-[0_4px_20px_rgba(99,102,241,0.15)] backdrop-blur-xl transition-all duration-300 hover:border-indigo-500/40 hover:shadow-[0_6px_30px_rgba(99,102,241,0.25)]">

          {/* Coin Icon with Premium Glow */}
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 shadow-[0_2px_8px_rgba(99,102,241,0.4)]">
            <Coins size={14} className="text-white" />
          </div>

          {/* Balance Content */}
          <div className="flex flex-col leading-tight">
            {/* Label - Only TDX text */}
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-indigo-500/80">
              TDX Balance
            </span>

            {/* Value - No duplicate TDX text */}
            <span className="text-sm font-black text-gray-900 transition-all duration-300 group-hover:text-indigo-600">
              {isConnected ? (
                showBalance ? (
                  <span>{formattedBalance}</span>
                ) : (
                  <span className="text-gray-400">••••••</span>
                )
              ) : (
                <span className="text-gray-400">0.00</span>
              )}
            </span>
          </div>

          {/* Toggle Visibility Button */}
          <button
            onClick={() => setShowBalance(!showBalance)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-all duration-200 hover:bg-indigo-100 hover:text-indigo-600"
            aria-label={showBalance ? 'Hide balance' : 'Show balance'}
          >
            {showBalance ? (
              <EyeOff size={13} />
            ) : (
              <Eye size={13} />
            )}
          </button>

          {/* Connected Status Dot */}
          {isConnected && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-400 ring-2 ring-white shadow-[0_0_10px_rgba(74,222,128,0.6)] animate-pulse" />
          )}
        </div>

      </div>
    </header>
  );
}