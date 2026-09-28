-- ---------- Discord activity tracking → Mastery (additive) ----------
-- Opt-in data collection from the Lykodex Discord bot:
--   • voice chat time      → new Social College in Overall Mastery
--   • Spotify listening    → Entertainment College
--   • "Watching" activity  → Entertainment College
--   • PC game playtime     → platform_playtime (platform 'pc')
--
-- OPT-IN: the bot records nothing about a person unless
-- profiles.discord_tracking_enabled is true (toggle in Account Settings
-- → Privacy). Off by default, same as share_activity_with_guilds.
alter table public.profiles add column if not exists discord_tracking_enabled boolean not null default false;

-- One row per voice session (join → leave, channel moves stay in the
-- same session). active_seconds only counts time that was genuinely
-- social: not deafened, not in the AFK channel, and with at least one
-- other person in the channel — so sitting alone in voice to farm
-- Social Mastery doesn't count. total_seconds is kept for raw data.
create table if not exists public.discord_voice_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  discord_guild_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  total_seconds integer not null check (total_seconds >= 0),
  active_seconds integer not null check (active_seconds >= 0)
);

alter table public.discord_voice_sessions enable row level security;

create policy "Users can view their own voice sessions"
  on public.discord_voice_sessions for select
  using (auth.uid() = user_id);

create policy "Users can delete their own voice sessions"
  on public.discord_voice_sessions for delete
  using (auth.uid() = user_id);

create index if not exists discord_voice_sessions_user_idx on public.discord_voice_sessions (user_id, started_at desc);

-- One row per listened track / watched title, from Discord's
-- "Listening to" (Spotify) and "Watching" (e.g. Crunchyroll) statuses.
create table if not exists public.discord_media_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  kind text not null check (kind in ('listening', 'watching')),
  source text not null,          -- Discord activity name, e.g. 'Spotify', 'Crunchyroll'
  title text,                    -- track / show title
  subtitle text,                 -- artist / episode
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0)
);

alter table public.discord_media_sessions enable row level security;

create policy "Users can view their own media sessions"
  on public.discord_media_sessions for select
  using (auth.uid() = user_id);

create policy "Users can delete their own media sessions"
  on public.discord_media_sessions for delete
  using (auth.uid() = user_id);

create index if not exists discord_media_sessions_user_idx on public.discord_media_sessions (user_id, started_at desc);

-- PC (non-Steam) playtime joins Xbox/PlayStation in platform_playtime.
-- Steam games are still excluded by the bot — Steam's own API already
-- reports those hours.
alter table public.platform_playtime drop constraint if exists platform_playtime_platform_check;
alter table public.platform_playtime add constraint platform_playtime_platform_check
  check (platform in ('xbox', 'playstation', 'pc', 'unknown'));

-- Per-user totals for Mastery. security_invoker so the app (anon key)
-- still only ever sees its own row through RLS; the bot's service_role
-- key sees everyone's. A view (not client-side summing) because
-- PostgREST caps plain selects at 1000 rows.
create or replace view public.discord_activity_totals
with (security_invoker = true) as
select
  u.user_id,
  coalesce(v.voice_active_seconds, 0) as voice_active_seconds,
  coalesce(v.voice_total_seconds, 0) as voice_total_seconds,
  coalesce(m.listening_seconds, 0) as listening_seconds,
  coalesce(m.watching_seconds, 0) as watching_seconds
from (
  select user_id from public.discord_voice_sessions
  union
  select user_id from public.discord_media_sessions
) u
left join (
  select user_id, sum(active_seconds) as voice_active_seconds, sum(total_seconds) as voice_total_seconds
  from public.discord_voice_sessions group by user_id
) v on v.user_id = u.user_id
left join (
  select user_id,
    sum(duration_seconds) filter (where kind = 'listening') as listening_seconds,
    sum(duration_seconds) filter (where kind = 'watching') as watching_seconds
  from public.discord_media_sessions group by user_id
) m on m.user_id = u.user_id;

grant select on public.discord_activity_totals to authenticated, service_role;
