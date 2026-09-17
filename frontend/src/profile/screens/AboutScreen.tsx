import React from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  Zap,
  Wallet,
  Gamepad2,
  Sparkles,
  Rocket,
  TrendingUp,
  BarChart3,
  Activity,
  Layers3,
  CircleDollarSign,
  Gauge,
  LockKeyhole,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AboutScreen() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#111217] via-[#1B1917] to-[#292B33] overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] bg-[#C99752]/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-20 -left-20 w-[300px] h-[300px] bg-[#FF7A18]/10 rounded-full blur-[100px]" />

        <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(to_right,#000000_1px,transparent_1px),linear-gradient(to_bottom,#000000_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-[#34343E]/60 bg-[#15161C]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center px-4">
          <button
            onClick={() => navigate('/profile')}
            className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl border border-[#34343E] bg-[#15161C] hover:bg-[#1B1917] transition-colors"
          >
            <ArrowLeft size={20} className="text-[#A1A4AE]" />
          </button>

          <div>
            <h1 className="text-base font-bold text-[#F5F5F7]">
              About TradeX
            </h1>

            <p className="text-[10px] text-[#70737E]">
              About the TradeX platform
            </p>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-8">

        {/* ========================================================= */}
        {/* BRAND */}
        {/* ========================================================= */}

        <div className="relative overflow-hidden rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-8 text-center shadow-[0_8px_40px_rgba(16,24,40,0.08)]">

          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#C99752] via-[#C99752] to-[#8F4817]" />

          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#C99752] to-[#8F4817] shadow-[0_8px_30px_rgba(201,151,82,0.3)]">
            <Zap
              size={38}
              className="text-white"
              strokeWidth={2.5}
            />
          </div>

          <h2 className="text-3xl font-black text-[#F5F5F7] tracking-tight">
            TradeX
          </h2>

          <p className="mt-2 text-sm text-[#A1A4AE]">
            Web3 Trading & Gaming Platform
          </p>

          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#211810] to-[#211810] border border-[#34261C] px-4 py-1.5 text-[11px] font-semibold text-[#C99752]">
            <Sparkles size={12} />
            Version 1.0.0
          </div>
        </div>


        {/* ========================================================= */}
        {/* ABOUT */}
        {/* ========================================================= */}

        <div className="mt-5 rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-6 shadow-[0_8px_40px_rgba(16,24,40,0.06)]">

          <h3 className="text-lg font-black text-[#F5F5F7]">
            About TradeX
          </h3>

          <p className="mt-3 text-sm leading-7 text-[#A1A4AE]">
            TradeX is a Web3 platform built around a mobile-first
            account experience. It brings digital asset trading, wallet
            services, account activity and gaming experiences together
            within a single platform.
          </p>

          <p className="mt-3 text-sm leading-7 text-[#A1A4AE]">
            Users sign in with their mobile number and interact with
            available TradeX services while maintaining visibility over
            balances, transactions, trading activity and platform
            operations.
          </p>
        </div>


        {/* ========================================================= */}
        {/* TRADING */}
        {/* ========================================================= */}

        <div className="mt-5 rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-6 shadow-[0_8px_40px_rgba(16,24,40,0.06)]">

          <div className="flex items-center gap-2">
            <TrendingUp
              size={19}
              className="text-[#C99752]"
            />

            <h3 className="text-lg font-black text-[#F5F5F7]">
              Trading on TradeX
            </h3>
          </div>

          <p className="mt-3 text-sm leading-7 text-[#A1A4AE]">
            TradeX provides a dedicated trading environment designed
            to give users access to market activity, trading operations
            and portfolio information from one interface.
          </p>

          <p className="mt-3 text-sm leading-7 text-[#A1A4AE]">
            The trading architecture separates market data, order
            processing, positions and portfolio information so that
            different parts of the trading experience can operate
            independently while remaining connected to the user's
            account.
          </p>


          {/* Trading Features */}

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">

            <TradingFeature
              icon={BarChart3}
              title="Market Data"
              text="View supported market prices and trading information through the TradeX trading interface."
              gradient="from-[#211810] to-[#211810]"
              iconColor="text-[#C99752]"
            />

            <TradingFeature
              icon={Activity}
              title="Pulse Trading"
              text="TradeX includes a Pulse Trading environment for active trading workflows and market operations."
              gradient="from-[#211810] to-[#211810]"
              iconColor="text-[#C99752]"
            />

            <TradingFeature
              icon={Layers3}
              title="Orders"
              text="Trading activity can be organized around open and historical orders for better account visibility."
              gradient="from-emerald-50 to-emerald-100"
              iconColor="text-emerald-600"
            />

            <TradingFeature
              icon={TrendingUp}
              title="Positions"
              text="Track open trading positions and monitor their current state from the trading experience."
              gradient="from-[#2A190D] to-[#2A190D]"
              iconColor="text-[#FF8F3D]"
            />

            <TradingFeature
              icon={CircleDollarSign}
              title="Portfolio"
              text="Portfolio information brings trading-related account activity together for easier monitoring."
              gradient="from-[#2A190D] to-[#211810]"
              iconColor="text-[#C99752]"
            />

            <TradingFeature
              icon={Gauge}
              title="Risk & Liquidity"
              text="TradeX includes platform-level risk and liquidity services supporting the trading infrastructure."
              gradient="from-[#2A190D] to-[#2A190D]"
              iconColor="text-[#FF8F3D]"
            />

          </div>
        </div>


        {/* ========================================================= */}
        {/* HOW TRADING WORKS */}
        {/* ========================================================= */}

        <div className="mt-5 rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-6 shadow-[0_8px_40px_rgba(16,24,40,0.06)]">

          <div className="flex items-center gap-2">
            <Rocket
              size={18}
              className="text-[#C99752]"
            />

            <h3 className="text-lg font-black text-[#F5F5F7]">
              Trading Experience
            </h3>
          </div>

          <div className="mt-5 space-y-4">

            <Step
              number="01"
              title="Create Account"
              text="Sign up with your mobile number to activate your TradeX account."
            />

            <Step
              number="02"
              title="View Market"
              text="Explore available market information and supported trading instruments."
            />

            <Step
              number="03"
              title="Place Trade"
              text="Submit trading operations through the TradeX trading interface."
            />

            <Step
              number="04"
              title="Monitor Position"
              text="Track open positions, active orders and portfolio activity."
            />

            <Step
              number="05"
              title="Review Activity"
              text="Review historical trades and account activity through the platform."
            />

          </div>
        </div>


        {/* ========================================================= */}
        {/* PLATFORM */}
        {/* ========================================================= */}

        <div className="mt-5 rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-6 shadow-[0_8px_40px_rgba(16,24,40,0.06)]">

          <div className="flex items-center gap-2">

            <Rocket
              size={18}
              className="text-[#C99752]"
            />

            <h3 className="text-lg font-black text-[#F5F5F7]">
              Platform
            </h3>

          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">

            <Feature
              icon={Wallet}
              title="TDX Wallet"
              text="Manage your TradeX TDX wallet, deposits, withdrawals and full history."
              gradient="from-[#211810] to-[#211810]"
              iconColor="text-[#C99752]"
            />

            <Feature
              icon={Zap}
              title="Trading"
              text="Access the TradeX trading environment and supported market services."
              gradient="from-[#211810] to-[#211810]"
              iconColor="text-[#C99752]"
            />

            <Feature
              icon={Gamepad2}
              title="Gaming"
              text="Explore supported gaming experiences available within TradeX."
              gradient="from-emerald-50 to-emerald-100"
              iconColor="text-emerald-600"
            />

            <Feature
              icon={ShieldCheck}
              title="Security"
              text="Account access is protected by mobile-number login and secure sessions."
              gradient="from-[#2A190D] to-[#2A190D]"
              iconColor="text-[#FF8F3D]"
            />

          </div>
        </div>


        {/* ========================================================= */}
        {/* WALLET & ACCOUNT */}
        {/* ========================================================= */}

        <div className="mt-5 rounded-3xl border border-[#34343E] bg-[#15161C]/70 backdrop-blur-xl p-6 shadow-[0_8px_40px_rgba(16,24,40,0.06)]">

          <div className="flex items-center gap-2">

            <LockKeyhole
              size={18}
              className="text-[#C99752]"
            />

            <h3 className="text-lg font-black text-[#F5F5F7]">
              Account & Wallet
            </h3>

          </div>

          <div className="mt-4 space-y-3 text-sm text-[#A1A4AE]">

            <p>
              TradeX accounts are created and accessed with mobile-number
              login, keeping account access simple and secure.
            </p>

            <p>
              TDX balances, deposits, withdrawals and transaction
              activity are handled through the platform's wallet
              infrastructure.
            </p>

            <p>
              Users can review their account activity and supported
              trading operations from their TradeX profile.
            </p>

          </div>
        </div>


        {/* ========================================================= */}
        {/* FOOTER */}
        {/* ========================================================= */}

        <div className="py-10 text-center">

          <div className="mx-auto mb-4 h-px w-24 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />

          <p className="text-xs font-medium text-[#A1A4AE]">
            © {new Date().getFullYear()} TradeX
          </p>

          <p className="mt-1 text-[10px] text-[#70737E]">
            Built for the Web3 ecosystem
          </p>

        </div>

      </div>
    </div>
  );
}


