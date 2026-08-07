# Binance Square Multi-Account Manager

Post crypto content to **multiple Binance Square accounts** from a single GitHub repo, managed through a web dashboard. Everything runs in the cloud — GitHub Actions does the posting, a Cloudflare Worker + D1 stores data securely, and GitHub Pages hosts your control panel. Nothing runs on your local machine.

---

## Architecture

```
┌────────────────────────┐   HTTPS (fetch accounts/keys)   ┌─────────────────────────┐
│  GitHub Actions         │ ─────────────────────────────▶ │  Cloudflare Worker + D1  │
│  cron: every 5 min      │ ◀───────────────────────────── │  /api/accounts           │
│  automation/run.mjs     │   POST publish reports          │  /api/posts              │
│   · fetches due accounts│                                │  /api/stats/overview     │
│   · generates content   │────────────────────────────────│  Binance keys encrypted   │
│   · chart image (canvas)│  best-effort engagement        │  at rest (AES-256-GCM)    │
│   · posts per account   │  ◀─── scrape.mjs daily ───────  │                          │
└────────────────────────┘                                └─────────────────────────┘
         │                                                          ▲
         │ publishes to Binance Square                               │ reads/writes
         ▼                                                           │
   ┌────────────────────────┐                     ┌───────────────┐  │  GitHub Pages /
   │  Binance Square (each   │                     │  DASHBOARD     │──┘  Cloudflare Pages
   │  account via its key)   │                     │  static SPA    │
   └────────────────────────┘                     └───────────────┘
```

### Components
| Part | Where it runs | What it does |
|------|--------------|--------------|
| **Automation** (`automation/`) | GitHub Actions | Fetches due accounts, generates content + chart images with Groq LLM + CoinGecko + canvas, publishes to each account's Binance Square, reports results to the API |
| **Engagement scrape** (`automation/scrape.mjs`) | GitHub Actions (daily) | Best-effort attempt to read views/reactions from public post pages; silently degrades if unavailable |
| **API** (`api/`) | Cloudflare Worker + D1 | Stores encrypted Binance keys, post history, per-account settings; auth via `X-API-Token` (admin) and `X-Bot-Token` (pipeline) |
| **Dashboard** (`docs/`) | GitHub Pages / any static host | Add/remove accounts, paste Binance keys, toggle modes, view timeline + analytics |

---

## Security model

- **Binance keys are encrypted at rest** in Cloudflare D1 using AES-256-GCM (`crypto.subtle`), keyed by the `KEY_ENCRYPTION_SECRET` Worker secret.
- The admin token **never sees raw keys** — only a masked preview (`abc1…XYZ9`).
- `KEY_ENCRYPTION_SECRET` is only held inside Cloudflare.
- The automation's `BOT_TOKEN` can retrieve a key, but that token lives in GitHub Secrets (encrypted) and the key is used only in-memory to publish, never written to files/logs/commits.
- No Binance key ever appears in the dashboard UI, GitHub, or logs.

---

## Setup (all cloud, ~25 minutes)

### 1. Cloudflare backend
```bash
# in api/
npm i
wrangler login                                   # browser auth
wrangler d1 create binance-manager               # note the database_id
# put that id in api/wrangler.toml
wrangler d1 execute binance-manager --local --file=./migrations/0001_init.sql   # (optional local check)
# apply remote via your Cloudflare dashboard (D1 Console → Run migration), or set up migrations
wrangler deploy
wrangler secret put ADMIN_TOKEN        # random long token, e.g. openssl rand -hex 32
wrangler secret put BOT_TOKEN          # separate random token
wrangler secret put KEY_ENCRYPTION_SECRET   # AES key material, e.g. openssl rand -hex 32
```

### 2. GitHub Actions secrets
In your repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `API_URL` | Your deployed worker URL (`https://binance-manager.<sub>.workers.dev`) |
| `BOT_TOKEN` | Same as the Worker `BOT_TOKEN` |
| `GROQ_API_KEY` | Groq key (content generation) |
| `GROQ_MODEL` | optional, default `llama-3.3-70b-versatile` |

> Binance keys are **not** stored in GitHub secrets — they live encrypted in D1 and are entered through the dashboard.

### 3. Dashboard
- Point GitHub Pages at the `docs/` folder (already configured), or any static host.
- Open `https://sanketh-l.github.io/binance-square-manager/` → enter your Worker `API_URL` and the **admin** token.
- **Accounts tab → Add account** — name + Binance Square OpenAPI key + mode + interval + daily cap.

### 4. Trigger
- `workflow_dispatch` on `Binance Auto-Poster` for an instant test, or just the cron (`*/5 * * * *`).
- Each account posts only when its own `interval_min` and `daily_cap` allow — a cron every 5 min is the "polling" heartbeat, not a per-account blast.

---

## Per-account behavior

Each account has its own:
- **Mode** — `broadcast`: share the same researched post across all broadcast accounts; `unique`: own coin research, own post.
- **Interval** (`intervalMin`) — minimum minutes between posts.
- **Daily cap** (`dailyCap`) — max posts per rolling 24h (protects against Binance `220009` daily-limit).
- **Enabled on/off**.

---

## API routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | none | liveness |
| `GET` | `/api/health/env` | none | config check for dashboard login |
| `GET` | `/api/accounts` | admin or bot | list accounts (masked keys) |
| `POST` | `/api/accounts` | admin | create account (encrypts key) |
| `PATCH` | `/api/accounts/:id` | admin | update name/mode/interval/cap/enabled/key |
| `DELETE` | `/api/accounts/:id` | admin | delete account |
| `POST` | `/api/accounts/key` | bot | retrieve decrypted key for publishing |
| `GET` | `/api/posts` | admin | list posts (filter: `accountId`, `from`, `to`, `page`, `limit`) |
| `POST` | `/api/posts` | bot | record a publish/failure result |
| `POST` | `/api/posts/status` | bot | update scrape views/reactions |
| `GET` | `/api/stats/overview` | admin | totals + per-account |
| `GET` | `/api/stats/series` | admin | posts-per-day (`days` param) |

---

## Dashboard pages
- **Overview** — totals, success rate, account cards, latest posts.
- **Accounts** — add/edit/delete/pause accounts.
- **Timeline** — every post: text, image, time, status, live link, views.
- **Analytics** — posts-per-day bars, per-account volume.

---

## Notes / limitations
- Binance Square OpenAPI exposes **no native engagement API** for your own posts; the daily scrape is best-effort against public post payloads. Telemetry (what/when/how often) is always reliable.
- Groq is free-tier; heavy `unique` rotation burns more tokens.
- `canvas` needs Linux/Ubuntu system libs — already handled in the GitHub Actions workflow.