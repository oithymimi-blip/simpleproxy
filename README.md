# SimpleProxy Full Stack Project

Full-stack application (Backend + Frontend) connected to the verified `SimpleProxy` smart contract on Binance Smart Chain (BSC) Mainnet.

## Verified Contract Details

- **Network:** Binance Smart Chain (BSC) Mainnet (Chain ID: `56`)
- **Contract Address:** [`0x842792E64a1b2e1c43EeDd458F877eCfCAe44651`](https://bscscan.com/address/0x842792E64a1b2e1c43EeDd458F877eCfCAe44651#code)
- **Deployment Transaction:** [`0x8f1a3336ad510db3d9d10b55125c8f7062a8e2215436838115e286b52e1d7c8f`](https://bscscan.com/tx/0x8f1a3336ad510db3d9d10b55125c8f7062a8e2215436838115e286b52e1d7c8f)
- **Contract Owner / Admin:** `0x54531185077F08f3eA2d82fa1B893Bc2641d188b`
- **Initial Cooldown:** 3600 seconds (1 hour)
- **Deployment Block:** `130698014`

---

## Project Structure

```text
new_staking/
├── backend/
│   ├── .env                 # Configured with BSC RPC, Contract, Owner PK & Admin addresses
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── config.js        # Loads & validates environment variables
│       ├── chain.js         # Ethers provider, contract instances & ABIs
│       ├── auth.js          # EIP-191 signature-based wallet authentication & JWT issuing
│       └── server.js        # Express REST API (public reads + admin write endpoints)
├── frontend/
│   ├── .env                 # Configured with VITE_CONTRACT_ADDRESS, CHAIN_ID & BACKEND_URL
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api.js           # API client for backend communication
│       ├── wallet.js        # Browser wallet connection helper (MetaMask / EIP-1193)
│       ├── styles.css       # Clean dark-themed styling
│       └── pages/
│           ├── UserPage.jsx # User token approval interface
│           └── AdminPage.jsx# Admin dashboard (duration, limits, pull, live activity)
└── package.json             # Root helper scripts
```

---

## Quick Start

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

Backend will run at `http://localhost:8787`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at `http://localhost:5173`.

### Or Run from Root

```bash
npm run dev:backend
npm run dev:frontend
```

---

## API Endpoints

### Public Endpoints
- `GET /api/config`: Returns chainId, contract address, owner address, and cooldown duration.
- `GET /api/limit/:token`: Returns token limit, symbol, and decimals.
- `GET /api/user/:address/allowance/:token`: Returns user token allowance and balance.
- `GET /api/user/:address/status/:token`: Returns detailed user on-chain profile including balance, active allowance, contract limits, cooldown eligibility, and next pull timestamp.
- `GET /api/activity`: Returns recent pull event logs safely bounded within RPC block range limits.

### Admin Authentication
- `POST /api/auth/nonce`: Generates unique nonces for wallet sign-in.
- `POST /api/auth/verify`: Verifies EIP-191 signature and issues JWT token for whitelisted admins.

### Admin Actions (Requires Bearer Token)
- `POST /api/admin/duration`: Updates cooldown duration on-chain.
- `POST /api/admin/limit`: Updates token limit on-chain.
- `POST /api/admin/pull`: Executes pull on-chain.
- `GET /api/admin/tx/:hash`: Checks on-chain status of a transaction.

---

## Features

### Transparent User Token Approval Interface
- **Pre-configured Verified Tokens:** USDT (BSC-USD), USDC, and DAI selectable with one click (no manual pasting of token contract addresses needed, with optional custom token support).
- **Explicit On-Chain Disclosures:** Direct explorer links for both token contract and authorized spender contract (`SimpleProxy`).
- **Live On-Chain Balances & Allowances:** Displays real-time token balance alongside current active allowance.
- **Customizable Allowance Controls:** Quick percentage buttons (`25%`, `50%`, `100% / Max`) and custom amount input.
- **Revocation Safeguard:** Instant "Revoke Allowance (Set to 0)" button to easily remove spending permissions.
- **Transparent Security Callout:** Explains ERC-20 approval permissions and non-custodial custody rights.

### Admin On-Chain Inspection Dashboard
- **Live User Inspector:** Query any user's wallet address to see their balance, active allowance to `SimpleProxy`, contract token limit, cooldown status, and last pull timestamp.
- **Pull Workflow Integration:** One-click prefill of pull forms with inspected user data and maximum pullable amounts.
- **Parameter Controls:** Manage global cooldown duration and per-token pull caps directly on BSC Mainnet.
- **Recent On-Chain Activity Table:** View recent `Pulled` event logs with direct BscScan transaction links and instant user inspection shortcuts.
