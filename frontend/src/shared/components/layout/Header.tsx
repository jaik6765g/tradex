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
    isAuthenticated,
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
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#292B33]/70 bg-[#111217]/90 backdrop-blur-xl px-3 py-2">
      <div className="mx-auto flex max-w-7xl items-center justify-between">

        {/* ====================================================
            LOGO WITH IMAGE
        ==================================================== */}
        <Link
          to="/"
          className="group flex items-center gap-2 text-base font-black tracking-tight text-[#FF8F3D]"
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
        <div className="group relative flex items-center gap-2.5 rounded-2xl border border-[#292B33] bg-[#15161C]/90 px-3.5 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-[#FF7A18]/35">

          {/* Coin Icon with Premium Glow */}
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A18] via-[#FF8F3D] to-[#EA580C] shadow-[0_2px_6px_rgba(255,122,24,0.35)]">
            <Coins size={14} className="text-white" />
          </div>

          {/* Balance Content */}
          <div className="flex flex-col leading-tight">
            {/* Label - Only TDX text */}
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[#FF8F3D]/90">
              TDX Balance
            </span>

            {/* Value - No duplicate TDX text */}
            <span className="text-sm font-black text-[#F5F5F7] transition-all duration-300 group-hover:text-[#FF8F3D]">
              {isAuthenticated ? (
                showBalance ? (
                  <span>{formattedBalance}</span>
                ) : (
                  <span className="text-[#70737E]">••••••</span>
                )
              ) : (
                <span className="text-[#70737E]">0.00</span>
              )}
            </span>
          </div>

          {/* Toggle Visibility Button */}
          <button
            onClick={() => setShowBalance(!showBalance)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[#70737E] transition-all duration-200 hover:bg-white/5 hover:text-[#FF8F3D]"
            aria-label={showBalance ? 'Hide balance' : 'Show balance'}
          >
            {showBalance ? (
              <EyeOff size={13} />
            ) : (
              <Eye size={13} />
            )}
          </button>

          {/* Account Status Dot */}
          {isAuthenticated && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-400 ring-2 ring-[#111217] shadow-[0_0_10px_rgba(74,222,128,0.6)] animate-pulse" />
          )}
        </div>

      </div>
    </header>
  );
}