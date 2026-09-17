// frontend/src/bot/screens/BotTradeScreen.tsx

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AxiosError } from 'axios';

import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { apiClient } from '../../core/api/client';

import { BotService } from './services/bot.service';

import type {
  BotAccountResponse,
  BotAccountStatus,
  BotActivityFilter,
  BotActivityItem,
  BotReferralPerformance,
  BotWalletTransferDirection,
} from './types/bot.types';

import BotHeader from './components/BotHeader';
import BotAccountCard from './components/BotAccountCard';
import BotBalanceCard from './components/BotBalanceCard';
import BotActivationCard from './components/BotActivationCard';
import BotReferralEarnings from './components/BotReferralEarnings';
import BotTransactionHistory from './components/BotTransactionHistory';
import { useWalletContext } from '../../wallet/context/WalletContext';

// ============================================================
// TYPES & HELPERS
// ============================================================

type ApiErrorPayload = {
  message?: string | string[];
  statusCode?: number;
};

type ParsedApiError = {
  status?: number;
  message: string;
};

function normalizeErrorMessage(message?: string | string[]): string | undefined {
  if (typeof message === 'string') return message.trim() || undefined;
  if (Array.isArray(message)) {
    const merged = message
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join(', ');
    return merged || undefined;
  }
  return undefined;
}

function parseApiError(error: unknown): ParsedApiError {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const payload = (error.response?.data ?? {}) as ApiErrorPayload;
    const backendMessage = normalizeErrorMessage(payload.message);
    return {
      status,
      message: backendMessage || error.message || 'Something went wrong',
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: 'Something went wrong' };
}

function parsePositiveAmount(rawValue?: string | null): number | null {
  const normalized = (rawValue ?? '').trim();
  if (!normalized) return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const numericAmount = Number(normalized);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
  return numericAmount;
}

function parseDecimal(value?: string | null): number | null {
  if (!value) return null;
  try {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Precise non-negative decimal-string comparison (max 18 fraction digits).
 *
 * Avoids JavaScript floating-point arithmetic for monetary pre-checks.
 * The backend remains the final authority for balance validation.
 *
 * Returns:
 *   -1 when a < b
 *    0 when a == b
 *    1 when a > b
 */
function compareDecimalStrings(aRaw: string, bRaw: string): number {
  const MAX_DECIMALS = 18;

  const normalize = (value: string): { int: string; frac: string } => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || trimmed === '0' || trimmed === '0.0') {
      return { int: '0', frac: '0'.padEnd(MAX_DECIMALS, '0') };
    }
    const [rawInt = '0', rawFrac = ''] = trimmed.split('.');
    const normalizedInt = (rawInt.replace(/\D/g, '') || '0').replace(/^0+/, '') || '0';
    const normalizedFrac = rawFrac
      .slice(0, MAX_DECIMALS)
      .padEnd(MAX_DECIMALS, '0');
    return { int: normalizedInt, frac: normalizedFrac };
  };

  const a = normalize(aRaw);
  const b = normalize(bRaw);

  const aInt = BigInt(a.int);
  const bInt = BigInt(b.int);
  if (aInt !== bInt) return aInt < bInt ? -1 : 1;

  const aFrac = BigInt(a.frac);
  const bFrac = BigInt(b.frac);
  if (aFrac === bFrac) return 0;
  return aFrac < bFrac ? -1 : 1;
}