/* ============================================================= */
/* TRADING FEATURE */
/* ============================================================= */

function TradingFeature({
  icon: Icon,
  title,
  text,
  gradient,
  iconColor,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
  gradient: string;
  iconColor: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-[#292B33] bg-[#15161C] p-4 shadow-sm hover:shadow-md transition-shadow">

      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient}`}
      >
        <Icon
          size={20}
          className={iconColor}
        />
      </div>

      <div className="flex-1">

        <div className="text-sm font-bold text-[#F5F5F7]">
          {title}
        </div>

        <div className="mt-1 text-xs leading-5 text-[#A1A4AE]">
          {text}
        </div>

      </div>
    </div>
  );
}


/* ============================================================= */
/* PLATFORM FEATURE */
/* ============================================================= */

function Feature({
  icon: Icon,
  title,
  text,
  gradient,
  iconColor,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
  gradient: string;
  iconColor: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-[#292B33] bg-[#15161C] p-4 shadow-sm hover:shadow-md transition-shadow">

      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient}`}
      >
        <Icon
          size={20}
          className={iconColor}
        />
      </div>

      <div className="flex-1">

        <div className="text-sm font-bold text-[#F5F5F7]">
          {title}
        </div>

        <div className="mt-1 text-xs leading-5 text-[#A1A4AE]">
          {text}
        </div>

      </div>
    </div>
  );
}


/* ============================================================= */
/* TRADING STEP */
/* ============================================================= */

function Step({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-4">

      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#C99752] to-[#8F4817] text-[11px] font-bold text-white shadow-sm">
        {number}
      </div>

      <div>

        <div className="text-sm font-bold text-[#F5F5F7]">
          {title}
        </div>

        <div className="mt-1 text-xs leading-5 text-[#A1A4AE]">
          {text}
        </div>

      </div>

    </div>
  );
}