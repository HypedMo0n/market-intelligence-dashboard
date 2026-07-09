create extension if not exists "pgcrypto";

create table if not exists public.mt5_snapshots (
  id uuid primary key default gen_random_uuid(),
  instrument text not null,
  source text not null default 'MT5',
  timestamp timestamptz not null,
  price numeric,
  trend text not null,
  structure text not null,
  volatility text not null,
  support numeric,
  resistance numeric,
  recent_high numeric,
  recent_low numeric,
  liquidity_zones text,
  notes text,
  raw_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists mt5_snapshots_instrument_created_at_idx
  on public.mt5_snapshots (instrument, created_at desc);

alter table public.mt5_snapshots enable row level security;

-- Service-role API routes bypass RLS. Keep browser clients read-only through
-- internal API routes unless you explicitly add public policies later.
