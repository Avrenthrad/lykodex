-- ---------- Discord bot: per-server settings (additive) ----------
-- One row per Discord server the Lykodex bot is set up in. Holds the
-- activity-feed channel and a cursor (last guild_activity.created_at
-- already posted) so restarts don't re-post or skip anything.
--
-- Written only by the bot using the service_role key. RLS is on with
-- NO policies, so the anon/authenticated keys the app uses can't read
-- or write it at all.
create table if not exists public.discord_guild_settings (
  discord_guild_id text primary key,
  feed_channel_id text,
  feed_enabled boolean not null default true,
  post_now_playing boolean not null default false,
  feed_cursor timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.discord_guild_settings enable row level security;

-- The feed polls guild_activity by (user_id, created_at) — the only
-- existing index is (guild_id, created_at), so add one that fits.
create index if not exists guild_activity_user_created_idx
  on public.guild_activity (user_id, created_at);
