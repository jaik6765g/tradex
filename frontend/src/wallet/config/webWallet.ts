// ============================================================
// TRADEX WEB WALLET CONFIG
// ============================================================
//
// REOWN APPKIT
// ------------------------------------------------------------
// Responsible for:
// - Wallet connection UI
// - Wallet selection
// - Connect / disconnect
// - Wallet modal
//
// WAGMI + REOWN WAGMI ADAPTER
// ------------------------------------------------------------
// Responsible for:
// - Account state
// - Chain state
// - Blockchain reads
// - Blockchain writes
// - Message signing
// - Contract interaction
//
// PRODUCTION NETWORK
// ------------------------------------------------------------
// BNB Smart Chain Mainnet ONLY
//
// Chain ID: 56
// Native Token: BNB
//
// NO:
// - Polygon
// - BSC Testnet
// - Ethereum
// - Other networks
// ============================================================

import {
  createAppKit,
} from '@reown/appkit/react';

import {
  WagmiAdapter,
} from '@reown/appkit-adapter-wagmi';

import {
  bsc,
} from '@reown/appkit/networks';

// ============================================================
// REOWN PROJECT ID
// ============================================================

const projectId =
  import.meta.env.VITE_REOWN_PROJECT_ID;

if (!projectId) {
  throw new Error(
    'VITE_REOWN_PROJECT_ID is missing from frontend .env',
  );
}

// ============================================================
// CUSTOM BSC RPC CONFIGURATION
// ============================================================
//
// REQUIREMENT
// ------------------------------------------------------------
// All BSC Mainnet reads/writes must use VITE_BSC_RPC_URL.
//
// Reown's RPC proxy (rpc.walletconnect.org) must NOT be the primary
// RPC for BSC: the Reown Blockchain API is not entitled for this
// project, so requests to rpc.walletconnect.org return 403 / CORS
// errors in the browser console.
//
// HOW THIS WORKS (verified against @reown/appkit-adapter-wagmi 1.8.23)
// ------------------------------------------------------------
// - WagmiAdapter builds the wagmi/viem transport for every network via
//   CaipNetworksUtil.getViemTransport(), which places customRpcUrls
//   FIRST in its viem fallback chain:
//
//     fallback([ customRpcUrls..., reownRpcProxy, networkDefaultRpcs... ])
//
//   With VITE_BSC_RPC_URL configured, every wagmi read/write/signing
//   request targets VITE_BSC_RPC_URL. The Reown proxy remains only as
//   an emergency fallback and is never called during normal operation.
//
// - createAppKit / AppKitProvider applies the SAME map to the AppKit
//   network objects (rpcUrls.default), so AppKit and Wagmi share the
//   SAME RPC configuration.
//
// customRpcUrls shape (Reown type CustomRpcUrlMap):
//   Record<CaipNetworkId, Array<{ url: string; config?: HttpTransportConfig }>>
//
// IMPORTANT: the key MUST be the CAIP network id ('eip155:56'),
// NOT the numeric chain id.
// ============================================================

const bscRpcUrl =
  import.meta.env.VITE_BSC_RPC_URL?.trim();

const customRpcUrls =
  bscRpcUrl
    ? {
        'eip155:56': [
          {
            url: bscRpcUrl,
          },
        ],
      }
    : undefined;

if (!customRpcUrls) {
  console.warn(
    'VITE_BSC_RPC_URL is not configured - AppKit/Wagmi will fall back to the default BSC RPC endpoints',
  );
}

// ============================================================
// NETWORK
// ============================================================
//
// TradeX production supports ONLY BSC Mainnet.
//
// Chain ID: 56
// ============================================================

export const walletNetworks = [
  bsc,
] as [typeof bsc];

// ============================================================
// WAGMI ADAPTER
// ============================================================
//
// This is the SINGLE Reown ↔ Wagmi adapter used by TradeX.
//
// Do NOT create another WagmiAdapter elsewhere.
//
// The adapter internally provides the Wagmi configuration
// that should be used by WagmiProvider.
// ============================================================

export const wagmiAdapter =
  new WagmiAdapter({
    networks: walletNetworks,
    projectId,
    customRpcUrls,
  });

// ============================================================
// WAGMI CONFIG
// ============================================================
//
// IMPORTANT
// ------------------------------------------------------------
// App.tsx should eventually use this config:
//
// <WagmiProvider config={wagmiConfig}>
//
// This keeps Reown AppKit and Wagmi on the SAME configuration.
// ============================================================

export const wagmiConfig =
  wagmiAdapter.wagmiConfig;

// ============================================================
// APPKIT CONFIG
// ============================================================

export const webWalletConfig = {
  projectId,

  adapters: [
    wagmiAdapter,
  ],

  networks:
    walletNetworks,

  defaultNetwork:
    bsc,

  customRpcUrls,

  metadata: {
    name: 'TradeX',

    description:
      'TradeX Web3 Trading Platform',

    url:
      window.location.origin,

    icons: [],
  },

  features: {
    analytics: false,
  },
};

// ============================================================
// APPKIT INSTANCE
// ============================================================
//
// Single AppKit instance for the application.
//
// Used by:
// - WalletContext
// - useWallet
// - Wallet connection UI
// - Disconnect
// ============================================================

export const appKit =
  createAppKit({
    projectId,

    adapters: [
      wagmiAdapter,
    ],

    networks:
      walletNetworks,

    defaultNetwork:
      bsc,

    customRpcUrls,

    metadata: {
      name: 'TradeX',

      description:
        'TradeX Web3 Trading Platform',

      url:
        window.location.origin,

      icons: [],
    },

    features: {
      analytics: false,
    },
  });