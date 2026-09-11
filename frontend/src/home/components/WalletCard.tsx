import React, {
  useEffect,
  useState,
} from 'react';

import {
  Check,
  Copy,
  Gift,
  Loader2,
  LockKeyhole,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';

import { useWalletContext } from '../../wallet/context/WalletContext';

// ============================================================
// WALLET CARD
// ============================================================
//
// STATES
// ------------------------------------------------------------
// 1. Disconnected
// 2. Connected + authenticating
// 3. New wallet -> Registration card
// 4. Registered wallet -> Wallet connected card
// 5. Registration error
//
// ============================================================

export default function WalletCard() {
  const {
    address,
    isConnected,
    chainId,

    requiredChainId,
    requiredNetworkName,
    isWrongNetwork,

    openWallet,
    disconnectWallet,
    switchToRequiredNetwork,

    isAuthenticating,
    authError,
    retryAuth,

    authUser,

    registrationRequired,
    registrationWalletAddress,

    registerWallet,
    cancelRegistration,

    isRegistering,
    registrationError,
  } = useWalletContext();

  // ============================================================
  // LOCAL STATE
  // ============================================================

  const [
    referralCode,
    setReferralCode,
  ] = useState('');

  const [
    copied,
    setCopied,
  ] = useState(false);

  // ============================================================
  // REFERRAL FROM URL
  // ============================================================

  useEffect(() => {
    if (
      typeof window === 'undefined'
    ) {
      return;
    }

    try {
      const url =
        new URL(
          window.location.href,
        );

      const referral =
        url.searchParams.get(
          'referralCode',
        ) ||
        url.searchParams.get(
          'ref',
        );

      if (
        referral &&
        referral.trim()
      ) {
        setReferralCode(
          referral
            .trim()
            .toUpperCase(),
        );
        return;
      }

      const match =
        url.pathname.match(
          /^\/ref\/([^/]+)/i,
        );

      if (
        match &&
        match[1]
      ) {
        setReferralCode(
          decodeURIComponent(
            match[1],
          )
            .trim()
            .toUpperCase(),
        );
      }
    } catch {
      // Ignore invalid URL.
    }
  }, []);

  // ============================================================
  // COPY ADDRESS
  // ============================================================

  const handleCopy =
    async () => {
      const walletAddress =
        address ||
        registrationWalletAddress;

      if (!walletAddress) {
        return;
      }

      try {
        await navigator.clipboard.writeText(
          walletAddress,
        );

        setCopied(true);

        window.setTimeout(
          () => {
            setCopied(false);
          },
          2000,
        );
      } catch {
        setCopied(false);
      }
    };

  // ============================================================
  // REGISTER
  // ============================================================

  const handleRegister =
    async () => {
      try {
        await registerWallet(
          referralCode.trim()
            ? referralCode
                .trim()
                .toUpperCase()
            : undefined,
        );
      } catch {
        // Error is already stored in context.
      }
    };

  // ============================================================
  // SHORT ADDRESS
  // ============================================================

  const formatAddress =
    (
      walletAddress?: string | null,
    ) => {
      if (!walletAddress) {
        return '---';
      }

      return `${walletAddress.slice(
        0,
        6,
      )}...${walletAddress.slice(-4)}`;
    };

  // ============================================================
  // NETWORK NAME
  // ============================================================

  const networkName =
    chainId ===
    requiredChainId
      ? requiredNetworkName
      : `Chain ${chainId ?? '---'}`;

  // ============================================================
  // 1. DISCONNECTED
  // ============================================================

  if (!isConnected) {
    return (
      <section
        className="
          w-full
          rounded-[20px]
          border
          border-[#E7E9EE]
          bg-white
          p-5
          shadow-[0_4px_12px_rgba(0,0,0,0.03)]
        "
      >
        {/* Header */}

        <div
          className="
            flex
            items-center
            justify-between
            gap-4
          "
        >
          <div className="flex items-center gap-3">
            <div
              className="
                flex
                h-11
                w-11
                items-center
                justify-center
                rounded-[14px]
                bg-[#EEF4FF]
              "
            >
              <Wallet
                size={22}
                className="text-[#2563EB]"
              />
            </div>

            <div>
              <h3
                className="
                  text-[17px]
                  font-extrabold
                  text-[#111827]
                "
              >
                Wallet
              </h3>

              <p
                className="
                  mt-0.5
                  text-[13px]
                  text-[#667085]
                "
              >
                Connect your wallet
              </p>
            </div>
          </div>

          <span
            className="
              rounded-full
              bg-[#F2F4F7]
              px-3
              py-1.5
              text-[12px]
              font-bold
              text-[#667085]
            "
          >
            Not Connected
          </span>
        </div>

        {/* Connect area */}

        <div
          className="
            mt-5
            space-y-4
            rounded-[16px]
            border
            border-[#E7E9EE]
            bg-[#F8FAFC]
            p-5
          "
        >
          {/* Intro */}

          <p
            className="
              text-center
              text-[14px]
              leading-5
              text-[#667085]
            "
          >
            Connect your crypto wallet
            to continue with TradeX.
          </p>

          {/* Referral code — auto-filled from referral link */}

          <div>
            <label
              htmlFor="wallet-card-referral-code"
              className="
                mb-2
                flex
                items-center
                justify-between
                text-[11px]
                font-bold
                uppercase
                tracking-[0.08em]
                text-[#667085]
              "
            >
              <span>Referral Code</span>

              {referralCode ? (
                <span
                  className="
                    rounded-full
                    bg-[#DCFCE7]
                    px-2
                    py-0.5
                    text-[10px]
                    font-bold
                    normal-case
                    text-[#15803D]
                  "
                >
                  ✓ Applied
                </span>
              ) : (
                <span
                  className="
                    text-[10px]
                    font-medium
                    normal-case
                    text-[#98A2B3]
                  "
                >
                  Optional
                </span>
              )}
            </label>

            <input
              id="wallet-card-referral-code"
              type="text"
              value={referralCode}
              onChange={event => {
                setReferralCode(
                  event.target.value
                    .toUpperCase()
                    .replace(
                      /\s/g,
                      '',
                    ),
                );
              }}
              placeholder="Enter referral code (e.g. TDXABC)"
              maxLength={32}
              autoComplete="off"
              className="
                h-12
                w-full
                rounded-[14px]
                border
                border-[#D0D5DD]
                bg-white
                px-4
                text-[14px]
                font-semibold
                text-[#111827]
                outline-none
                transition
                placeholder:text-[#98A2B3]
                focus:border-[#2563EB]
                focus:ring-4
                focus:ring-[#2563EB]/10
              "
            />

            {referralCode && (
              <p
                className="
                  mt-2
                  flex
                  items-center
                  gap-1.5
                  text-[11.5px]
                  font-semibold
                  text-[#15803D]
                "
              >
                <Check
                  size={13}
                  className="shrink-0"
                />

                Invite received — you'll get your
                bonus after registration
              </p>
            )}
          </div>

          {/* Connect */}

          <button
            type="button"
            onClick={openWallet}
            className="
              flex
              h-12
              w-full
              items-center
              justify-center
              gap-2
              rounded-[14px]
              bg-gradient-to-r
              from-[#2563EB]
              to-[#4F46E5]
              px-4
              text-[15px]
              font-extrabold
              text-white
              shadow-[0_4px_14px_rgba(37,99,235,0.28)]
              transition
              hover:from-[#1D4ED8]
              hover:to-[#4338CA]
              active:scale-[0.98]
            "
          >
            <Wallet size={18} />

            Connect Wallet
          </button>

          <p
            className="
              text-center
              text-[10.5px]
              leading-4
              text-[#98A2B3]
            "
          >
            By connecting you agree to TradeX
            Terms & Privacy Policy
          </p>
        </div>
      </section>
    );
  }

  // ============================================================
  // 2. WRONG NETWORK
  // ============================================================

  if (isWrongNetwork) {
    return (
      <section
        className="
          w-full
          rounded-[20px]
          border
          border-[#FDE68A]
          bg-white
          p-5
          shadow-[0_4px_12px_rgba(0,0,0,0.03)]
        "
      >
        <div className="flex items-center gap-3">
          <div
            className="
              flex
              h-11
              w-11
              items-center
              justify-center
              rounded-[14px]
              bg-[#FFF7ED]
            "
          >
            <Wallet
              size={22}
              className="text-[#EA580C]"
            />
          </div>

          <div>
            <h3
              className="
                text-[17px]
                font-extrabold
                text-[#111827]
              "
            >
              Wrong Network
            </h3>

            <p
              className="
                mt-0.5
                text-[13px]
                text-[#667085]
              "
            >
              Please switch to {requiredNetworkName}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void switchToRequiredNetwork();
          }}
          className="
            mt-5
            w-full
            rounded-[14px]
            bg-[#111827]
            px-4
            py-3
            text-[15px]
            font-extrabold
            text-white
            transition
            hover:bg-[#1F2937]
          "
        >
          Switch to {requiredNetworkName}
        </button>
      </section>
    );
  }

  // ============================================================
  // 3. NEW USER REGISTRATION
  // ============================================================

  if (
    registrationRequired
  ) {
    const registrationAddress =
      registrationWalletAddress ||
      address;

    return (
      <section
        className="
          w-full
          overflow-hidden
          rounded-[20px]
          border
          border-[#D8B4FE]
          bg-white
          shadow-[0_6px_20px_rgba(0,0,0,0.05)]
        "
      >
        {/* Registration header */}

        <div
          className="
            border-b
            border-[#E9D5FF]
            bg-[#FAF5FF]
            p-5
          "
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="
                  flex
                  h-11
                  w-11
                  shrink-0
                  items-center
                  justify-center
                  rounded-[14px]
                  bg-[#F3E8FF]
                "
              >
                <UserPlus
                  size={22}
                  className="text-[#9333EA]"
                />
              </div>

              <div>
                <h3
                  className="
                    text-[18px]
                    font-extrabold
                    text-[#111827]
                  "
                >
                  Register on TradeX
                </h3>

                <p
                  className="
                    mt-0.5
                    text-[13px]
                    text-[#667085]
                  "
                >
                  This wallet is not registered yet
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={cancelRegistration}
              disabled={isRegistering}
              className="
                rounded-full
                p-1.5
                text-[#98A2B3]
                transition
                hover:bg-white
                hover:text-[#475467]
                disabled:cursor-not-allowed
              "
              aria-label="Cancel registration"
            >
              <X size={19} />
            </button>
          </div>
        </div>

        {/* Registration body */}

        <div className="p-5">
          {/* Wallet */}

          <div>
            <label
              className="
                mb-2
                block
                text-[11px]
                font-bold
                uppercase
                tracking-[0.08em]
                text-[#667085]
              "
            >
              Wallet Address
            </label>

            <div
              className="
                flex
                items-center
                gap-3
                rounded-[14px]
                border
                border-[#E4E7EC]
                bg-[#F8FAFC]
                px-3.5
                py-3
              "
            >
              <Wallet
                size={18}
                className="
                  shrink-0
                  text-[#667085]
                "
              />

              <span
                className="
                  min-w-0
                  flex-1
                  truncate
                  text-[14px]
                  font-bold
                  text-[#111827]
                "
              >
                {formatAddress(
                  registrationAddress,
                )}
              </span>

              <button
                type="button"
                onClick={handleCopy}
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-[9px]
                  text-[#667085]
                  transition
                  hover:bg-white
                  hover:text-[#111827]
                "
                aria-label="Copy wallet address"
              >
                {copied ? (
                  <Check
                    size={17}
                    className="text-[#16A34A]"
                  />
                ) : (
                  <Copy
                    size={17}
                  />
                )}
              </button>
            </div>
          </div>

          {/* Security status */}

          <div
            className="
              mt-4
              flex
              items-center
              gap-2
              rounded-[12px]
              border
              border-[#D1FAE5]
              bg-[#ECFDF3]
              px-3.5
              py-3
            "
          >
            <LockKeyhole
              size={17}
              className="text-[#16A34A]"
            />

            <div>
              <p
                className="
                  text-[13px]
                  font-bold
                  text-[#166534]
                "
              >
                Wallet verified
              </p>

              <p
                className="
                  text-[11px]
                  text-[#15803D]
                "
              >
                Signed authentication successfully
              </p>
            </div>
          </div>

          {/* Referral — auto-filled from invite link */}

          <div
            className={
              `mt-5 rounded-[16px] border p-4 transition ${
                referralCode
                  ? 'border-[#D8B4FE] bg-[#FAF5FF]'
                  : 'border-[#E4E7EC] bg-white'
              }`
            }
          >
            <label
              htmlFor="tradex-referral-code"
              className="
                mb-2
                flex
                items-center
                justify-between
                text-[13px]
                font-bold
                text-[#344054]
              "
            >
              <span className="flex items-center gap-1.5">
                {referralCode && (
                  <Gift
                    size={15}
                    className="text-[#9333EA]"
                  />
                )}

                Referral Code
              </span>

              {referralCode ? (
                <span
                  className="
                    rounded-full
                    bg-[#F3E8FF]
                    px-2.5
                    py-1
                    text-[10px]
                    font-bold
                    text-[#9333EA]
                  "
                >
                  Auto-filled from invite
                </span>
              ) : (
                <span
                  className="
                    text-[11px]
                    font-medium
                    text-[#98A2B3]
                  "
                >
                  Optional
                </span>
              )}
            </label>

            <input
              id="tradex-referral-code"
              type="text"
              value={referralCode}
              onChange={event => {
                setReferralCode(
                  event.target.value
                    .toUpperCase()
                    .replace(
                      /\s/g,
                      '',
                    ),
                );
              }}
              placeholder="Enter referral code"
              maxLength={32}
              disabled={isRegistering}
              autoComplete="off"
              className="
                h-12
                w-full
                rounded-[14px]
                border
                border-[#D0D5DD]
                bg-white
                px-4
                text-[14px]
                font-semibold
                text-[#111827]
                outline-none
                transition
                placeholder:text-[#98A2B3]
                focus:border-[#9333EA]
                focus:ring-4
                focus:ring-[#9333EA]/10
                disabled:bg-[#F2F4F7]
              "
            />

            {referralCode ? (
              <p
                className="
                  mt-2
                  flex
                  items-start
                  gap-1.5
                  text-[11.5px]
                  font-semibold
                  leading-4
                  text-[#7E22CE]
                "
              >
                <Check
                  size={13}
                  className="mt-0.5 shrink-0"
                />

                Invite applied — this bonus will be
                credited after registration
              </p>
            ) : (
              <p
                className="
                  mt-2
                  text-[11px]
                  leading-4
                  text-[#98A2B3]
                "
              >
                Enter a valid TradeX referral code
                if someone invited you.
              </p>
            )}
          </div>

          {/* Error */}

          {registrationError && (
            <div
              className="
                mt-4
                rounded-[12px]
                border
                border-[#FECACA]
                bg-[#FEF2F2]
                px-3.5
                py-3
              "
            >
              <p
                className="
                  text-[12px]
                  font-semibold
                  leading-5
                  text-[#B91C1C]
                "
              >
                {registrationError}
              </p>
            </div>
          )}

          {/* Register */}

          <button
            type="button"
            onClick={() => {
              void handleRegister();
            }}
            disabled={isRegistering}
            className="
              mt-5
              flex
              h-12
              w-full
              items-center
              justify-center
              gap-2
              rounded-[14px]
              bg-[#9333EA]
              px-4
              text-[15px]
              font-extrabold
              text-white
              transition
              hover:bg-[#7E22CE]
              active:scale-[0.98]
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {isRegistering ? (
              <>
                <Loader2
                  size={18}
                  className="animate-spin"
                />

                Creating your account...
              </>
            ) : (
              <>
                <UserPlus
                  size={18}
                />

                Register Wallet
              </>
            )}
          </button>

          <p
            className="
              mt-3
              text-center
              text-[10.5px]
              leading-4
              text-[#98A2B3]
            "
          >
            Registration creates your TradeX account
            and wallet profile.
          </p>
        </div>
      </section>
    );
  }

  // ============================================================
  // 4. AUTHENTICATING
  // ============================================================

  if (
    isAuthenticating &&
    !authUser
  ) {
    return (
      <section
        className="
          w-full
          rounded-[20px]
          border
          border-[#E7E9EE]
          bg-white
          p-5
          shadow-[0_4px_12px_rgba(0,0,0,0.03)]
        "
      >
        <div className="flex items-center gap-3">
          <div
            className="
              flex
              h-11
              w-11
              items-center
              justify-center
              rounded-[14px]
              bg-[#EEF4FF]
            "
          >
            <Loader2
              size={22}
              className="
                animate-spin
                text-[#2563EB]
              "
            />
          </div>

          <div>
            <h3
              className="
                text-[17px]
                font-extrabold
                text-[#111827]
              "
            >
              Verifying Wallet
            </h3>

            <p
              className="
                mt-0.5
                text-[13px]
                text-[#667085]
              "
            >
              Please complete the wallet
              authentication...
            </p>
          </div>
        </div>

        <div
          className="
            mt-5
            rounded-[14px]
            bg-[#F8FAFC]
            px-4
            py-3
            text-[13px]
            text-[#667085]
          "
        >
          Do not close your wallet
          until authentication is complete.
        </div>
      </section>
    );
  }

  // ============================================================
  // 5. AUTH ERROR
  // ============================================================

  if (
    authError &&
    !authUser
  ) {
    return (
      <section
        className="
          w-full
          rounded-[20px]
          border
          border-[#FECACA]
          bg-white
          p-5
          shadow-[0_4px_12px_rgba(0,0,0,0.03)]
        "
      >
        <div className="flex items-start gap-3">
          <div
            className="
              flex
              h-11
              w-11
              shrink-0
              items-center
              justify-center
              rounded-[14px]
              bg-[#FEF2F2]
            "
          >
            <Wallet
              size={22}
              className="text-[#DC2626]"
            />
          </div>

          <div className="min-w-0">
            <h3
              className="
                text-[17px]
                font-extrabold
                text-[#111827]
              "
            >
              Authentication Failed
            </h3>

            <p
              className="
                mt-1
                text-[13px]
                leading-5
                text-[#B91C1C]
              "
            >
              {authError}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              void retryAuth();
            }}
            className="
              flex-1
              rounded-[13px]
              bg-[#111827]
              px-4
              py-3
              text-[14px]
              font-bold
              text-white
            "
          >
            Retry
          </button>

          <button
            type="button"
            onClick={() => {
              void disconnectWallet();
            }}
            className="
              flex-1
              rounded-[13px]
              border
              border-[#E4E7EC]
              bg-white
              px-4
              py-3
              text-[14px]
              font-bold
              text-[#344054]
            "
          >
            Disconnect
          </button>
        </div>
      </section>
    );
  }

  // ============================================================
  // 6. REGISTERED USER
  // ============================================================

  return (
    <section
      className="
        w-full
        rounded-[20px]
        border
        border-[#1E293B]
        bg-[#0B192C]
        p-5
        shadow-[0_6px_20px_rgba(0,0,0,0.08)]
      "
    >
      {/* Header */}

      <div
        className="
          flex
          items-center
          justify-between
          gap-3
        "
      >
        <div className="flex items-center gap-3">
          <div
            className="
              flex
              h-11
              w-11
              items-center
              justify-center
              rounded-[14px]
              bg-[#10233B]
            "
          >
            <Wallet
              size={22}
              className="text-[#4ADE80]"
            />
          </div>

          <div>
            <h3
              className="
                text-[17px]
                font-extrabold
                text-white
              "
            >
              Wallet
            </h3>

            <div
              className="
                mt-0.5
                flex
                items-center
                gap-1.5
              "
            >
              <span
                className="
                  h-2
                  w-2
                  rounded-full
                  bg-[#22C55E]
                "
              />

              <span
                className="
                  text-[12px]
                  font-semibold
                  text-[#4ADE80]
                "
              >
                Connected
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void disconnectWallet();
          }}
          className="
            rounded-[10px]
            border
            border-[#7F1D1D]
            px-3
            py-2
            text-[11px]
            font-bold
            text-[#FCA5A5]
            transition
            hover:bg-[#450A0A]
          "
        >
          Disconnect
        </button>
      </div>

      {/* Network */}

      <div
        className="
          mt-5
          rounded-[14px]
          border
          border-[#1E293B]
          bg-[#071426]
          px-4
          py-3.5
        "
      >
        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <div>
            <p
              className="
                text-[10px]
                font-bold
                uppercase
                tracking-[0.08em]
                text-[#64748B]
              "
            >
              Network
            </p>

            <p
              className="
                mt-1
                text-[14px]
                font-bold
                text-white
              "
            >
              {networkName}
            </p>
          </div>

          <span
            className="
              rounded-full
              border
              border-[#166534]
              bg-[#052E16]
              px-3
              py-1.5
              text-[11px]
              font-bold
              text-[#4ADE80]
            "
          >
            Mainnet
          </span>
        </div>
      </div>

      {/* Address */}

      <div
        className="
          mt-3
          rounded-[14px]
          border
          border-[#1E293B]
          bg-[#071426]
          px-4
          py-3.5
        "
      >
        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <div className="min-w-0">
            <p
              className="
                text-[10px]
                font-bold
                uppercase
                tracking-[0.08em]
                text-[#64748B]
              "
            >
              Wallet Address
            </p>

            <p
              className="
                mt-1
                truncate
                text-[14px]
                font-bold
                text-white
              "
            >
              {formatAddress(address)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-[10px]
              border
              border-[#1E293B]
              bg-[#0B192C]
              text-[#94A3B8]
              transition
              hover:text-white
            "
            aria-label="Copy wallet address"
          >
            {copied ? (
              <Check
                size={17}
                className="text-[#4ADE80]"
              />
            ) : (
              <Copy
                size={17}
              />
            )}
          </button>
        </div>
      </div>

      {/* Registered */}

      {authUser && (
        <div
          className="
            mt-3
            rounded-[14px]
            border
            border-[#1E293B]
            bg-[#071426]
            px-4
            py-3
          "
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p
                className="
                  text-[10px]
                  font-bold
                  uppercase
                  tracking-[0.08em]
                  text-[#64748B]
                "
              >
                TradeX Referral Code
              </p>

              <p
                className="
                  mt-1
                  text-[14px]
                  font-extrabold
                  tracking-wide
                  text-[#FBBF24]
                "
              >
                {authUser.referralCode ||
                  '---'}
              </p>
            </div>

            <span
              className="
                rounded-full
                bg-[#052E16]
                px-2.5
                py-1
                text-[10px]
                font-bold
                text-[#4ADE80]
              "
            >
              {authUser.role === 'admin'
                ? 'Admin'
                : 'Registered'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}