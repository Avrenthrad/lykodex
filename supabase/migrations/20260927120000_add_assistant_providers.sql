-- Bring-your-own-LLM provider config.
--
-- NOT YET APPLIED. Joshua must run this in the Supabase SQL editor
-- (or via the Supabase CLI) before merging/deploying the assistant.
-- Until this table exists, ?service=assistant returns 503.
--
-- Same posture as xbox_tokens / psn_tokens: the API key is a secret.
-- RLS is enabled and no policy is granted to anon or authenticated,
-- and those roles are revoked explicitly so a missing policy is not
-- the only thing standing between the browser and the key. Only the
-- Vercel function's service_role client (api/pricing.js,
-- ?service=assistant) reads or writes rows. The handler returns a
-- masked hint, never api_key.

create table if not exists public.assistant_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  base_url text not null,
  api_key text not null default '',
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_providers_user_id_idx
  on public.assistant_providers (user_id);

alter table public.assistant_providers enable row level security;

revoke all on table public.assistant_providers from PUBLIC, anon, authenticated;