const ACTIVITY_PAGE_LIMIT = 10;

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function BotTradeScreen() {
  const {
    balance,
    isLoading: walletLoading,
    refresh: refreshWallet,
  } = useWalletContext();

  const [bot, setBot] = useState<BotAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAccountMissing, setIsAccountMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [activating, setActivating] = useState(false);

  const [transferAmount, setTransferAmount] = useState('');
  const [transferDirection, setTransferDirection] = useState<BotWalletTransferDirection>('TRANSFER_IN');
  const [activationAmount, setActivationAmount] = useState('');

  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activityItems, setActivityItems] = useState<BotActivityItem[]>([]);
  const [activityFilter, setActivityFilter] = useState<BotActivityFilter>('ALL');
  const [activityPage, setActivityPage] = useState(1);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [referralPerformance, setReferralPerformance] = useState<BotReferralPerformance | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);
  const [referralError, setReferralError] = useState<string | null>(null);

  // ============================================================
  // LOAD DATA
  // ============================================================

  const loadBot = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await BotService.getBotAccount();
      setBot(data);
      setIsAccountMissing(false);
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.status === 404) {
        setBot(null);
        setIsAccountMissing(true);
        setLoadError(null);
        return;
      }
      setLoadError(parsed.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBot();
  }, [loadBot]);

  const loadActivity = useCallback(
    async ({
      nextPage,
      nextFilter,
      append,
      silent,
    }: {
      nextPage?: number;
      nextFilter: BotActivityFilter;
      append?: boolean;
      silent?: boolean;
    }) => {
      const targetPage = nextPage ?? 1;
      const targetFilter = nextFilter;
      const shouldAppend = append ?? false;
      const isSilent = silent ?? false;

      try {
        if (!isSilent) {
          if (shouldAppend) {
            setActivityLoadingMore(true);
          } else {
            setActivityLoading(true);
          }
        }
        setActivityError(null);

        const data = await BotService.getBotActivity({
          page: targetPage,
          limit: ACTIVITY_PAGE_LIMIT,
          filter: targetFilter,
        });

        setActivityItems((prev) =>
          shouldAppend ? [...prev, ...data.items] : data.items
        );
        setActivityPage(data.page);
        setActivityHasMore(data.hasMore);
      } catch (error) {
        setActivityError(parseApiError(error).message);
      } finally {
        setActivityLoading(false);
        setActivityLoadingMore(false);
      }
    },
    []
  );

  const loadReferralPerformance = useCallback(async () => {
    try {
      setReferralLoading(true);
      setReferralError(null);
      const data = await BotService.getReferralPerformance();
      setReferralPerformance(data);
    } catch (error) {
      setReferralError(parseApiError(error).message);
    } finally {
      setReferralLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity({
      nextPage: 1,
      nextFilter: 'ALL',
    });
    void loadReferralPerformance();
  }, [loadActivity, loadReferralPerformance]);

  // ============================================================
  // HANDLERS
  // ============================================================

  async function handleCreateBot() {
    try {
      setCreating(true);
      setActionError(null);
      setSuccess(null);
      const data = await BotService.createBotAccount();
      setBot(data);
      setIsAccountMissing(false);
      setLoadError(null);
      await loadActivity({
        nextPage: 1,
        nextFilter: activityFilter,
        silent: true,
      });
      setSuccess('Bot account created successfully.');
    } catch (err) {
      setActionError(parseApiError(err).message);
    } finally {
      setCreating(false);
    }
  }

  // ✅ FIXED: handleTransfer - Refresh balance from backend (no stale state, no setTimeout)
  async function handleTransfer() {
    const amount = (transferAmount ?? '').trim();
    const numericAmount = parsePositiveAmount(amount);

    if (numericAmount == null) {
      setActionError('Enter a valid transfer amount greater than zero.');
      return;
    }

    // Prevent duplicate/double-click submissions
    if (transferring) return;
    setTransferring(true);
    setActionError(null);
    setSuccess(null);

    try {
      const isTransferOut = transferDirection === 'TRANSFER_OUT';
      const sourceWalletLabel = isTransferOut ? 'Bot Wallet' : 'Main Wallet';
      const destinationWalletLabel = isTransferOut ? 'Main Wallet' : 'Bot Wallet';

      // ✅ Always fetch the authoritative Main Wallet balance straight from the
      // backend right before the transfer. The backend remains the final
      // authority and re-validates inside its own transaction.
      let latestMainAvailable = '0';
      let latestBotAvailable = bot?.wallet?.availableBalance ?? '0';

      try {
        const balanceRes = await apiClient.get('/balances/me');
        const latestBalance = balanceRes.data;
        latestMainAvailable = String(latestBalance?.availableBalance ?? '0');
      } catch (err) {
        console.warn('Failed to refresh balance before transfer:', err);
      }

      const sourceBalanceRaw = isTransferOut
        ? latestBotAvailable
        : latestMainAvailable;

      // ✅ Precise decimal-string pre-check (no JS float arithmetic)
      if (compareDecimalStrings(sourceBalanceRaw, amount) < 0) {
        setActionError(`Amount exceeds your ${sourceWalletLabel} balance.`);
        return;
      }

      await BotService.transferToBotWallet({
        amount: amount,
        direction: transferDirection,
      });

      setTransferAmount('');

      await Promise.all([
        loadBot(),
        refreshWallet(),
        loadActivity({
          nextPage: 1,
          nextFilter: activityFilter,
          silent: true,
        }),
      ]);

      setSuccess(`${amount} TDX transferred to ${destinationWalletLabel}.`);
    } catch (err) {
      setActionError(parseApiError(err).message);
    } finally {
      setTransferring(false);
    }
  }

  async function handleActivate() {
    const amount = activationAmount.trim();
    if (!amount) {
      setActionError('Enter an activation amount.');
      return;
    }

    try {
      setActivating(true);
      setActionError(null);
      setSuccess(null);

      await BotService.activateBot({
        amount,
        idempotencyKey: generateIdempotencyKey(),
      });

      setActivationAmount('');
      await loadBot();
      await Promise.all([
        loadActivity({
          nextPage: 1,
          nextFilter: activityFilter,
          silent: true,
        }),
        loadReferralPerformance(),
      ]);

      setSuccess('Bot activated successfully.');
    } catch (err) {
      setActionError(parseApiError(err).message);
    } finally {
      setActivating(false);
    }
  }

  // ============================================================
  // DERIVED STATE
  // ============================================================

  const account = bot?.account;
  const wallet = bot?.wallet ?? account?.wallet;
  const headerStatus: BotAccountStatus = account?.status ?? 'inactive';
  const balanceError = loadError ? 'Unable to load bot balance' : null;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="min-h-[60vh] px-4 py-6">
      <div className="mx-auto w-full max-w-[1000px] space-y-5">
        {/* Header */}
        <BotHeader status={headerStatus} />

        {/* Balance Card */}
        <BotBalanceCard
          loading={loading}
          availableBalance={wallet?.availableBalance}
          isAccountMissing={isAccountMissing}
          errorMessage={balanceError}
          mainBalance={balance?.tdxAvailable || balance?.tdx || '0'}
          mainBalanceLoading={walletLoading}
          transferAmount={transferAmount}
          transferLoading={transferring}
          transferDirection={transferDirection}
          transferDirectionEnabled
          transferDirectionMessage={null}
          onAmountChange={setTransferAmount}
          onDirectionChange={(direction) => {
            setTransferDirection(direction);
            setActionError(null);
            setSuccess(null);
          }}
          onTransfer={() => void handleTransfer()}
          onRetry={() => void loadBot()}
        />

        {/* Error / Success */}
        {actionError && (
          <div className="rounded-[12px] border border-[#4A2323] bg-[#281313] px-4 py-3 text-sm font-bold text-[#F87171]">
            {actionError}
          </div>
        )}

        {success && (
          <div className="rounded-[12px] border border-[#1E4A32] bg-[#10251A] px-4 py-3 text-sm font-bold text-[#4ADE80]">
            {success}
          </div>
        )}

        {loadError && (
          <div className="rounded-[12px] border border-[#4A2323] bg-[#281313] px-4 py-3 text-sm font-bold text-[#F87171]">
            {loadError}
          </div>
        )}

        {/* Create Bot */}
        {!account && isAccountMissing && (
          <Card className="p-6">
            <div className="max-w-[600px]">
              <h2 className="text-lg font-black text-[#F5F5F7]">Create Bot Account</h2>
              <p className="mt-2 text-sm font-medium text-[#A1A4AE]">
                Your Bot Account and permanent Bot ID will be created here.
              </p>
              <Button className="mt-5" loading={creating} onClick={handleCreateBot}>
                Create Bot
              </Button>
            </div>
          </Card>
        )}

        {/* Account Details */}
        {account && (
          <>
            <BotAccountCard account={account} />

            <BotActivationCard
              amount={activationAmount}
              loading={activating}
              onAmountChange={setActivationAmount}
              onActivate={() => void handleActivate()}
            />

            <BotReferralEarnings
              data={referralPerformance}
              loading={referralLoading}
              errorMessage={referralError}
            />

            <BotTransactionHistory
              items={activityItems}
              filter={activityFilter}
              loading={activityLoading}
              loadingMore={activityLoadingMore}
              hasMore={activityHasMore}
              errorMessage={activityError}
              onFilterChange={(nextFilter) => {
                setActivityFilter(nextFilter);
                void loadActivity({
                  nextPage: 1,
                  nextFilter,
                });
              }}
              onLoadMore={() => {
                if (activityLoading || activityLoadingMore || !activityHasMore) return;
                void loadActivity({
                  nextPage: activityPage + 1,
                  nextFilter: activityFilter,
                  append: true,
                });
              }}
              onRetry={() => {
                void loadActivity({
                  nextPage: 1,
                  nextFilter: activityFilter,
                });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}