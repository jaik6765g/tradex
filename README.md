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

## 📄 License

Proprietary — © TradeX. All rights reserved.