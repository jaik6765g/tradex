# TradeX 🚀

Crypto trading & gaming platform — **NestJS backend** + **React (Expo/Vite) frontend**.

## 🏗️ Monorepo Structure

```
tradeX/
├── backend/    # NestJS API (TypeScript)
│   └── src/
│       ├── auth/           # JWT auth + wallet signature auth
│       ├── users/          # User management
│       ├── wallets/        # Wallet registration
│       ├── balances/       # Balance & bonus ledger
│       ├── ledger/         # Transaction ledger
│       ├── deposits/       # Deposit detection & processing
│       ├── withdrawals/    # Withdrawal management
│       ├── referral/       # Referral codes & rewards
│       ├── admin/          # Admin panel API (bonus, audit logs)
│       ├── pulse-trade/    # Pulse trading feeds
│       └── modules/lotto/  # LOTTO game engine
├── frontend/   # React app (Expo + Vite)
│   └── src/
│       ├── wallet/         # Wallet connect + registration
│       ├── marketplace/    # Marketplace + games + LOTTO
│       ├── home/           # Home / Wallet card
│       ├── referral/       # Referral program UI
│       ├── admin/          # Admin dashboard
│       └── profile/        # User profile
└── docs/       # Feature specs & design docs
```

## ⚡ Getting Started

### Backend
```bash
cd backend
npm install
cp .env.example .env     # configure DB / Redis / JWT
npm run migration:run
npm run start:dev        # http://localhost:3000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env     # configure API base URL
npm run dev              # http://localhost:5173
```

## ✅ Scripts

| App | Script | Pass |
|---|---|---|
| Backend | `npm run build` | Production build |
| Backend | `npm run start:dev` | Dev server (watch) |
| Frontend | `npm run dev` | Vite dev server |
| Frontend | `npm run build` | Production build |
| Frontend | `npm run lint` | TypeScript check |

## 🔐 Environment Variables

**Never commit `.env`** — only `.env.example` files are tracked.
Required variables (backend): DB credentials, Redis URL, `JWT_SECRET`, blockchain RPC URL.

## 🧪 Tests

Unit tests were intentionally **not committed** to keep the repo lean for marketplace deployment. Re-add test files before enabled CI runs.

## 🎰 Lotto — Result Modes & Win Strategy

Controlled from **Admin → Lotto Game Manager** (`/admin/lotto/*`, every change audited).

**Result mode** (`LOTTO_RESULT_MODE`)

| Mode | Behaviour |
|---|---|
| `SERVER_RANDOM` | The backend draws at `drawAt`, honouring the active win strategy. |
| `ADMIN_RESULT` | An admin decides. The result can be **locked in advance** (while the round is still `OPEN`/`CUTOFF`) or set after the draw. A locked symbol is applied verbatim at draw time and can never be overwritten by a server draw. If nothing is locked, the engine waits one extra period and then falls back to a server draw so a round is never left stuck in `DRAWING`. |
| `VERIFIED_RANDOM` | Strict uniform random draw — **never** steered by the win strategy. |

**Win strategy** (`LOTTO_WIN_STRATEGY`, applies to server draws)

Win potential of a number = total payout owed if it wins = `SUM(netAmount × multiplier)` of every unsettled ticket that selected it.

| Strategy | Draw |
|---|---|
| `RANDOM` *(default)* | Uniform random draw — no steering. |
| `HIGH` | The number with the **highest** win potential wins. |
| `MEDIUM` | The number closest to the mid-point of the lowest…highest win-potential range wins. |
| `LOW` | The number with the **lowest** win potential wins. |

If no number carries any stake, every strategy falls back to a uniform random draw. The Admin **Lotto Live Exposure** screen shows the per-number win potential, the H/M/L bands and the exact number the engine will draw for the active round.

## 📄 License

Proprietary — © TradeX. All rights reserved.