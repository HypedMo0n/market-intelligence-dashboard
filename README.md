# AI Trading Intelligence Platform

An educational market-intelligence dashboard for retail traders. It explains what is happening across selected instruments using MT5 market data, macro context, news-risk framing, and plain-English guidance.

This product does not execute trades, automate trading, or produce guaranteed buy/sell signals.

## Architecture

```text
MT5 terminal on local machine
  -> scripts/mt5_bridge.py
  -> POST /api/mt5-ingest
  -> Supabase mt5_snapshots
  -> GET /api/mt5-latest
  -> Next.js dashboard
```

Macro context is served by `POST /api/macro-scan`. It uses a local educational fallback by default, so no AI API key is required. If you later configure `OPENAI_API_KEY` and `OPENAI_MODEL`, the route can use OpenAI for richer macro explanations.

## Active Structure

```text
app/
  api/macro-scan
  api/mt5-ingest
  api/mt5-latest
components/
  common/
  instruments/
  macro/
lib/
  ai/
  macro/
  market-analysis/
  providers/
  prompts/
  scoring/
scripts/
  mt5_bridge.py
supabase/
  schema.sql
archive/
  turtleos-phase1/
  removed-screenshot-workflow/
```

## Environment

Copy `.env.example` to `.env.local` for the Next.js app.

Required for MT5 ingest:

```text
MT5_INGEST_SECRET=
```

Required for Supabase persistence:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional AI provider:

```text
OPENAI_API_KEY=
OPENAI_MODEL=
```

Optional bridge target:

```text
VERCEL_APP_URL=http://localhost:3000
```

## Supabase Setup

Run `supabase/schema.sql` in the Supabase SQL editor. It creates `mt5_snapshots` with an index on `(instrument, created_at)`.

## Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## MT5 Bridge

Run this on the Windows machine where MT5 is installed and logged into the demo account:

```powershell
pip install MetaTrader5
$env:VERCEL_APP_URL="http://localhost:3000"
$env:MT5_INGEST_SECRET="<same secret as Next/Vercel>"
python scripts/mt5_bridge.py
```

The bridge reads:

- `XAUUSD`
- `XAGUSD`
- `EURUSD`
- `AUDUSD`
- `GBPJPY`

Each snapshot includes price, timestamp, trend, market structure, volatility, support, resistance, recent high, recent low, liquidity zones, and notes.

The bridge posts securely to `/api/mt5-ingest`. It verifies the configured demo account and contains no order-placement code.

## API Routes

- `POST /api/macro-scan`: returns macro overview and per-instrument educational context. Works without an AI key via local fallback.
- `POST /api/mt5-ingest`: receives MT5 bridge snapshots after secret verification and stores them in Supabase.
- `GET /api/mt5-latest`: returns the latest snapshot per instrument for the dashboard.

## Dashboard Behavior

- MT5 data is the primary chart source.
- The dashboard auto-refreshes `/api/mt5-latest`.
- Manual MT5 JSON paste remains available as a backup.
- Screenshot upload analysis has been archived and removed from the active workflow.
- Each instrument shows a status badge:
  - `FAVORABLE`
  - `CAUTION`
  - `AVOID`
  - `NO DATA`

The numerical score is kept internally by `getMarketStatus()` and is not the primary UI.

## Deploy To Vercel

1. Push the Next.js project to your repo.
2. Import it in Vercel.
3. Add environment variables:
   - `MT5_INGEST_SECRET`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - optionally `OPENAI_API_KEY` and `OPENAI_MODEL`
4. Deploy.
5. Set `VERCEL_APP_URL` on the local MT5 bridge machine to your Vercel URL.

## Testing With MT5

1. Start the dashboard locally or deploy to Vercel.
2. Confirm Supabase schema is installed.
3. Set the same `MT5_INGEST_SECRET` in the app and local bridge environment.
4. Run `python scripts/mt5_bridge.py`.
5. Open the dashboard and use `Fetch latest MT5`.
6. Confirm instrument cards update with price, trend, structure, levels, and status badges.

## Archived Material

The original TurtleOS Phase 1 research code, tests, outputs, and removed screenshot/Anthropic workflow are preserved under `archive/` for reference. They are not part of the active MVP runtime.
