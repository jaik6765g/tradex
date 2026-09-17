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
          border-[#292B33]
          bg-[#15161C]
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
                bg-[#211810]
              "
            >
              <Wallet
                size={22}
                className="text-[#C99752]"
              />
            </div>

            <div>
              <h3
                className="
                  text-[17px]
                  font-extrabold
                  text-[#F5F5F7]
                "
              >
                Wallet
              </h3>

              <p
                className="
                  mt-0.5
                  text-[13px]
                  text-[#A1A4AE]
                "
              >
                Connect your wallet
              </p>
            </div>
          </div>

          <span
            className="
              rounded-full
              bg-[#1B1917]
              px-3
              py-1.5
              text-[12px]
              font-bold
              text-[#A1A4AE]
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
            border-[#292B33]
            bg-[#111217]
            p-5
          "
        >
          {/* Intro */}

          <p
            className="
              text-center
              text-[14px]
              leading-5
              text-[#A1A4AE]
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
                text-[#A1A4AE]
              "
            >
              <span>Referral Code</span>

              {referralCode ? (
                <span
                  className="
                    rounded-full
                    bg-[#10251A]
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
                    text-[#70737E]
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
                border-[#34343E]
                bg-[#15161C]
                px-4
                text-[14px]
                font-semibold
                text-[#F5F5F7]
                outline-none
                transition
                placeholder:text-[#70737E]
                focus:border-[#C99752]
                focus:ring-4
                focus:ring-[#C99752]/10
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
              bg-[#FF7A18]
              px-4
              text-[15px]
              font-extrabold
              text-white
              shadow-[0_4px_14px_rgba(255,122,24,0.25)]
              transition
              hover:bg-[#FF8F3D]
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
              text-[#70737E]
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
          border-[#3A281C]
          bg-[#15161C]
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
              bg-[#2A1608]
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
                text-[#F5F5F7]
              "
            >
              Wrong Network
            </h3>

            <p
              className="
                mt-0.5
                text-[13px]
                text-[#A1A4AE]
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
            bg-[#FF7A18]
            px-4
            py-3
            text-[15px]
            font-extrabold
            text-white
            transition
            hover:bg-[#FF8F3D]
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
          border-[#34261C]
          bg-[#15161C]
          shadow-[0_6px_20px_rgba(0,0,0,0.05)]
        "
      >
        {/* Registration header */}

        <div
          className="
            border-b
            border-[#34261C]
            bg-[#211810]
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
                  bg-[#211810]
                "
              >
                <UserPlus
                  size={22}
                  className="text-[#C99752]"
                />
              </div>

              <div>
                <h3
                  className="
                    text-[18px]
                    font-extrabold
                    text-[#F5F5F7]
                  "
                >
                  Register on TradeX
                </h3>

                <p
                  className="
                    mt-0.5
                    text-[13px]
                    text-[#A1A4AE]
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
                text-[#70737E]
                transition
                hover:bg-[#20202A]
                hover:text-[#A1A4AE]
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
                text-[#A1A4AE]
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
                border-[#292B33]
                bg-[#111217]
                px-3.5
                py-3
              "
            >
              <Wallet
                size={18}
                className="
                  shrink-0
                  text-[#A1A4AE]
                "
              />

              <span
                className="
                  min-w-0
                  flex-1
                  truncate
                  text-[14px]
                  font-bold
                  text-[#F5F5F7]
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
                  text-[#A1A4AE]
                  transition
                  hover:bg-[#20202A]
                  hover:text-[#F5F5F7]
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

          {/* Security status */}

          <div
            className="
              mt-4
              flex
              items-center
              gap-2
              rounded-[12px]
              border
              border-[#123A24]
              bg-[#10251A]
              px-3.5
              py-3
            "
          >
            <LockKeyhole
              size={17}
              className="text-[#4ADE80]"
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
                  ? 'border-[#34261C] bg-[#211810]'
                  : 'border-[#292B33] bg-[#15161C]'
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
                text-[#E4E5E8]
              "
            >
              <span className="flex items-center gap-1.5">
                {referralCode && (
                  <Gift
                    size={15}
                    className="text-[#C99752]"
                  />
                )}

                Referral Code
              </span>

              {referralCode ? (
                <span
                  className="
                    rounded-full
                    bg-[#211810]
                    px-2.5
                    py-1
                    text-[10px]
                    font-bold
                    text-[#C99752]
                  "
                >
                  Auto-filled from invite
                </span>
              ) : (
                <span
                  className="
                    text-[11px]
                    font-medium
                    text-[#70737E]
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
                border-[#34343E]
                bg-[#15161C]
                px-4
                text-[14px]
                font-semibold
                text-[#F5F5F7]
                outline-none
                transition
                placeholder:text-[#70737E]
                focus:border-[#C99752]
                focus:ring-4
                focus:ring-[#C99752]/10
                disabled:bg-[#1B1917]
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
                  text-[#C99752]
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
                  text-[#70737E]
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
                border-[#4A2323]
                bg-[#281313]
                px-3.5
                py-3
              "
            >
              <p
                className="
                  text-[12px]
                  font-semibold
                  leading-5
                  text-[#F87171]
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
              bg-[#C99752]
              px-4
              text-[15px]
              font-extrabold
              text-white
              transition
              hover:bg-[#C99752]
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
              text-[#70737E]
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
          border-[#292B33]
          bg-[#15161C]
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
              bg-[#211810]
            "
          >
            <Loader2
              size={22}
              className="
                animate-spin
                text-[#C99752]
              "
            />
          </div>

          <div>
            <h3
              className="
                text-[17px]
                font-extrabold
                text-[#F5F5F7]
              "
            >
              Verifying Wallet
            </h3>

            <p
              className="
                mt-0.5
                text-[13px]
                text-[#A1A4AE]
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
            bg-[#111217]
            px-4
            py-3
            text-[13px]
            text-[#A1A4AE]
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
          border-[#4A2323]
          bg-[#15161C]
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
              bg-[#281313]
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
                text-[#F5F5F7]
              "
            >
              Authentication Failed
            </h3>

            <p
              className="
                mt-1
                text-[13px]
                leading-5
                text-[#F87171]
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
              bg-[#FF7A18]
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
              border-[#292B33]
              bg-[#15161C]
              px-4
              py-3
              text-[14px]
              font-bold
              text-[#E4E5E8]
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
        border-[#292B33]
        bg-[#211810]
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
              bg-[#211810]
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
            text-[#5C2B2B]
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
          border-[#292B33]
          bg-[#211810]
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
                text-[#A1A4AE]
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
          border-[#292B33]
          bg-[#211810]
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
                text-[#A1A4AE]
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
              border-[#292B33]
              bg-[#211810]
              text-[#70737E]
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
            border-[#292B33]
            bg-[#211810]
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
                  text-[#A1A4AE]
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
                  text-[#FF7A18]
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