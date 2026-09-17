import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  History,
  Loader2,
  Wallet,
} from 'lucide-react';

import { GatewayService } from './gateway.service';
import type {
  DepositOrder,
  GatewayConfig,
  OrderStatusResponse,
  OrderStatus,
} from './gateway.types';

const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Created',
  AWAITING_PAYMENT: 'Awaiting payment',
  DETECTED: 'Payment detected',
  CONFIRMING: 'Confirming',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  UNDERPAID: 'Underpaid',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLOR: Record<string, string> = {
  CREATED: '#A1A4AE',
  AWAITING_PAYMENT: '#F59E0B',
  DETECTED: '#C99752',
  CONFIRMING: '#C99752',
  CONFIRMED: '#C99752',
  COMPLETED: '#4ADE80',
  UNDERPAID: '#FF7A18',
  EXPIRED: '#A1A4AE',
  FAILED: '#F87171',
  CANCELLED: '#A1A4AE',
};

function formatAddress(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

/**
 * Live (resumable) deposit order statuses — a new order cannot be created
 * while one of these is open and unexpired. Expired orders always allow a
 * fresh order.
 */
const LIVE_ORDER_STATUSES: OrderStatus[] = [
  'CREATED',
  'AWAITING_PAYMENT',
  'DETECTED',
  'CONFIRMING',
  'CONFIRMED',
  'UNDERPAID',
];

/**
 * BNB-style logo drawn with code (no photo needed).
 * Black circle background + yellow logo.
 * Data-URI SVG banakar QR ke `imageSettings` me dete hain taaki
 * qrcode.react beech wale dots ko khud saaf kare (excavate) —
 * isse scan me koi issue nahi aata.
 */
const BNB_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#000000" stroke="#FFFFFF" stroke-width="4"/><g fill="#F0B90B" transform="translate(16,16)"><path d="M16 5.5 24.5 14 21.8 16.7 16 10.9 10.2 16.7 7.5 14Z"/><path d="M16 26.5 7.5 18 10.2 15.3 16 21.1 21.8 15.3 24.5 18Z"/><path d="M16 13.2 18.8 16 16 18.8 13.2 16Z"/><path d="M6.2 13.2 9 16 6.2 18.8 3.4 16Z"/><path d="M25.8 13.2 28.6 16 25.8 18.8 23 16Z"/></g></svg>`;
const BNB_LOGO_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(BNB_LOGO_SVG)}`;

export default function DepositGatewayScreen() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [step, setStep] = useState<'form' | 'payment'>('form');
  const [asset] = useState('USDT');
  const [networkId, setNetworkId] = useState('bsc');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<DepositOrder | null>(null);
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [orders, setOrders] = useState<DepositOrder[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [checkingPending, setCheckingPending] = useState(true);
  const [activeOrder, setActiveOrder] = useState<DepositOrder | null>(null);

  const rate = config?.tdxRate ?? 100;

  const enabledNetworks = (config?.networks ?? []).filter(
    (n) => n.depositEnabled,
  );
  const currentNetwork =
    enabledNetworks.find((n) => n.id === networkId) ?? enabledNetworks[0];
  const chainId = currentNetwork?.chainId ?? 56;

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await GatewayService.getConfig());
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const list = await GatewayService.listOrders();
      setOrders(list);
      return list;
    } catch {
      /* non-fatal */
      return [];
    }
  }, []);

  // Backend se live pending order — deposit form ke neeche dikhane ke liye.
  const loadActiveOrder = useCallback(async () => {
    try {
      const { activeOrder: live } = await GatewayService.getActiveOrder();
      setActiveOrder(live);
      return live;
    } catch {
      /* non-fatal */
      return null;
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    // Screen khulne par: backend se pending order lao — wahi khulega, form nahi.
    void (async () => {
      const [list, live] = await Promise.all([loadOrders(), loadActiveOrder()]);
      const resume =
        live ??
        list.find(
          (o) =>
            LIVE_ORDER_STATUSES.includes(o.status) &&
            new Date(o.expiresAt).getTime() > Date.now(),
        );
      if (resume) {
        setOrder(resume);
        setStatus(null);
        setStep('payment');
      }
      setCheckingPending(false);
    })();
  }, [loadConfig, loadOrders, loadActiveOrder]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!order || step !== 'payment') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const s = await GatewayService.getOrderStatus(order.id);
        if (!cancelled) setStatus(s);
      } catch {
        /* network error — keep polling */
      }
    };

    void poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [order, step]);

  const amountNum = Number(amount);
  const tdxPreview =
    amountNum > 0 && Number.isFinite(amountNum)
      ? (amountNum * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : '';

  const expiryMs = order ? new Date(order.expiresAt).getTime() - now : 0;
  const expiryMinutes = Math.floor(expiryMs / 60000);
  const expirySeconds = Math.floor((expiryMs % 60000) / 1000);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const submit = async () => {
    setError(null);
    if (!amount || amountNum <= 0 || !Number.isFinite(amountNum)) {
      setError('Enter a valid amount');
      return;
    }
    // Guard: backend se fresh pending order check karo — live order hai to
    // wahi kholo, naya order mat banao. Usi ko pura karo ya expire ka wait karo.
    try {
      const { activeOrder: fresh } = await GatewayService.getActiveOrder();
      if (fresh) {
        setActiveOrder(fresh);
        setOrder(fresh);
        setStatus(null);
        setStep('payment');
        void loadOrders();
        return;
      }
    } catch {
      /* backend unreachable — local list se guard karo */
    }
    const liveLocal =
      activeOrder &&
      LIVE_ORDER_STATUSES.includes(activeOrder.status) &&
      new Date(activeOrder.expiresAt).getTime() > Date.now()
        ? activeOrder
        : orders.find(
            (o) =>
              LIVE_ORDER_STATUSES.includes(o.status) &&
              new Date(o.expiresAt).getTime() > Date.now(),
          );
    if (liveLocal) {
      setOrder(liveLocal);
      setStatus(null);
      setStep('payment');
      return;
    }
    setBusy(true);
    try {
      const o = await GatewayService.createOrder({
        chainId,
        asset,
        amount: amount.trim(),
      });
      setOrder(o);
      setStatus(null);
      setStep('payment');
      void loadOrders();
      void loadActiveOrder();
    } catch (err) {
      const resp = (err as { response?: { status?: number; data?: { message?: string | string[]; activeOrderId?: string } } })
        ?.response;
      // 409 = backend ne pending order pakda — usi order ko khol do.
      if (resp?.status === 409 && resp?.data?.activeOrderId) {
        try {
          const live = await GatewayService.getOrder(resp.data.activeOrderId);
          setOrder(live);
          setStatus(null);
          setStep('payment');
          void loadOrders();
          return;
        } catch {
          /* fall through to message */
        }
      }
      const msg = resp?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ? String(msg) : 'Failed to create order');
    } finally {
      setBusy(false);
    }
  };

  const currentStatus: OrderStatus = status?.status ?? order?.status ?? 'AWAITING_PAYMENT';

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 py-8 text-[#F5F5F7]">
      <div className="mx-auto w-full max-w-[520px]">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black">Deposit</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">
              No wallet connect required — send from any wallet or exchange
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-[#292B33] px-3 py-1.5 text-xs text-[#A1A4AE]">
            <Wallet size={13} /> {asset} · {currentNetwork?.name ?? 'BSC'}
          </span>
        </header>

        {(config?.provider?.development || order?.development) && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#4A2323] bg-[#281313] px-3 py-2.5 text-xs text-[#F87171]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong>Development Deposit Address — Do Not Send Real Funds.</strong>{' '}
              This environment uses a simulated address provider.
            </span>
          </div>
        )}

        {step === 'form' ? (
          <>
          <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-5">
            <label className="text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
              Asset
            </label>
            <div className="mt-1.5 rounded-xl border border-[#292B33] bg-[#0E0E12] px-4 py-3 text-sm">
              USDT
            </div>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
              Network
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {enabledNetworks.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setNetworkId(n.id)}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    n.id === (currentNetwork?.id ?? 'bsc')
                      ? 'border-[#FF7A18] text-[#F5F5F7]'
                      : 'border-[#292B33] text-[#A1A4AE]'
                  }`}
                >
                  {n.name} ({n.id.toUpperCase()})
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[#A1A4AE]">
              Amount
            </label>
            <input
              type="number"
              min="1"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1.5 w-full rounded-xl border border-[#292B33] bg-[#0E0E12] px-4 py-3 text-lg outline-none focus:border-[#FF7A18]"
            />

            {amountNum > 0 && Number.isFinite(amountNum) && (
              <div className="mt-4 rounded-xl border border-[#34261C] bg-[#211810] px-4 py-3">
                <p className="text-xs text-[#A1A4AE]">You will receive</p>
                <p className="text-2xl font-black text-[#C99752]">
                  {tdxPreview} <span className="text-sm font-normal text-[#A1A4AE]">TDX</span>
                </p>
                <p className="mt-1 text-[10px] text-[#70737E]">
                  Rate: 1 {asset} = {rate} TDX
                </p>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-[#F87171]">{error}</p>}

            <button
              onClick={() => void submit()}
              disabled={busy || checkingPending || !!activeOrder}
              className="mt-5 w-full rounded-2xl py-3.5 text-sm font-black text-[#111217] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
            >
              {checkingPending ? 'Checking pending orders…' : busy ? 'Creating order…' : activeOrder ? 'Pending Order Active — Complete It First' : 'Create Deposit Order'}
            </button>
          </section>

          {/* Pending order — deposit form ke neeche: chhota card + expire timer */}
          {activeOrder &&
            (() => {
              const ms = new Date(activeOrder.expiresAt).getTime() - now;
              const m = Math.max(0, Math.floor(ms / 60000));
              const s = Math.max(0, Math.floor((ms % 60000) / 1000));
              return (
                <button
                  onClick={() => {
                    setOrder(activeOrder);
                    setStatus(null);
                    setStep('payment');
                  }}
                  className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#1A1508] px-3 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#F59E0B]">
                      <Clock size={12} /> {Number(activeOrder.amount).toFixed(2)} {activeOrder.asset}
                      <span className="font-normal text-[#A1A4AE]">
                        · {STATUS_LABEL[activeOrder.status] ?? activeOrder.status}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#A1A4AE]">
                      Expires in {m}m {s}s · tap to resume →
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-black text-[#FF8F3D]">Resume</span>
                </button>
              );
            })()}
          </>
        ) : (
          <div>
            {order && (
              <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-5">
                <div className="flex items-center justify-between">
                  <button onClick={() => setStep('form')} className="flex items-center gap-1 text-xs text-[#A1A4AE]">
                    <ArrowLeft size={14} /> Back
                  </button>
                  <span className="text-xs font-bold" style={{ color: STATUS_COLOR[currentStatus] ?? '#A1A4AE' }}>
                    {STATUS_LABEL[currentStatus] ?? currentStatus}
                  </span>
                </div>

                <div className="mt-3 text-center">
                  <p className="text-2xl font-black">{Number(order.amount).toFixed(2)} {order.asset}</p>
                  <p className="mt-0.5 text-sm text-[#A1A4AE]">≈ {Number(order.tdxAmount).toLocaleString()} TDX</p>
                </div>

                <div className="mt-4 flex justify-center">
                  {order.depositAddress ? (
                    <div className="rounded-2xl bg-white p-3">
                      <QRCodeSVG
                        value={order.depositAddress}
                        size={180}
                        level="H"
                        bgColor="#FFFFFF"
                        fgColor="#000000"
                        imageSettings={{
                          src: BNB_LOGO_SRC,
                          height: 44,
                          width: 44,
                          excavate: true,
                        }}
                      />
                    </div>
                  ) : (
                    <Loader2 size={24} className="animate-spin text-[#A1A4AE]" />
                  )}
                </div>

                {order.depositAddress && (
                  <div className="mt-4 rounded-xl border border-[#292B33] bg-[#0E0E12] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#70737E]">Deposit address — send {order.asset} here</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{order.depositAddress}</span>
                      <button onClick={() => void copy(order.depositAddress as string)} className="shrink-0 text-[#C99752]">
                        {copied === order.depositAddress ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => void copy(order.depositAddress as string)} className="rounded-lg border border-[#292B33] py-2 text-xs">Copy Address</button>
                      <button onClick={() => void copy(order.amount)} className="rounded-lg border border-[#292B33] py-2 text-xs">Copy Amount</button>
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-2 text-xs text-[#A1A4AE]">
                  <div className="flex justify-between"><span>Order ID</span><span className="font-mono">{formatAddress(order.id)}</span></div>
                  {status && status.requiredConfirmations != null && (
                    <div className="flex justify-between"><span>Confirmations</span><span>{status.confirmations}/{status.requiredConfirmations}</span></div>
                  )}
                  {order.transactionHash && (
                    <div className="flex justify-between"><span>Transaction</span><span className="font-mono">{formatAddress(order.transactionHash)}</span></div>
                  )}
                  <div className="flex items-center justify-between"><span>Expires in</span><span className="flex items-center gap-1"><Clock size={12} /> {Math.max(0, expiryMinutes)}m {Math.max(0, expirySeconds)}s</span></div>
                </div>

                {currentStatus === 'EXPIRED' && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-[#FF7A18]">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Order expired. Funds sent after expiry are held for review.
                  </p>
                )}
                {currentStatus === 'EXPIRED' && (
                  <button
                    onClick={() => {
                      setOrder(null);
                      setStatus(null);
                      setStep('form');
                      void loadOrders();
                    }}
                    className="mt-3 w-full rounded-2xl py-3 text-sm font-black text-[#111217]"
                    style={{ background: 'linear-gradient(135deg, #FF8F3D, #FF7A18)' }}
                  >
                    Create New Deposit Order
                  </button>
                )}
                {currentStatus === 'UNDERPAID' && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-[#FF7A18]">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Payment received but below the order amount. Pending review.
                  </p>
                )}
              </section>
            )}

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <History size={15} /> Deposit Orders
                </span>
                <button onClick={() => void loadOrders()} className="text-xs text-[#C99752]">
                  Refresh
                </button>
              </div>

              {orders.length === 0 ? (
                <p className="text-xs text-[#A1A4AE]">No deposit orders yet</p>
              ) : (
                <div className="space-y-2">
                  {orders.map((o) => {
                    const isLive = LIVE_ORDER_STATUSES.includes(o.status) &&
                      new Date(o.expiresAt).getTime() > Date.now();
                    return (
                      <button
                        key={o.id}
                        onClick={() => {
                          if (!isLive) return;
                          setOrder(o);
                          setStatus(null);
                          setStep('payment');
                        }}
                        disabled={!isLive}
                        className={`w-full rounded-xl border border-[#292B33] bg-[#15161C] px-3 py-2.5 text-left ${isLive ? '' : 'opacity-80'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{Number(o.amount).toFixed(2)} {o.asset}</span>
                          <span className="text-xs font-bold" style={{ color: STATUS_COLOR[o.status] ?? '#A1A4AE' }}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[10px] text-[#70737E]">
                          <span className="text-[#4ADE80]">+{Number(o.tdxAmount).toLocaleString()} TDX</span>
                          <span className="font-mono">{o.transactionHash ? formatAddress(o.transactionHash) : formatAddress(o.id)}</span>
                        </div>
                        {o.depositAddress && (
                          <p className="mt-0.5 font-mono text-[10px] text-[#70737E]">{formatAddress(o.depositAddress)}</p>
                        )}
                        {isLive && (
                          <p className="mt-1 text-[10px] font-bold text-[#F59E0B]">Pending — tap to resume payment →</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
