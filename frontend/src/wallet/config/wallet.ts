// ============================================================
// TRADEX BLOCKCHAIN / CONTRACT CONFIG
// ============================================================
//
// IMPORTANT
// ------------------------------------------------------------
// This file contains ONLY:
// - BSC Mainnet constants
// - Contract addresses
// - Token configuration
// - Deposit Vault configuration
// - Contract ABIs
//
// WALLET CONNECTION / WAGMI CONFIG
// ------------------------------------------------------------
// Wallet connection is managed ONLY by:
//
// src/wallet/config/webWallet.ts
//
// Do NOT create another WagmiConfig / WagmiAdapter here.
//
// This prevents:
// - Connector mismatch
// - Wallet state mismatch
// - Reown/AppKit disconnect issues
// - "Connector not connected" errors
//
// ============================================================


// ============================================================
// PRODUCTION NETWORK
// ============================================================
//
// TradeX production runs on:
//
// BNB Smart Chain Mainnet
//
// Chain ID: 56
// Native token: BNB
//
// ============================================================

export const BSC_CHAIN_ID = 56;

export const BSC_NETWORK_NAME =
  'BNB Smart Chain';

export const BSC_NATIVE_SYMBOL =
  'BNB';


// ============================================================
// BSC RPC
// ============================================================
//
// The actual Wagmi transport is configured in:
//
// src/wallet/config/webWallet.ts
//
// This value can still be used by other low-level blockchain
// utilities if required.
//
// ============================================================

export const BSC_RPC_URL =
  import.meta.env.VITE_BSC_RPC_URL || '';


// ============================================================
// REOWN PROJECT ID
// ============================================================
//
// Kept here only for compatibility with existing imports.
//
// Actual Reown configuration belongs to webWallet.ts.
//
// ============================================================

export const REOWN_PROJECT_ID =
  import.meta.env.VITE_REOWN_PROJECT_ID;


// ============================================================
// CONTRACT ENVIRONMENT
// ============================================================

const usdtAddress =
  import.meta.env.VITE_BSC_USDT_CONTRACT;

const depositVaultAddress =
  import.meta.env.VITE_VAULT_ADDRESS;


// ============================================================
// REQUIRED ENV VALIDATION
// ============================================================

if (!usdtAddress) {
  throw new Error(
    'VITE_BSC_USDT_CONTRACT is missing from frontend .env',
  );
}

if (!depositVaultAddress) {
  throw new Error(
    'VITE_VAULT_ADDRESS is missing from frontend .env',
  );
}


// ============================================================
// CONTRACT ADDRESS TYPES
// ============================================================

export const USDT_ADDRESS =
  usdtAddress as `0x${string}`;

export const VAULT_ADDRESS =
  depositVaultAddress as `0x${string}`;


// ============================================================
// EXPLICIT DEPOSIT VAULT NAME
// ============================================================
//
// New code should preferably use:
//
// DEPOSIT_VAULT_ADDRESS
//
// VAULT_ADDRESS remains available for backwards compatibility.
//
// ============================================================

export const DEPOSIT_VAULT_ADDRESS =
  depositVaultAddress as `0x${string}`;


// ============================================================
// WITHDRAWAL VAULT
// ============================================================
//
// IMPORTANT
// ------------------------------------------------------------
// Withdrawal is managed separately.
//
// Do NOT use this address for deposits.
//
// Withdrawal Vault:
// 0xe68134Ea62fE9b30Fe7baDAD2252d0da9929e9D9
//
// This address is intentionally NOT exported from this file.
//
// Withdrawal should have its own configuration.
//
// ============================================================


// ============================================================
// TDX BUSINESS RATE
// ============================================================
//
// Display / business conversion:
//
// 1 USDT = 100 TDX
//
// IMPORTANT
// ------------------------------------------------------------
// This is NOT the source of truth for user balances.
//
// Actual TDX credit must be performed by the backend after:
//
// Blockchain transaction
//        ↓
// Deposit verification
//        ↓
// Required confirmations
//        ↓
// Backend credit
//
// ============================================================

export const TDX_RATE = 100;

// Minimum on-chain deposit accepted by TradeX vault.
export const MIN_USDT_DEPOSIT = 1;


