// ============================================================
// TRADEX NETWORK CONFIG
// ============================================================
//
// PRODUCTION NETWORK
// ------------------------------------------------------------
// TradeX runs only on BSC Mainnet.
//
// Chain ID: 56
// Native token: BNB
// Explorer: BscScan
// ============================================================

export const CHAIN_IDS = {
  BSC_MAINNET: 56,
} as const;

export type WalletChainId =
  (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// ============================================================
// WALLET NETWORK TYPE
// ============================================================

export type WalletNetwork = {
  id: WalletChainId;

  name: string;

  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };

  rpcUrls: {
    default: {
      http: string[];
    };
  };

  blockExplorers: {
    default: {
      name: string;
      url: string;
    };
  };
};

// ============================================================
// BSC MAINNET
// ============================================================

export const bscMainnetNetwork: WalletNetwork = {
  id: CHAIN_IDS.BSC_MAINNET,

  name: 'BNB Smart Chain',

  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },

  rpcUrls: {
    default: {
      http: [
        'https://bsc-dataseed.binance.org',
      ],
    },
  },

  blockExplorers: {
    default: {
      name: 'BscScan',
      url: 'https://bscscan.com',
    },
  },
};

// ============================================================
// MAINNET WALLET NETWORKS
// ============================================================

export const mainnetWalletNetworks = [
  bscMainnetNetwork,
] as const;

// ============================================================
// DEFAULT NETWORK
// ============================================================

export const defaultWalletNetwork =
  bscMainnetNetwork;

// ============================================================
// GET WALLET NETWORKS
// ============================================================

export function getWalletNetworks(): WalletNetwork[] {
  return [
    bscMainnetNetwork,
  ];
}

// ============================================================
// NETWORK LABEL
// ============================================================

export function getWalletNetworkLabel(
  chainId:
    | number
    | null
    | undefined,
): string {
  if (!chainId) {
    return 'Not connected';
  }

  if (
    chainId ===
    CHAIN_IDS.BSC_MAINNET
  ) {
    return 'BNB Smart Chain';
  }

  return `Unsupported Chain ${chainId}`;
}

// ============================================================
// NATIVE CURRENCY SYMBOL
// ============================================================

export function getWalletNativeSymbol(
  chainId:
    | number
    | null
    | undefined,
): string {
  if (
    chainId ===
    CHAIN_IDS.BSC_MAINNET
  ) {
    return 'BNB';
  }

  return 'BNB';
}