// ============================================================
// USDT DECIMALS
// ============================================================
//
// BSC USDT:
//
// 1 USDT = 1e18 units
//
// ============================================================

export const USDT_DECIMALS = 18;


// ============================================================
// USDT SYMBOL
// ============================================================

export const USDT_SYMBOL =
  'USDT';


// ============================================================
// USDT ABI
// ============================================================
//
// Functions currently required by TradeX.
//
// ============================================================

export const USDT_ABI = [
  // ==========================================================
  // APPROVE
  // ==========================================================

  {
    name: 'approve',
    type: 'function',

    inputs: [
      {
        name: 'spender',
        type: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
      },
    ],

    outputs: [
      {
        name: '',
        type: 'bool',
      },
    ],

    stateMutability:
      'nonpayable',
  },


  // ==========================================================
  // TRANSFER
  // ==========================================================

  {
    name: 'transfer',
    type: 'function',

    inputs: [
      {
        name: 'to',
        type: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
      },
    ],

    outputs: [
      {
        name: '',
        type: 'bool',
      },
    ],

    stateMutability:
      'nonpayable',
  },


  // ==========================================================
  // ALLOWANCE
  // ==========================================================

  {
    name: 'allowance',
    type: 'function',

    inputs: [
      {
        name: 'owner',
        type: 'address',
      },
      {
        name: 'spender',
        type: 'address',
      },
    ],

    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],

    stateMutability:
      'view',
  },


  // ==========================================================
  // BALANCE OF
  // ==========================================================

  {
    name: 'balanceOf',
    type: 'function',

    inputs: [
      {
        name: 'account',
        type: 'address',
      },
    ],

    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],

    stateMutability:
      'view',
  },


  // ==========================================================
  // DECIMALS
  // ==========================================================

  {
    name: 'decimals',
    type: 'function',

    inputs: [],

    outputs: [
      {
        name: '',
        type: 'uint8',
      },
    ],

    stateMutability:
      'view',
  },


  // ==========================================================
  // SYMBOL
  // ==========================================================

  {
    name: 'symbol',
    type: 'function',

    inputs: [],

    outputs: [
      {
        name: '',
        type: 'string',
      },
    ],

    stateMutability:
      'view',
  },
] as const;


// ============================================================
// TRADEX DEPOSIT VAULT ABI
// ============================================================
//
// Deposit flow:
//
// User Wallet
//      ↓
// USDT.approve(Deposit Vault)
//      ↓
// Blockchain confirmation
//      ↓
// Deposit Vault.depositUSDT()
//      ↓
// Blockchain confirmation
//      ↓
// Deposit event / transaction
//      ↓
// Backend watcher
//      ↓
// Confirmation tracking
//      ↓
// Deposit verification
//      ↓
// TDX credit
//
// ============================================================

export const VAULT_ABI = [
  // ==========================================================
  // DEPOSIT USDT
  // ==========================================================

  {
    name: 'depositUSDT',
    type: 'function',

    inputs: [
      {
        name: 'amount',
        type: 'uint256',
      },
    ],

    outputs: [],

    stateMutability:
      'nonpayable',
  },


  // ==========================================================
  // VAULT BALANCE
  // ==========================================================

  {
    name: 'getVaultBalance',
    type: 'function',

    inputs: [],

    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],

    stateMutability:
      'view',
  },
] as const;


// ============================================================
// CONTRACT SUMMARY
// ============================================================
//
// BSC Mainnet
//
// Chain ID:
// 56
//
// USDT:
// VITE_BSC_USDT_CONTRACT
//
// Deposit Vault:
// VITE_VAULT_ADDRESS
//
// TDX:
// 1 USDT = 100 TDX
//
// ============================================================


// ============================================================
// SECURITY NOTES
// ============================================================
//
// 1. Never put private keys in frontend.
//
// 2. Never trust frontend TDX calculations for accounting.
//
// 3. Backend must verify blockchain transactions.
//
// 4. Backend must verify:
//      - chain
//      - token
//      - vault address
//      - sender
//      - amount
//      - transaction status
//      - confirmations
//
// 5. Frontend should display backend balance as the source
//    of truth.
//
// 6. Wallet connection must come only from webWallet.ts.
//
// ============================================================