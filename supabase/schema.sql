-- Lykodex — initial Supabase schema for real, persistent accounts.
-- Run this once in Supabase Dashboard > SQL Editor > New query > Run.
--
-- Two tables:
--   profiles       — one row per user, everything from Account Settings
--                    (name, avatar, theme, currency, linked Steam ID, GD Score)
--   wishlist_items — one row per wishlisted game
--
-- Both use Row Level Security so each person can only ever see/edit
-- their own data — Supabase enforces this at the database level based
-- on who's actually logged in, not just something the app promises to
-- respect.

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  theme_mode text default 'dark',
  accent_color text default 'red',
  currency text default 'AUD',
  gd_score integer default 0,
  linked_steam_id text,
  dashboard_layout jsonb,
  platform_order jsonb,
  xbxprices_key text,
  platprices_key text,
  dashfeed_games jsonb,
  dashfeed_stores jsonb,
  dashfeed_platforms jsonb,
  profile_details jsonb,
  selected_colleges jsonb,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-creates a blank profile row the moment someone signs up, so
-- the app never has to worry about a missing profile for a real user.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.wishlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  added_at timestamptz default now()
);

alter table public.wishlist_items enable row level security;

create policy "Users can view their own wishlist"
  on public.wishlist_items for select
  using (auth.uid() = user_id);

create policy "Users can insert into their own wishlist"
  on public.wishlist_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own wishlist items"
  on public.wishlist_items for delete
  using (auth.uid() = user_id);

create index wishlist_items_user_id_idx on public.wishlist_items (user_id);

-- Cross-platform playtime, aggregated by the Discord presence bot (see
-- /discord-bot). Steam hours are NEVER written here — Steam already
-- has its own official, complete playtime_forever number (fetched
-- directly from Steam's API), so tracking Steam sessions here too
-- would double-count. This table exists specifically for the two
-- platforms with no official playtime API of their own: Xbox and
-- PlayStation. Hours here can only start accumulating from the
-- moment someone links Discord and joins the tracking server — there
-- is no way to backfill time played before that point, on any platform,
-- because no such historical data source exists for consoles anywhere.
create table public.platform_playtime (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  platform text not null check (platform in ('xbox', 'playstation', 'unknown')),
  game_name text not null,
  total_minutes integer not null default 0,
  updated_at timestamptz default now(),
  unique (user_id, platform, game_name)
);

alter table public.platform_playtime enable row level security;

-- Read access is broader than most tables here on purpose — the
-- Friends dashboard needs to show a friend's cross-platform hours,
-- not just your own, the same way Discord itself shows this
-- information to anyone who can see the person's activity status.
create policy "Anyone signed in can view platform playtime"
  on public.platform_playtime for select
  using (auth.role() = 'authenticated');

-- Deliberately NO insert/update policy for regular users — only the
-- bot (using the service_role key, which bypasses RLS entirely) is
-- ever meant to write to this table. The service_role key must never
-- reach the browser or any Vercel client-facing function — it only
-- lives in the bot's own separate hosting environment.
create index platform_playtime_user_id_idx on public.platform_playtime (user_id);

-- Live "currently playing" status, written by the same bot. Kept as
-- its own table rather than adding columns to profiles specifically
-- because profiles also stores personal API keys (xbxprices_key,
-- platprices_key) — broadening that table's read policy so friends
-- could see each other's activity would also broaden it to expose
-- everyone's personal keys to every other signed-in user, which is a
-- real security mistake worth deliberately avoiding here.
create table public.current_activity (
  user_id uuid references auth.users on delete cascade primary key,
  platform text check (platform in ('xbox', 'playstation', 'steam', 'unknown')),
  game_name text,
  updated_at timestamptz default now()
);

alter table public.current_activity enable row level security;

create policy "Anyone signed in can view current activity"
  on public.current_activity for select
  using (auth.role() = 'authenticated');

-- Maps a Discord snowflake ID to a Lykodex account, so the bot can
-- look up "which Lykodex user is this Discord presence update
-- about" with one simple indexed query, using the service_role key,
-- rather than needing risky direct access to Supabase's internal
-- auth schema tables. Populated by the frontend right after a
-- successful Discord link (see AccountLinkingPage.jsx).
create table public.discord_links (
  user_id uuid references auth.users on delete cascade primary key,
  discord_user_id text unique not null,
  updated_at timestamptz default now()
);

alter table public.discord_links enable row level security;

create policy "Users can manage their own Discord link"
  on public.discord_links for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Backlog / To Be Played list. steam_appid is stored directly at add
-- time (from search or library-import results) rather than resolved
-- by title later — more reliable, and avoids an extra lookup every
-- time the list renders. hours_estimate is explicitly self-reported:
-- there's no legitimate public API for "how long does this game take
-- to beat" (HowLongToBeat has never published one — every wrapper
-- library for it is an unofficial scrape of their private search
-- endpoint, which this project deliberately doesn't use). Letting
-- people type in their own number, clearly labeled as their own
-- estimate, is the honest way to get a sortable "length" value.
--
-- status: matches the same 4-state model every competitor backlog
-- tracker uses (Backloggd, Grouvee, Playlogged) — Backlog/Playing/
-- Completed/Dropped, confirmed via real research rather than assumed.
-- Also what makes a genuine "what should I play next" feature
-- possible — picking a random suggestion only makes sense from the
-- "backlog" status specifically, not from games already finished.
create table public.backlog_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  steam_appid text,
  hours_estimate numeric,
  status text default 'backlog' check (status in ('backlog', 'playing', 'completed', 'dropped')),
  parent_title text,
  added_at timestamptz default now()
);

alter table public.backlog_items enable row level security;

create policy "Users can view their own backlog"
  on public.backlog_items for select
  using (auth.uid() = user_id);

create policy "Users can add to their own backlog"
  on public.backlog_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own backlog items"
  on public.backlog_items for update
  using (auth.uid() = user_id);

create policy "Users can remove their own backlog items"
  on public.backlog_items for delete
  using (auth.uid() = user_id);

create index backlog_items_user_id_idx on public.backlog_items (user_id);

-- If you already ran an earlier version of this schema (before
-- dashboard_layout/platform_order/xbxprices_key/platprices_key
-- existed), run this instead of the CREATE TABLE above to add the new
-- columns without losing existing data:
--   alter table public.profiles add column if not exists dashboard_layout jsonb;
--   alter table public.profiles add column if not exists platform_order jsonb;
--   alter table public.profiles add column if not exists xbxprices_key text;
--   alter table public.profiles add column if not exists platprices_key text;
--   alter table public.profiles add column if not exists dashfeed_games jsonb;
--   alter table public.profiles add column if not exists dashfeed_stores jsonb;
--   alter table public.profiles add column if not exists dashfeed_platforms jsonb;
--   alter table public.profiles add column if not exists profile_details jsonb;
--   alter table public.profiles add column if not exists selected_colleges jsonb;
--
-- The four new tables (platform_playtime, current_activity,
-- discord_links, backlog_items) can't be added via a simple alter
-- table — if you already ran an earlier schema version, just run each
-- one's "create table" block (and the policy right after it)
-- directly; they're additive and won't affect anything else.
--
-- Trading Cards — Phase 1: Magic the Gathering (collection, deck
-- building, pricing). Real card data throughout, via Scryfall's
-- genuine free public API — see lib/scryfall.js. scryfall_id is
-- stored directly at add time (search/autocomplete results already
-- carry it) rather than resolved by name later, same reasoning as
-- backlog_items.steam_appid.
create table public.mtg_collection (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  scryfall_id text not null,
  card_name text not null,
  set_code text,
  quantity integer default 1,
  foil boolean default false,
  condition text default 'Near Mint',
  -- Real provenance, not decorative: 'manual' (added by hand/search/
  -- scan) vs the real CSV source it came from ('manabox', 'collectr',
  -- 'csv') — see lib/csvImport.js.
  source text default 'manual',
  added_at timestamptz default now()
);

alter table public.mtg_collection enable row level security;

create policy "Users can view their own MTG collection"
  on public.mtg_collection for select
  using (auth.uid() = user_id);

create policy "Users can add to their own MTG collection"
  on public.mtg_collection for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own MTG collection"
  on public.mtg_collection for update
  using (auth.uid() = user_id);

create policy "Users can remove from their own MTG collection"
  on public.mtg_collection for delete
  using (auth.uid() = user_id);

create index mtg_collection_user_id_idx on public.mtg_collection (user_id);

create table public.mtg_decks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  format text default 'commander',
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.mtg_decks enable row level security;

create policy "Users can manage their own MTG decks"
  on public.mtg_decks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.mtg_deck_cards (
  id uuid default gen_random_uuid() primary key,
  deck_id uuid references public.mtg_decks on delete cascade not null,
  scryfall_id text not null,
  card_name text not null,
  quantity integer default 1,
  is_sideboard boolean default false
);

alter table public.mtg_deck_cards enable row level security;

-- Owned indirectly through the parent deck, not a direct user_id
-- column — the policy checks the deck this card belongs to is
-- actually owned by the current user.
create policy "Users can manage cards in their own MTG decks"
  on public.mtg_deck_cards for all
  using (exists (select 1 from public.mtg_decks where mtg_decks.id = mtg_deck_cards.deck_id and mtg_decks.user_id = auth.uid()))
  with check (exists (select 1 from public.mtg_decks where mtg_decks.id = mtg_deck_cards.deck_id and mtg_decks.user_id = auth.uid()));

create index mtg_deck_cards_deck_id_idx on public.mtg_deck_cards (deck_id);


-- Guilds — real social groups of Lykodex users. NOT the same as the
-- 5 top-level "Colleges" (Gaming/TCG/Entertainment/Collectibles/
-- Tabletop) — a Guild is a small crew of people, cutting across all
-- of them. Deliberately real-data-only: the activity feed surfaces
-- things Lykodex already genuinely tracks (achievements, GD Score,
-- backlog status, wishlist adds, MTG collection adds) rather than
-- inventing new stats. No per-game "raids won"/"K:D ratio" style
-- data — most games don't expose that to third parties, and faking
-- it would violate the core honesty principle held everywhere else
-- in this project.
create table public.guilds (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

alter table public.guilds enable row level security;

create policy "Any signed-in user can browse guilds"
  on public.guilds for select
  using (auth.uid() is not null);

create policy "Any signed-in user can create a guild"
  on public.guilds for insert
  with check (auth.uid() = created_by);

create policy "Only the creator can update or delete their guild"
  on public.guilds for update
  using (auth.uid() = created_by);

create policy "Only the creator can delete their guild"
  on public.guilds for delete
  using (auth.uid() = created_by);

create table public.guild_members (
  id uuid default gen_random_uuid() primary key,
  guild_id uuid references public.guilds on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  joined_at timestamptz default now(),
  unique (guild_id, user_id)
);

alter table public.guild_members enable row level security;

create policy "Any signed-in user can view guild rosters"
  on public.guild_members for select
  using (auth.uid() is not null);

-- v1 deliberately has no kick/roles system — a member can only add
-- or remove themselves, not manage anyone else's membership.
create policy "Users can join a guild themselves"
  on public.guild_members for insert
  with check (auth.uid() = user_id);

create policy "Users can leave a guild themselves"
  on public.guild_members for delete
  using (auth.uid() = user_id);

-- The shared activity feed. Members-only visibility (real personal
-- activity, not something to make publicly browsable) — event_data is
-- a small jsonb payload (e.g. { "title": "Elden Ring" }) rather than a
-- rigid column-per-event-type schema, since new real event types will
-- likely be added over time.
create table public.guild_activity (
  id uuid default gen_random_uuid() primary key,
  guild_id uuid references public.guilds on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  event_type text not null check (event_type in (
    'achievement_unlocked', 'gd_score_milestone', 'backlog_status_change',
    'wishlist_added', 'mtg_card_added', 'joined_guild'
  )),
  event_data jsonb,
  created_at timestamptz default now()
);

alter table public.guild_activity enable row level security;

create policy "Guild members can view their guild's activity feed"
  on public.guild_activity for select
  using (exists (select 1 from public.guild_members where guild_members.guild_id = guild_activity.guild_id and guild_members.user_id = auth.uid()));

-- Users can only ever log their OWN real activity, and only into a
-- guild they're actually a member of — never on someone else's behalf.
create policy "Members can log their own real activity"
  on public.guild_activity for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.guild_members where guild_members.guild_id = guild_activity.guild_id and guild_members.user_id = auth.uid())
  );

create index guild_members_guild_id_idx on public.guild_members (guild_id);
create index guild_members_user_id_idx on public.guild_members (user_id);
create index guild_activity_guild_id_idx on public.guild_activity (guild_id, created_at desc);

-- Entertainment College — first real slice: movies and TV via TMDB's
-- genuine free API (see lib/tmdb.js). Anime (AniList) and books (Open
-- Library) are researched and approved but not yet built — this table
-- shape already accommodates them (media_kind/source are open to
-- anime/book values) so adding those sources later won't need a
-- schema change, just new source integrations.
create table public.entertainment_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  media_kind text not null check (media_kind in ('movie', 'tv', 'anime', 'book')),
  source text not null check (source in ('tmdb', 'anilist', 'open_library', 'manual')),
  source_item_id text,
  title text not null,
  status text not null default 'want_to_watch' check (status in ('want_to_watch', 'watching', 'completed', 'dropped')),
  cover_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.entertainment_entries enable row level security;

create policy "Users can manage their own entertainment entries"
  on public.entertainment_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index entertainment_entries_user_id_idx on public.entertainment_entries (user_id);

-- If you already ran backlog_items before the status column existed:
--   alter table public.backlog_items add column if not exists status text default 'backlog' check (status in ('backlog', 'playing', 'completed', 'dropped'));
--
-- The three new MTG tables (mtg_collection, mtg_decks, mtg_deck_cards)
-- are additive, same as the tables above — if you already ran an
-- earlier schema version, just run each "create table" block (and the
-- policy right after it) directly.
--
-- Collectibles College — Phase 1 of an approved design: a real
-- personal physical inventory (shelf + hardware), not a fake browsable
-- catalogue. No general catalogue API exists for most of these types
-- (Funko, statues, pins) — verified during scoping — so this is
-- honest structured user entry by design, not a placeholder waiting
-- for an API that doesn't exist. package_state and condition are
-- separate, first-class fields (a set can be genuinely sealed OR
-- built, a Pop boxed OR loose) rather than one vague "condition"
-- field, since collectors actually track these as distinct facts.
-- source is already 'user'-only right now but includes real future
-- integrations (Rebrickable, Discogs, IGDB — all independently
-- confirmed real) approved for later phases, so the column won't
-- need to change shape when those land.
create table public.collectible_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  type text not null check (type in (
    'figure', 'statue', 'funko_pop', 'lego_set', 'model_kit', 'amiibo', 'prop', 'pin',
    'vinyl_music', 'print', 'collectors_edition', 'console', 'controller', 'accessory', 'other'
  )),
  title text not null,
  identifier text,
  package_state text not null default 'sealed' check (package_state in (
    'sealed', 'opened_boxed', 'loose', 'boxed_complete', 'boxed_incomplete', 'discarded_box'
  )),
  condition text not null default 'mint' check (condition in ('mint', 'near_mint', 'good', 'fair', 'poor')),
  qty integer not null default 1,
  price_paid numeric,
  currency text,
  acquired_at date,
  notes text,
  source text not null default 'user' check (source in ('user', 'rebrickable', 'brickset', 'discogs', 'igdb', 'amiiboapi')),
  is_wishlist boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.collectible_entries enable row level security;

create policy "Users can manage their own collectible entries"
  on public.collectible_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index collectible_entries_user_id_idx on public.collectible_entries (user_id);

-- If you already ran backlog_items before the status column existed:
--   alter table public.backlog_items add column if not exists status text default 'backlog' check (status in ('backlog', 'playing', 'completed', 'dropped'));
--
-- The three new MTG tables (mtg_collection, mtg_decks, mtg_deck_cards)
-- are additive, same as the tables above — if you already ran an
-- earlier schema version, just run each "create table" block (and the
-- policy right after it) directly.
--
-- Tabletop College — real RPG and wargame tracking. Deliberately
-- scoped down from an earlier, much larger design that included
-- infrastructure for two unbuilt future products (a Discord
-- integration and a digital VTT app) — those are real future ideas,
-- but building schema for products that don't exist yet risks
-- reworking live tables once they're actually scoped for real. This
-- is the same "prove out the core first" approach used for every
-- other College. campaign/character link-out URL fields ARE kept,
-- since "link to your existing D&D Beyond campaign" is genuinely
-- useful today, unlike the Discord-specific hooks.
create table public.tabletop_campaigns (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  system_key text not null,
  role text not null default 'player' check (role in ('gm', 'player', 'both')),
  status text not null default 'planning' check (status in ('planning', 'active', 'hiatus', 'concluded')),
  summary text,
  next_session_at timestamptz,
  external_vtt_url text,
  dndbeyond_campaign_url text,
  total_session_minutes integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tabletop_campaigns enable row level security;

create policy "Users can manage their own campaigns"
  on public.tabletop_campaigns for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.tabletop_characters (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  campaign_id uuid references public.tabletop_campaigns on delete set null,
  name text not null,
  system_key text not null,
  player_name text,
  level_or_tier text,
  class_or_playbook text,
  sheet_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tabletop_characters enable row level security;

create policy "Users can manage their own characters"
  on public.tabletop_characters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.tabletop_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  campaign_id uuid references public.tabletop_campaigns on delete cascade not null,
  played_at date,
  duration_minutes integer,
  recap text,
  created_at timestamptz default now()
);

alter table public.tabletop_sessions enable row level security;

create policy "Users can manage their own sessions"
  on public.tabletop_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.wargame_armies (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  system_key text not null,
  name text not null,
  faction text,
  points_limit integer,
  status text not null default 'collecting' check (status in ('collecting', 'building', 'playable', 'archived')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.wargame_armies enable row level security;

create policy "Users can manage their own armies"
  on public.wargame_armies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.wargame_units (
  id uuid default gen_random_uuid() primary key,
  army_id uuid references public.wargame_armies on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  datasheet_name text,
  model_count integer not null default 1,
  points_cost integer,
  painted_status text not null default 'unassembled' check (painted_status in ('unassembled', 'assembled', 'primed', 'partial', 'finished')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.wargame_units enable row level security;

create policy "Users can manage their own units"
  on public.wargame_units for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.wargame_games (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  system_key text not null,
  army_id uuid references public.wargame_armies on delete set null,
  played_at date,
  opponent_name text,
  opponent_faction text,
  points_level integer,
  result text not null check (result in ('win', 'loss', 'draw', 'unfinished')),
  score_us integer,
  score_them integer,
  notes text,
  created_at timestamptz default now()
);

alter table public.wargame_games enable row level security;

create policy "Users can manage their own game results"
  on public.wargame_games for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index tabletop_campaigns_user_id_idx on public.tabletop_campaigns (user_id);
create index tabletop_characters_user_id_idx on public.tabletop_characters (user_id);
create index tabletop_sessions_campaign_id_idx on public.tabletop_sessions (campaign_id);
create index wargame_armies_user_id_idx on public.wargame_armies (user_id);
create index wargame_units_army_id_idx on public.wargame_units (army_id);
create index wargame_games_user_id_idx on public.wargame_games (user_id);

-- If you already ran backlog_items before the status column existed:
--   alter table public.backlog_items add column if not exists status text default 'backlog' check (status in ('backlog', 'playing', 'completed', 'dropped'));
--
-- The three new MTG tables (mtg_collection, mtg_decks, mtg_deck_cards)
-- are additive, same as the tables above — if you already ran an
-- earlier schema version, just run each "create table" block (and the
-- policy right after it) directly.
--
-- The three new Guild tables (guilds, guild_members, guild_activity)
-- are additive too, same pattern.
--
-- Avatar storage — a real, genuine fix for a bug that's been present
-- since very early in this project: avatar "upload" was only ever
-- creating a browser-local blob: URL (URL.createObjectURL), which
-- looks like it works for a moment but is never actually saved
-- anywhere — it goes dead on any refresh, new session, or different
-- device. This creates a real public storage bucket and RLS scoping
-- each user to only write inside their own user-id-named folder,
-- matching every other table's ownership pattern in this project.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- entertainment_entries is additive too, same pattern.
--
-- collectible_entries is additive too, same pattern.
--
-- The six new Tabletop/Wargame tables are additive too, same pattern.
--
-- The avatars storage bucket + policies are additive too — if you
-- already have an "avatars" bucket, the "on conflict do nothing"
-- above means it's safe to run this again.
--
-- If you already ran collectible_entries before is_wishlist existed:
--   alter table public.collectible_entries add column if not exists is_wishlist boolean not null default false;

-- ---------- TCG: Binders & Set Lists (additive) ----------
-- A "binder" is a user-named group of cards (with labels + an optional
-- cover photo) separate from the flat mtg_collection list — e.g. "EDH
-- staples" or "Trade box". A "set list" is the same table with kind =
-- 'set_list': it's pinned to one real Scryfall set (set_code/set_name/
-- scryfall_set_icon_url all come straight from Scryfall's own Set API,
-- never invented) and mtg_binder_cards under it doubles as that set's
-- owned-quantity checklist.
create table public.mtg_binders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  labels jsonb default '[]'::jsonb,
  cover_image_url text,
  kind text not null default 'binder' check (kind in ('binder', 'set_list')),
  set_code text,
  set_name text,
  scryfall_set_icon_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.mtg_binders enable row level security;

create policy "Users can manage their own binders"
  on public.mtg_binders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index mtg_binders_user_id_idx on public.mtg_binders (user_id);

-- One row per distinct card per binder (quantity holds the count),
-- same "stable id at add time, live data resolved later" pattern as
-- mtg_collection — never a stored price/text snapshot that goes stale.
create table public.mtg_binder_cards (
  id uuid default gen_random_uuid() primary key,
  binder_id uuid references public.mtg_binders on delete cascade not null,
  scryfall_id text not null,
  card_name text not null,
  set_code text,
  quantity integer not null default 1,
  foil boolean default false,
  -- Standard 5-point TCG grading scale (same one TCGplayer/Card
  -- Kingdom use) — matches mtg_collection.condition below.
  condition text default 'Near Mint',
  source text default 'manual',
  added_at timestamptz default now(),
  unique (binder_id, scryfall_id)
);

alter table public.mtg_binder_cards enable row level security;

-- Owned indirectly through the parent binder, same pattern as
-- mtg_deck_cards -> mtg_decks.
create policy "Users can manage cards in their own binders"
  on public.mtg_binder_cards for all
  using (exists (select 1 from public.mtg_binders where mtg_binders.id = mtg_binder_cards.binder_id and mtg_binders.user_id = auth.uid()))
  with check (exists (select 1 from public.mtg_binders where mtg_binders.id = mtg_binder_cards.binder_id and mtg_binders.user_id = auth.uid()));

create index mtg_binder_cards_binder_id_idx on public.mtg_binder_cards (binder_id);

-- Decks get the same labels + cover treatment as binders, for visual
-- consistency across the TCG My Collection hub tabs.
alter table public.mtg_decks add column if not exists labels jsonb default '[]'::jsonb;
alter table public.mtg_decks add column if not exists cover_image_url text;

-- Cover photo storage for binders/set lists/decks — identical pattern
-- to the avatars bucket above (public read, write scoped to the
-- uploader's own user-id folder).
insert into storage.buckets (id, name, public)
values ('mtg-covers', 'mtg-covers', true)
on conflict (id) do nothing;

create policy "MTG cover images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'mtg-covers');

create policy "Users can upload their own MTG cover images"
  on storage.objects for insert
  with check (bucket_id = 'mtg-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own MTG cover images"
  on storage.objects for update
  using (bucket_id = 'mtg-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own MTG cover images"
  on storage.objects for delete
  using (bucket_id = 'mtg-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Game Mastery Score ----------
-- Cross-platform "Gamerscore equivalent". Steam's half is fully real
-- and live-computed (unlocked achievements + Steam's own global
-- unlock-percent rarity, via the existing ISteamUserStats endpoints —
-- see lib/steam.js). Xbox and PlayStation have no public API for a
-- person's own earned achievements/trophies at all (see
-- AccountLinkingPage.jsx's honest "not available" listing for both),
-- so their inputs are real numbers the person types in themselves —
-- self-reported, not scraped, and labeled as such in the UI. See
-- lib/gameMastery.js for the pure scoring math and
-- lib/gameMasteryData.js for how these inputs get combined.
create table public.mastery_inputs (
  user_id uuid references auth.users on delete cascade primary key,
  xbox_gamerscore integer,
  xbox_updated_at timestamptz,
  -- { bronze: {common,rare,very_rare,ultra_rare}, silver: {...}, gold: {...}, platinum: {...} },
  -- each a real trophy count the person read off their own PSN trophy
  -- case (Sony's own trophy UI already breaks trophies down exactly
  -- this way by tier x rarity).
  ps_trophy_counts jsonb,
  ps_updated_at timestamptz,
  updated_at timestamptz default now()
);

alter table public.mastery_inputs enable row level security;

create policy "Users can manage their own mastery inputs"
  on public.mastery_inputs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Cached result on the profile, same pattern as gd_score — recomputed
-- (see lib/gameMasteryData.js's recomputeMastery) whenever a linked
-- platform's data changes, not on every page load.
alter table public.profiles add column if not exists mastery_score numeric default 0;
alter table public.profiles add column if not exists mastery_xp integer default 0;
alter table public.profiles add column if not exists mastery_level integer default 0;
-- Per-platform breakdown for the UI: raw score, normalized score,
-- data source, and "as of" time per linked platform — never just the
-- final number with no way to see where it came from.
alter table public.profiles add column if not exists mastery_breakdown jsonb;
alter table public.profiles add column if not exists mastery_computed_at timestamptz;

-- ============================================================
-- Social: friend codes, friends, and Guild privacy/invites/join
-- requests/codes.
--
-- Design notes:
--   - Friends are mutual (request -> accept), same model as Discord/
--     Steam, not a one-way follow. Stored as two symmetric rows in
--     `friends` (one per direction) so "who are my friends" is a
--     single flat query either direction.
--   - Guilds can be public (browsable, joinable by REQUEST that the
--     owner approves) or private (hidden from browsing, joinable only
--     by direct invite from an existing member, or by entering the
--     guild's own unique code). A guild code is effectively an invite
--     link substitute — knowing it is enough to join immediately.
--   - The plain client-side "insert yourself into guild_members"
--     policy that existed before this migration was WIDE OPEN (any
--     signed-in user could join literally any guild with no gating at
--     all) — that's tightened here to only two directly-RLS-provable
--     cases (you created the guild; you have an accepted invite).
--     Code-based joins and request-approval both need to insert a
--     membership row on behalf of a DIFFERENT decision (a code
--     matching, or an owner's approval) that plain per-row RLS can't
--     express cleanly, so those go through small SECURITY DEFINER
--     functions below — same pattern this file already uses for
--     handle_new_user(), each one narrowly scoped and re-checking
--     auth.uid() itself rather than trusting the caller.
--   - Friend-code lookup ("find this user by their code") deliberately
--     does NOT relax the profiles SELECT policy (auth.uid() = id) —
--     that would leak xbxprices_key/platprices_key/profile_details
--     (which holds a phone number) to anyone who can guess a code.
--     Instead, find_user_by_friend_code() is a SECURITY DEFINER
--     function that returns only a safe, minimal column subset.
-- ============================================================

-- ---------- Shared short-code generator ----------
-- Used for both a user's own friend code and a guild's join code —
-- same format, different prefix. Not guaranteed globally unique on
-- its own; every call site loops until a real uniqueness check passes.
create or replace function public.generate_short_code(p_prefix text)
returns text as $$
begin
  return p_prefix || '-' ||
    upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
    upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
end;
$$ language plpgsql set search_path = public;

-- ---------- profiles: friend_code ----------
alter table public.profiles add column if not exists friend_code text unique;

-- Backfill real codes for any profile that predates this column
-- (existing real accounts) — additive, touches nothing else.
do $$
declare
  r record;
  v_code text;
begin
  for r in select id from public.profiles where friend_code is null loop
    loop
      v_code := public.generate_short_code('LYK');
      exit when not exists (select 1 from public.profiles where friend_code = v_code);
    end loop;
    update public.profiles set friend_code = v_code where id = r.id;
  end loop;
end $$;

-- New signups now get a real code at the same time their blank
-- profile row is created, instead of the hardcoded placeholder the
-- UI used to show.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_code text;
begin
  loop
    v_code := public.generate_short_code('LYK');
    exit when not exists (select 1 from public.profiles where friend_code = v_code);
  end loop;
  insert into public.profiles (id, friend_code) values (new.id, v_code);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Safe, minimal lookup for "add a friend by their code" — never
-- exposes API keys, phone number, or anything else profiles holds.
create or replace function public.find_user_by_friend_code(p_code text)
returns table(id uuid, username text, first_name text, last_name text, avatar_url text) as $$
  select id, username, first_name, last_name, avatar_url
  from public.profiles
  where friend_code = upper(trim(p_code));
$$ language sql security definer set search_path = public;

-- ---------- Friends (mutual) ----------
create table public.friends (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  friend_id uuid references auth.users on delete cascade not null,
  created_at timestamptz default now(),
  unique (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table public.friends enable row level security;

create policy "Users can view their own friend list"
  on public.friends for select
  using (auth.uid() = user_id);

-- Either side of a friendship can remove either of the two symmetric
-- rows — an unfriend shouldn't need the other person's cooperation.
create policy "Either side can remove a friendship"
  on public.friends for delete
  using (auth.uid() = user_id or auth.uid() = friend_id);

create index friends_user_id_idx on public.friends (user_id);

create table public.friend_requests (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references auth.users on delete cascade not null,
  receiver_id uuid references auth.users on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now(),
  responded_at timestamptz,
  unique (sender_id, receiver_id),
  check (sender_id <> receiver_id)
);

alter table public.friend_requests enable row level security;

create policy "Sender and receiver can view a friend request"
  on public.friend_requests for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- status is forced to 'pending' here so a client can't insert a
-- pre-approved request for themselves.
create policy "Users can send a friend request"
  on public.friend_requests for insert
  with check (auth.uid() = sender_id and status = 'pending');

-- The receiver can decline directly (a plain status flip, no other
-- side effect); accepting goes through accept_friend_request() below
-- since it also has to write the other person's friends row.
create policy "Receiver can decline a friend request"
  on public.friend_requests for update
  using (auth.uid() = receiver_id and status = 'pending')
  with check (status = 'declined');

-- The sender can delete their own pending/declined request to retry
-- later (the unique constraint would otherwise block a resend).
create policy "Sender can withdraw their own request"
  on public.friend_requests for delete
  using (auth.uid() = sender_id);

create index friend_requests_receiver_id_idx on public.friend_requests (receiver_id);

-- Accept path: verifies the caller is really the invited recipient,
-- then writes both symmetric friends rows in one trusted step —
-- plain RLS can't let the receiver insert a row "on behalf of" the
-- sender, which is exactly what the reverse-direction row is.
create or replace function public.accept_friend_request(p_request_id uuid)
returns void as $$
declare
  v_sender uuid;
  v_receiver uuid;
begin
  select sender_id, receiver_id into v_sender, v_receiver
  from public.friend_requests
  where id = p_request_id and status = 'pending';

  if v_sender is null then
    raise exception 'Friend request not found or already handled';
  end if;

  if auth.uid() is distinct from v_receiver then
    raise exception 'Only the recipient can accept this request';
  end if;

  update public.friend_requests set status = 'accepted', responded_at = now() where id = p_request_id;

  insert into public.friends (user_id, friend_id) values (v_sender, v_receiver) on conflict do nothing;
  insert into public.friends (user_id, friend_id) values (v_receiver, v_sender) on conflict do nothing;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------- Guilds: privacy + unique code ----------
alter table public.guilds add column if not exists is_private boolean not null default false;
alter table public.guilds add column if not exists code text unique;

do $$
declare
  r record;
  v_code text;
begin
  for r in select id from public.guilds where code is null loop
    loop
      v_code := public.generate_short_code('GLD');
      exit when not exists (select 1 from public.guilds where code = v_code);
    end loop;
    update public.guilds set code = v_code where id = r.id;
  end loop;
end $$;

create or replace function public.handle_new_guild()
returns trigger as $$
declare
  v_code text;
begin
  if new.code is null then
    loop
      v_code := public.generate_short_code('GLD');
      exit when not exists (select 1 from public.guilds where code = v_code);
    end loop;
    new.code := v_code;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_guild_created
  before insert on public.guilds
  for each row execute procedure public.handle_new_guild();

-- Recursion-safe helper functions for policies elsewhere in this
-- file that need to check guild ownership/membership. A policy that
-- queries guild_members (even indirectly — e.g. guilds' own policy
-- querying guild_members, which then needs guild_members' policy
-- evaluated, which queries guilds again...) causes Postgres error
-- 42P17 "infinite recursion detected in policy" — confirmed live via
-- a real end-to-end signup/guild-create test, not theoretical.
-- SECURITY DEFINER functions bypass RLS internally (same mechanism as
-- handle_new_user()), so routing these checks through them instead of
-- raw subqueries breaks the cycle. (has_pending_guild_invite and
-- has_accepted_guild_invite are defined further down, right after
-- guild_invites itself exists.)
create or replace function public.is_guild_member(p_guild_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.guild_members where guild_id = p_guild_id and user_id = p_user_id);
$$ language sql security definer set search_path = public stable;

create or replace function public.is_guild_owner(p_guild_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.guilds where id = p_guild_id and created_by = p_user_id);
$$ language sql security definer set search_path = public stable;

create or replace function public.guild_is_private(p_guild_id uuid)
returns boolean as $$
  select coalesce((select is_private from public.guilds where id = p_guild_id), false);
$$ language sql security definer set search_path = public stable;

-- ---------- guild_join_requests ----------
create table public.guild_join_requests (
  id uuid default gen_random_uuid() primary key,
  guild_id uuid references public.guilds on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz default now(),
  responded_at timestamptz,
  unique (guild_id, user_id)
);

alter table public.guild_join_requests enable row level security;

create policy "Requester and guild owner can view a join request"
  on public.guild_join_requests for select
  using (
    auth.uid() = user_id
    or public.is_guild_owner(guild_id, auth.uid())
  );

-- status forced to 'pending' — same reasoning as friend_requests above.
create policy "Users can request to join a guild"
  on public.guild_join_requests for insert
  with check (auth.uid() = user_id and status = 'pending');

create policy "Requester can withdraw their own request"
  on public.guild_join_requests for delete
  using (auth.uid() = user_id);

create index guild_join_requests_guild_id_idx on public.guild_join_requests (guild_id);

-- Approve/decline both go through here rather than a plain UPDATE
-- policy, since approving also has to insert a membership row for
-- someone who isn't the caller.
create or replace function public.respond_to_join_request(p_request_id uuid, p_approve boolean)
returns void as $$
declare
  v_guild_id uuid;
  v_user_id uuid;
  v_owner uuid;
begin
  select guild_id, user_id into v_guild_id, v_user_id
  from public.guild_join_requests
  where id = p_request_id and status = 'pending';

  if v_guild_id is null then
    raise exception 'Join request not found or already handled';
  end if;

  select created_by into v_owner from public.guilds where id = v_guild_id;
  if auth.uid() is distinct from v_owner then
    raise exception 'Only the guild owner can respond to join requests';
  end if;

  update public.guild_join_requests
  set status = case when p_approve then 'approved' else 'declined' end,
      responded_at = now()
  where id = p_request_id;

  if p_approve then
    insert into public.guild_members (guild_id, user_id)
    values (v_guild_id, v_user_id)
    on conflict (guild_id, user_id) do nothing;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Instant join for anyone who has the guild's real code — the code
-- itself is the authorization, same trust model as a Discord invite
-- link. Looks the guild up internally (bypassing the private-guild
-- browse restriction above on purpose: knowing the code is enough).
create or replace function public.join_guild_by_code(p_code text)
returns public.guilds as $$
declare
  v_guild public.guilds;
begin
  select * into v_guild from public.guilds where code = upper(trim(p_code));
  if v_guild.id is null then
    raise exception 'Invalid guild code';
  end if;

  insert into public.guild_members (guild_id, user_id)
  values (v_guild.id, auth.uid())
  on conflict (guild_id, user_id) do nothing;

  return v_guild;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------- guild_invites ----------
create table public.guild_invites (
  id uuid default gen_random_uuid() primary key,
  guild_id uuid references public.guilds on delete cascade not null,
  invited_user_id uuid references auth.users on delete cascade not null,
  invited_by uuid references auth.users on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now(),
  responded_at timestamptz,
  unique (guild_id, invited_user_id)
);

alter table public.guild_invites enable row level security;

create policy "Invited user, inviter, or guild owner can view an invite"
  on public.guild_invites for select
  using (
    auth.uid() = invited_user_id
    or auth.uid() = invited_by
    or public.is_guild_owner(guild_id, auth.uid())
  );

-- Only an existing member can invite someone else in, and only as
-- themselves (invited_by) — status forced to 'pending' at insert.
create policy "Existing members can invite someone to their guild"
  on public.guild_invites for insert
  with check (
    auth.uid() = invited_by
    and status = 'pending'
    and public.is_guild_member(guild_id, auth.uid())
  );

-- The invited person accepts/declines directly — no cross-user insert
-- needed here (unlike friend requests/join requests), since accepting
-- just flips this row's status; the actual guild_members insert is a
-- separate, self-only insert the invited user makes right after (see
-- lib/guilds.js acceptGuildInvite), already covered by the
-- guild_members INSERT policy above.
create policy "Invited user can accept or decline their own invite"
  on public.guild_invites for update
  using (auth.uid() = invited_user_id and status = 'pending')
  with check (status in ('accepted', 'declined'));

create policy "Inviter or guild owner can revoke a pending invite"
  on public.guild_invites for delete
  using (
    (auth.uid() = invited_by and status = 'pending')
    or public.is_guild_owner(guild_id, auth.uid())
  );

create index guild_invites_invited_user_id_idx on public.guild_invites (invited_user_id);
create index guild_invites_guild_id_idx on public.guild_invites (guild_id);

-- Batched version of find_user_by_friend_code's safe-subset pattern —
-- lets the UI render real names/avatars for a guild roster, pending
-- invites, or a friends list without broadening the profiles table's
-- own SELECT policy (which stays strictly self-only).
create or replace function public.get_public_profiles(p_ids uuid[])
returns table(id uuid, username text, first_name text, last_name text, avatar_url text) as $$
  select id, username, first_name, last_name, avatar_url
  from public.profiles
  where id = any(p_ids);
$$ language sql security definer set search_path = public;

-- ---------- guilds / guild_members / guild_invites / guild_join_requests:
-- privacy policies ----------
-- is_guild_member/is_guild_owner/guild_is_private are defined earlier
-- (right after guilds gains is_private/code); these last two need
-- guild_invites to exist first, so they're defined here instead.

create or replace function public.has_pending_guild_invite(p_guild_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.guild_invites where guild_id = p_guild_id and invited_user_id = p_user_id);
$$ language sql security definer set search_path = public stable;

create or replace function public.has_accepted_guild_invite(p_guild_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.guild_invites
    where guild_id = p_guild_id and invited_user_id = p_user_id and status = 'accepted'
  );
$$ language sql security definer set search_path = public stable;

-- Private guilds are hidden from browsing unless you're the creator,
-- an existing member, or someone with a pending invite — replaces the
-- old "any signed-in user can see every guild" policy.
drop policy if exists "Any signed-in user can browse guilds" on public.guilds;
drop policy if exists "Browse public guilds, or private ones you're connected to" on public.guilds;

create policy "Browse public guilds, or private ones you're connected to"
  on public.guilds for select
  using (
    auth.uid() is not null
    and (
      not is_private
      or created_by = auth.uid()
      or public.is_guild_member(id, auth.uid())
      or public.has_pending_guild_invite(id, auth.uid())
    )
  );

create policy "Only the creator can change privacy/name"
  on public.guilds for update
  using (auth.uid() = created_by);

-- Previously: anyone signed in could insert themselves into ANY
-- guild's membership, no gating at all. Now only two directly-provable
-- cases go through plain RLS (you created this guild; you have an
-- accepted invite) — join-by-code and approved join requests both
-- insert membership via the SECURITY DEFINER functions above instead,
-- since those depend on a decision (a code matching, an owner's
-- approval) plain per-row RLS can't express.
drop policy if exists "Users can join a guild themselves" on public.guild_members;
drop policy if exists "Join via creating the guild or an accepted invite" on public.guild_members;

create policy "Join via creating the guild or an accepted invite"
  on public.guild_members for insert
  with check (
    auth.uid() = user_id
    and (
      public.is_guild_owner(guild_id, auth.uid())
      or public.has_accepted_guild_invite(guild_id, auth.uid())
    )
  );

-- Rosters of private guilds are members-only; public guild rosters
-- stay visible to anyone signed in, same as before.
drop policy if exists "Any signed-in user can view guild rosters" on public.guild_members;
drop policy if exists "View rosters of public guilds, or private ones you're in" on public.guild_members;

create policy "View rosters of public guilds, or private ones you're in"
  on public.guild_members for select
  using (
    not public.guild_is_private(guild_id)
    or public.is_guild_member(guild_id, auth.uid())
  );

-- ---------- TCG price history ----------
-- Shared MTG price history — not personal data (it's a market price
-- for a card, same for everyone), so this is a shared table rather
-- than per-user: any signed-in user can read all history, and
-- inserting a snapshot just means "record the price I observed just
-- now" (fired when a user actually views a card's real price — see
-- lib/tcgPricing.js), not a privileged write.
create table public.tcg_price_snapshots (
  id uuid default gen_random_uuid() primary key,
  scryfall_id text not null,
  source text not null check (source in ('scryfall', 'cardkingdom')),
  market text,
  price numeric not null,
  foil boolean default false,
  currency text default 'USD',
  captured_at timestamptz default now()
);

alter table public.tcg_price_snapshots enable row level security;

create policy "Any signed-in user can view price history"
  on public.tcg_price_snapshots for select
  using (auth.role() = 'authenticated');

create policy "Any signed-in user can record a price observation"
  on public.tcg_price_snapshots for insert
  with check (auth.role() = 'authenticated');

create index tcg_price_snapshots_scryfall_id_idx on public.tcg_price_snapshots (scryfall_id, captured_at desc);

-- ---------- Books: TBR / lists / owned library ----------
-- Distinct from entertainment_entries (which already tracks a simple
-- want/watching/completed status for movies/TV/anime/books) — this is
-- specifically the barcode-scan -> TBR/owned/list flow, which needs
-- real multi-list membership entertainment_entries doesn't model.
create table public.user_books (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  isbn text,
  title text not null,
  author text,
  cover_url text,
  status text not null default 'tbr' check (status in ('tbr', 'reading', 'finished', 'owned')),
  source text default 'manual', -- 'manual' | 'barcode' | 'search'
  added_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_books enable row level security;

create policy "Users can manage their own books"
  on public.user_books for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index user_books_user_id_idx on public.user_books (user_id);

create table public.book_lists (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

alter table public.book_lists enable row level security;

create policy "Users can manage their own book lists"
  on public.book_lists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.book_list_items (
  id uuid default gen_random_uuid() primary key,
  list_id uuid references public.book_lists on delete cascade not null,
  book_id uuid references public.user_books on delete cascade not null,
  added_at timestamptz default now(),
  unique (list_id, book_id)
);

alter table public.book_list_items enable row level security;

-- Owned indirectly through the parent list, same pattern as
-- mtg_deck_cards -> mtg_decks.
create policy "Users can manage items in their own book lists"
  on public.book_list_items for all
  using (exists (select 1 from public.book_lists where book_lists.id = book_list_items.list_id and book_lists.user_id = auth.uid()))
  with check (exists (select 1 from public.book_lists where book_lists.id = book_list_items.list_id and book_lists.user_id = auth.uid()));

create index book_list_items_list_id_idx on public.book_list_items (list_id);

-- ---------- Comics: real user-owned issue library ----------
-- No external comics catalogue API is wired yet (Comic Vine's real
-- response shape couldn't be verified live from this environment —
-- its docs page is a JS app, not static docs, and no API key was
-- available to test a real call against — so rather than guess field
-- names the way this project got burned doing once before with
-- Fortnite pricing, this stays honestly manual-entry-only for now;
-- Comic Vine enrichment is a real, named next step once a key exists
-- to verify against, same as Rebrickable/Discogs/IGDB are documented
-- as real next phases for collectible_entries).
create table public.comic_issues (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  issue_number text,
  publisher text,
  cover_url text,
  condition text default 'Near Mint',
  status text not null default 'owned' check (status in ('owned', 'pull_list', 'wishlist')),
  notes text,
  added_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.comic_issues enable row level security;

create policy "Users can manage their own comic issues"
  on public.comic_issues for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index comic_issues_user_id_idx on public.comic_issues (user_id);

-- Cover photo storage for books/comics — identical pattern to the
-- avatars/mtg-covers buckets above.
insert into storage.buckets (id, name, public)
values ('entertainment-covers', 'entertainment-covers', true)
on conflict (id) do nothing;

create policy "Entertainment cover images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'entertainment-covers');

create policy "Users can upload their own entertainment cover images"
  on storage.objects for insert
  with check (bucket_id = 'entertainment-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own entertainment cover images"
  on storage.objects for update
  using (bucket_id = 'entertainment-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own entertainment cover images"
  on storage.objects for delete
  using (bucket_id = 'entertainment-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Appearance: site wallpaper (additive) ----------
-- wallpaper_url: an uploaded background image shown site-wide behind
-- a dark scrim (see Account Settings > Appearance). college_theme is
-- reserved for a real next step (optional per-College accent/wallpaper
-- overrides) — the column exists so it can be filled in later without
-- another migration, but no UI writes to it yet, so it stays honestly
-- unused rather than half-wired.
alter table public.profiles add column if not exists wallpaper_url text;
alter table public.profiles add column if not exists college_theme jsonb default '{}'::jsonb;

-- Wallpaper image storage — identical pattern to the avatars/mtg-covers/
-- entertainment-covers buckets above.
insert into storage.buckets (id, name, public)
values ('wallpapers', 'wallpapers', true)
on conflict (id) do nothing;

create policy "Wallpaper images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'wallpapers');

create policy "Users can upload their own wallpaper"
  on storage.objects for insert
  with check (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own wallpaper"
  on storage.objects for update
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own wallpaper"
  on storage.objects for delete
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Gaming: Xbox/PlayStation achievement tracker (additive) ----------
-- Steam achievements are fully real and automatic (GetSchemaForGame +
-- GetPlayerAchievements, see lib/steam.js) so they're never stored here
-- — the Steam half of the Achievements page is a live view, not data
-- this app owns. Xbox and PlayStation have no public API for a user's
-- own achievement/trophy list at all (same gap mastery_inputs already
-- works around with self-reported aggregate numbers), so this is a
-- genuine manual tracker: the person types in the achievement/trophy
-- names themselves and ticks them off as they earn them. game_name is
-- free text rather than a foreign key to a games table, same honest
-- simplification platform_playtime already uses for these two
-- platforms — there's no stable, app-wide ID system for Xbox/PS games
-- here to hang a real foreign key off of.
create table public.platform_achievements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  platform text not null check (platform in ('xbox', 'playstation')),
  game_name text not null,
  achievement_name text not null,
  description text,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  added_at timestamptz default now(),
  unique (user_id, platform, game_name, achievement_name)
);

alter table public.platform_achievements enable row level security;

create policy "Users can manage their own platform achievements"
  on public.platform_achievements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index platform_achievements_user_id_idx on public.platform_achievements (user_id);

-- ---------- Collectibles: cover images + Funko/barcode provenance (additive) ----------
-- collectible_entries had no image column at all before this. A Funko
-- catalog match stores the catalog's own real hosted image URL
-- directly (same precedent as user_books.cover_url from Open Library
-- -- no re-upload needed); a barcode scan with no catalog match, or a
-- plain manual add, can use the new collectible-covers bucket below
-- for a user-uploaded photo instead.
alter table public.collectible_entries add column if not exists cover_image_url text;

-- 'funko' = matched against the real open Funko Pop catalog by name/
-- series search. 'upc' = matched via a generic public UPC/barcode
-- product database off a scanned barcode -- lower confidence than a
-- catalog hit (generic retail data, not Funko-specific), but still a
-- real external source, not invented.
alter table public.collectible_entries drop constraint collectible_entries_source_check;
alter table public.collectible_entries add constraint collectible_entries_source_check
  check (source in ('user', 'rebrickable', 'brickset', 'discogs', 'igdb', 'amiiboapi', 'funko', 'upc'));

-- Cover photo storage for collectibles -- identical pattern to the
-- avatars/mtg-covers/entertainment-covers buckets above.
insert into storage.buckets (id, name, public)
values ('collectible-covers', 'collectible-covers', true)
on conflict (id) do nothing;

create policy "Collectible cover images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'collectible-covers');

create policy "Users can upload their own collectible cover images"
  on storage.objects for insert
  with check (bucket_id = 'collectible-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own collectible cover images"
  on storage.objects for update
  using (bucket_id = 'collectible-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own collectible cover images"
  on storage.objects for delete
  using (bucket_id = 'collectible-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Overall Mastery Score (additive) ----------
-- Combines a real score from each of the 5 Colleges into one number,
-- shown in the header (see lib/overallMastery.js for the math,
-- lib/overallMasteryData.js for gathering the real per-College
-- inputs). Deliberately separate from mastery_score/mastery_level
-- above -- those stay Gaming-only internally (user-facing label
-- renamed to "Gaming Mastery" to disambiguate) and are reused
-- directly as this score's Gaming input, not duplicated or
-- recomputed differently.
alter table public.profiles add column if not exists overall_mastery_score numeric default 0;
alter table public.profiles add column if not exists overall_mastery_xp integer default 0;
alter table public.profiles add column if not exists overall_mastery_level integer default 0;
alter table public.profiles add column if not exists overall_mastery_breakdown jsonb;
alter table public.profiles add column if not exists overall_mastery_computed_at timestamptz;

-- ---------- Self-reported platform handles (additive) ----------
-- Xbox/PlayStation/Nintendo have no public API for a person's own
-- library/achievements/trophies at all — confirmed while building
-- Account Linking. Rather than a dead "not available" row, each gets
-- a real self-reported handle field (their actual Gamertag/Online ID/
-- Friend Code) — honest reference info the person saves themselves,
-- never presented as verified or live-synced. The scored numbers
-- (Gamerscore, PS trophy counts) already live in mastery_inputs —
-- these are separate, purely for display/reference.
alter table public.profiles add column if not exists xbox_gamertag text;
alter table public.profiles add column if not exists playstation_online_id text;
alter table public.profiles add column if not exists nintendo_friend_code text;
alter table public.profiles add column if not exists nintendo_username text;

-- ---------- Guild customization: logo, banner, description (additive) ----------
-- Same real-upload pattern as avatars/wallpapers above — a public
-- bucket, folder-per-guild (guild_id as the top-level folder), writes
-- restricted to the guild's creator via a subquery against guilds
-- rather than a plain foldername-equals-uid check (there's no single
-- "owning user id" folder here — it's owning-guild scoped instead).
alter table public.guilds add column if not exists logo_url text;
alter table public.guilds add column if not exists banner_url text;
alter table public.guilds add column if not exists description text;

insert into storage.buckets (id, name, public)
values ('guild-media', 'guild-media', true)
on conflict (id) do nothing;

create policy "Guild media is publicly viewable"
  on storage.objects for select
  using (bucket_id = 'guild-media');

-- NOTE: the three policies below reference storage.objects.name
-- explicitly, not just "name" — an earlier version of this migration
-- wrote a bare "name" inside a subquery that also selects FROM
-- guilds, and since guilds has its own "name" column, Postgres bound
-- the unqualified reference to guilds.name (the guild's own display
-- name) instead of the outer storage.objects row being inserted. That
-- made the EXISTS check always false, so every real logo/banner
-- upload failed with an RLS violation — caught and fixed live while
-- verifying this feature, corrected here so this file matches what's
-- actually deployed.
create policy "Guild owners can upload guild media"
  on storage.objects for insert
  with check (
    bucket_id = 'guild-media'
    and exists (select 1 from public.guilds where guilds.id::text = (storage.foldername(storage.objects.name))[1] and guilds.created_by = auth.uid())
  );

create policy "Guild owners can update guild media"
  on storage.objects for update
  using (
    bucket_id = 'guild-media'
    and exists (select 1 from public.guilds where guilds.id::text = (storage.foldername(storage.objects.name))[1] and guilds.created_by = auth.uid())
  );

create policy "Guild owners can delete guild media"
  on storage.objects for delete
  using (
    bucket_id = 'guild-media'
    and exists (select 1 from public.guilds where guilds.id::text = (storage.foldername(storage.objects.name))[1] and guilds.created_by = auth.uid())
  );

-- ---------- Wishlist duplicate fix ----------
-- Real bug: addToWishlist() in AppContext.jsx fired an unconditional
-- Supabase insert on every call regardless of whether its own local
-- dedup check found the title already present, and importSteamWishlist
-- (used by both the initial Steam link AND the "Resync Steam wishlist"
-- button) calls addToWishlist for every item on every run with no
-- existing-item check. Confirmed live: 568 rows for only 161 real
-- unique (user_id, title) pairs — every resync had been re-inserting
-- the whole wishlist as fresh duplicate rows. Cleaned up the existing
-- duplicates (kept the earliest real added_at per pair) and added a
-- real DB-level constraint so it can't happen again regardless of what
-- the client does — insertWishlistItem (lib/userData.js) now upserts
-- against this constraint with ignoreDuplicates instead of a plain
-- insert, and addToWishlist only calls it when genuinely new.
with ranked as (
  select id, row_number() over (
    partition by user_id, title order by added_at asc, id asc
  ) as rn
  from public.wishlist_items
)
delete from public.wishlist_items where id in (select id from ranked where rn > 1);

alter table public.wishlist_items add constraint wishlist_items_user_title_unique unique (user_id, title);

-- ---------- Backlog: which platform (additive) ----------
-- Which real platform the person picked when adding this game — see
-- BacklogPage.jsx's search redesign. Self-selected from RAWG's own
-- real per-game platform list (lib/rawg.js searchRawgGames), not
-- guessed or defaulted silently. Nullable: existing rows and anything
-- added before this feature just don't have one, same honest-gap
-- pattern as steam_appid/hours_estimate above.
alter table public.backlog_items add column if not exists platform text;

-- ---------- Marketplace: TCG + Collectibles (additive) ----------
-- One real table shared by both Colleges (category column), not two
-- duplicated schemas — each College's UI only ever queries its own
-- category, so they stay honestly separate to the person using the
-- app. No FK to mtg_collection/collectible_entries: a listing is
-- freeform (title/description/price/condition/photo), not required
-- to correspond to a tracked collection row — an optional "link to my
-- collection" convenience is a natural later addition, not v1.
-- condition is plain nullable text, not a check-constrained enum,
-- since TCG and Collectibles use two different real condition scales
-- (NM/LP/MP/HP/Damaged vs Mint/Near Mint/Good/Fair/Poor) and neither
-- should be forced to fit the other's rigid list.
--
-- RLS here deliberately needs no cross-table check (auth.uid() =
-- user_id is sufficient for all CRUD), so this doesn't risk the real
-- Postgres 42P17 "infinite recursion detected in policy" bug this
-- project hit before with guild_join_requests (a policy subquerying a
-- table whose own policy subqueries back) — noted here so that trap
-- isn't reintroduced if a "buyer can mark as sold" flow gets added
-- later.
create table public.marketplace_listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null check (category in ('tcg', 'collectibles')),
  title text not null,
  description text,
  price numeric not null check (price >= 0),
  currency text not null default 'USD',
  condition text,
  photo_url text,
  status text not null default 'active' check (status in ('active', 'sold', 'removed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.marketplace_listings enable row level security;

create policy "Anyone signed in can browse active listings"
  on public.marketplace_listings for select
  using (status = 'active' or auth.uid() = user_id);

create policy "Sellers manage their own listings"
  on public.marketplace_listings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index marketplace_listings_category_idx on public.marketplace_listings (category, status, created_at desc);

-- Real upload pattern, identical to avatars/wallpapers/guild-media/
-- collectible-covers above: public bucket, writes scoped to the
-- uploader's own ${user_id}/ folder.
insert into storage.buckets (id, name, public)
values ('marketplace-photos', 'marketplace-photos', true)
on conflict (id) do nothing;

create policy "Marketplace photos are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'marketplace-photos');

create policy "Users can upload their own marketplace photos"
  on storage.objects for insert
  with check (bucket_id = 'marketplace-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own marketplace photos"
  on storage.objects for update
  using (bucket_id = 'marketplace-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own marketplace photos"
  on storage.objects for delete
  using (bucket_id = 'marketplace-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Guild social feed + official guilds (additive) ----------
-- Real Reddit-like posts within a Guild: members post (title/body/
-- optional image), other members upvote/downvote and comment.
-- guild_posts has guild_id directly so its own RLS reuses the
-- existing is_guild_member() SECURITY DEFINER helper exactly like
-- guild_activity already does. Votes/comments only carry post_id, not
-- guild_id, so is_guild_post_member() below routes that lookup
-- through one more SECURITY DEFINER function rather than a raw
-- subquery into guild_posts from two different tables — keeps the
-- same "never let two RLS-protected tables' policies query each
-- other" discipline this project adopted after hitting a real
-- Postgres 42P17 infinite-recursion error with guild_join_requests.
create table public.guild_posts (
  id uuid default gen_random_uuid() primary key,
  guild_id uuid references public.guilds on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  body text,
  image_url text,
  created_at timestamptz default now()
);

create table public.guild_post_votes (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.guild_posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

create table public.guild_post_comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.guild_posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

create index guild_posts_guild_id_idx on public.guild_posts (guild_id, created_at desc);
create index guild_post_votes_post_id_idx on public.guild_post_votes (post_id);
create index guild_post_comments_post_id_idx on public.guild_post_comments (post_id, created_at asc);

alter table public.guild_posts enable row level security;

create policy "Guild members can view their guild's posts"
  on public.guild_posts for select
  using (public.is_guild_member(guild_id, auth.uid()));

create policy "Guild members can post to their guild"
  on public.guild_posts for insert
  with check (auth.uid() = user_id and public.is_guild_member(guild_id, auth.uid()));

create policy "Authors can delete their own posts"
  on public.guild_posts for delete
  using (auth.uid() = user_id);

create or replace function public.is_guild_post_member(p_post_id uuid, p_user_id uuid)
returns boolean as $$
  select public.is_guild_member(guild_id, p_user_id) from public.guild_posts where id = p_post_id;
$$ language sql security definer set search_path = public stable;

alter table public.guild_post_votes enable row level security;

create policy "Guild members can view votes"
  on public.guild_post_votes for select
  using (public.is_guild_post_member(post_id, auth.uid()));

create policy "Guild members can vote"
  on public.guild_post_votes for insert
  with check (auth.uid() = user_id and public.is_guild_post_member(post_id, auth.uid()));

create policy "Users can change their own vote"
  on public.guild_post_votes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can remove their own vote"
  on public.guild_post_votes for delete
  using (auth.uid() = user_id);

alter table public.guild_post_comments enable row level security;

create policy "Guild members can view comments"
  on public.guild_post_comments for select
  using (public.is_guild_post_member(post_id, auth.uid()));

create policy "Guild members can comment"
  on public.guild_post_comments for insert
  with check (auth.uid() = user_id and public.is_guild_post_member(post_id, auth.uid()));

create policy "Authors can delete their own comments"
  on public.guild_post_comments for delete
  using (auth.uid() = user_id);

-- Real upload pattern, identical to every other bucket in this file:
-- public read, writes scoped to the uploader's own ${user_id}/ folder
-- (a post image belongs to whoever posted it, not the guild itself,
-- so this is simpler than guild-media's guild-id scoping).
insert into storage.buckets (id, name, public)
values ('guild-post-images', 'guild-post-images', true)
on conflict (id) do nothing;

create policy "Guild post images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'guild-post-images');

create policy "Users can upload their own guild post images"
  on storage.objects for insert
  with check (bucket_id = 'guild-post-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own guild post images"
  on storage.objects for delete
  using (bucket_id = 'guild-post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Official guilds: is_official flag + 5 seeded guilds ----------
-- Purely a display flag ("Official Lykodex Guild" badge) - not a new
-- security mechanism. created_by for the 5 seeded guilds below is set
-- to the real Lykodex admin account, so every existing owner-only path
-- (logo/banner/description editing, privacy toggle, approving join
-- requests) already just works for them with zero new RLS. Regular
-- users can never set is_official themselves since createGuild()'s
-- insert never touches this column, so it always lands as the
-- default false.
alter table public.guilds add column if not exists is_official boolean not null default false;

insert into public.guilds (name, created_by, is_private, is_official, description)
select v.name, u.id, false, true, v.description
from (values
  ('Lykodex Gaming', 'The official Lykodex guild for everything Gaming.'),
  ('Lykodex TCG', 'The official Lykodex guild for Magic and other TCGs.'),
  ('Lykodex Entertainment', 'The official Lykodex guild for movies, TV, anime, and books.'),
  ('Lykodex Collectibles', 'The official Lykodex guild for Pops, statues, LEGO, and more.'),
  ('Lykodex Tabletop', 'The official Lykodex guild for RPGs and tabletop wargaming.')
) as v(name, description)
cross join (select id from auth.users where email = 'joshuakingsworth@gmail.com') as u
where not exists (select 1 from public.guilds where name = v.name);

-- ---------- TCG: Flesh and Blood (Phase 1 — collection only) ----------
-- Real card data via goagain.dev's live, keyless FaB API (see
-- lib/fab.js). Small third-party maintainer, no documented uptime or
-- rate-limit SLA — accepted risk, mitigated by client-side caching and
-- a defensive upstream timeout in api/fab.js.
--
-- fab_card_id stores goagain's Card.unique_id (one name+pitch variant).
-- printing_unique_id stores the PRINTING's own unique_id (confirmed
-- live via curl to be distinct from the card's id) — the real "which
-- exact printing is owned" identifier. foiling stores goagain's real
-- per-printing finish code ("S"/"R"/"C" confirmed live = Standard/
-- Rainbow Foil/Cold Foil) — genuine API data, not self-reported the
-- way mtg_collection.foil effectively is.
create table public.fab_collection (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  fab_card_id text not null,
  card_name text not null,
  printing_unique_id text,
  set_id text,
  edition text,
  foiling text,
  quantity integer default 1,
  condition text default 'Near Mint',
  source text default 'manual',
  added_at timestamptz default now()
);

alter table public.fab_collection enable row level security;

create policy "Users can view their own FaB collection"
  on public.fab_collection for select using (auth.uid() = user_id);
create policy "Users can add to their own FaB collection"
  on public.fab_collection for insert with check (auth.uid() = user_id);
create policy "Users can update their own FaB collection"
  on public.fab_collection for update using (auth.uid() = user_id);
create policy "Users can remove from their own FaB collection"
  on public.fab_collection for delete using (auth.uid() = user_id);

create index fab_collection_user_id_idx on public.fab_collection (user_id);

-- guild_activity CHECK constraints can't add a value in place — drop/recreate.
-- Current (verified live): 'achievement_unlocked', 'gd_score_milestone',
-- 'backlog_status_change', 'wishlist_added', 'mtg_card_added', 'joined_guild'.
alter table public.guild_activity drop constraint if exists guild_activity_event_type_check;
alter table public.guild_activity add constraint guild_activity_event_type_check
  check (event_type in (
    'achievement_unlocked', 'gd_score_milestone', 'backlog_status_change',
    'wishlist_added', 'mtg_card_added', 'fab_card_added', 'joined_guild'
  ));

-- ---------- TCG: Flesh and Blood (Phase 3 — decks) ----------
-- Every real FaB constructed format goagain exposes legality flags for
-- (blitz/cc/commoner/ll/silver_age/upf) is built around exactly one
-- Hero card — unlike MTG where only Commander/Brawl need one.
-- hero_card_id/name are nullable at the DB level (a row can exist
-- mid-creation) but the UI's create-deck flow requires picking one
-- before the deck is usable. No is_sideboard column here — FaB
-- constructed play has no confirmed equivalent to MTG's sideboarding.
create table public.fab_decks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  format text not null default 'blitz' check (format in ('blitz', 'cc', 'commoner', 'll', 'silver_age', 'upf')),
  hero_card_id text,
  hero_card_name text,
  description text,
  labels jsonb default '[]'::jsonb,
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.fab_decks enable row level security;

create policy "Users can manage their own FaB decks"
  on public.fab_decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.fab_deck_cards (
  id uuid default gen_random_uuid() primary key,
  deck_id uuid references public.fab_decks on delete cascade not null,
  fab_card_id text not null,
  card_name text not null,
  quantity integer default 1
);

alter table public.fab_deck_cards enable row level security;

create policy "Users can manage cards in their own FaB decks"
  on public.fab_deck_cards for all
  using (exists (select 1 from public.fab_decks where fab_decks.id = fab_deck_cards.deck_id and fab_decks.user_id = auth.uid()))
  with check (exists (select 1 from public.fab_decks where fab_decks.id = fab_deck_cards.deck_id and fab_decks.user_id = auth.uid()));

create index fab_deck_cards_deck_id_idx on public.fab_deck_cards (deck_id);

-- ---------- TCG: Flesh and Blood (Phase 4 — binders) ----------
-- Only the "binder" kind is used for now — kind is still a real
-- column (matching mtg_binders' shape) so "set_list" can be enabled
-- later without a schema change, but the UI doesn't offer it today:
-- goagain.dev's `set` search filter was tested live and does NOT
-- actually scope results (type=Hero correctly narrows 4897 cards to
-- 150; set=WTR returns 862 with duplicate entries) — building a set
-- checklist on a broken filter isn't honest, so it's on hold.
create table public.fab_binders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  labels jsonb default '[]'::jsonb,
  cover_image_url text,
  kind text not null default 'binder' check (kind in ('binder', 'set_list')),
  fab_set_id text,
  fab_set_name text,
  fab_set_icon_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.fab_binders enable row level security;

create policy "Users can manage their own FaB binders"
  on public.fab_binders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index fab_binders_user_id_idx on public.fab_binders (user_id);

create table public.fab_binder_cards (
  id uuid default gen_random_uuid() primary key,
  binder_id uuid references public.fab_binders on delete cascade not null,
  fab_card_id text not null,
  card_name text not null,
  set_id text,
  edition text,
  foiling text,
  quantity integer not null default 1,
  condition text default 'Near Mint',
  source text default 'manual',
  added_at timestamptz default now(),
  printing_unique_id text,
  unique (binder_id, fab_card_id, printing_unique_id)
);

alter table public.fab_binder_cards enable row level security;

create policy "Users can manage cards in their own FaB binders"
  on public.fab_binder_cards for all
  using (exists (select 1 from public.fab_binders where fab_binders.id = fab_binder_cards.binder_id and fab_binders.user_id = auth.uid()))
  with check (exists (select 1 from public.fab_binders where fab_binders.id = fab_binder_cards.binder_id and fab_binders.user_id = auth.uid()));

create index fab_binder_cards_binder_id_idx on public.fab_binder_cards (binder_id);

insert into storage.buckets (id, name, public) values ('fab-covers', 'fab-covers', true) on conflict (id) do nothing;

create policy "FaB cover images are publicly viewable" on storage.objects for select using (bucket_id = 'fab-covers');
create policy "Users can upload their own FaB cover images" on storage.objects for insert with check (bucket_id = 'fab-covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update their own FaB cover images" on storage.objects for update using (bucket_id = 'fab-covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete their own FaB cover images" on storage.objects for delete using (bucket_id = 'fab-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Marketplace: FaB alongside MTG (additive) ----------
-- game is nullable and only meaningful when category = 'tcg' — a
-- Collectibles listing has no game. Existing tcg listings all predate
-- this feature and are genuinely all MTG, so they're backfilled
-- rather than left honestly-but-uselessly blank.
alter table public.marketplace_listings add column if not exists game text check (game is null or game in ('mtg', 'fab'));
update public.marketplace_listings set game = 'mtg' where category = 'tcg' and game is null;
create index if not exists marketplace_listings_category_game_idx on public.marketplace_listings (category, game, status, created_at desc);

-- ---------- TCG: Pokémon (additive) ----------
-- Real card data via pokemontcg.io's live, keyless (or optionally
-- keyed for a higher quota) API — see lib/pokemon.js. card.id (e.g.
-- "sv1-8") already identifies one specific real printing directly,
-- unlike Flesh and Blood's card-vs-printing split. finish is a real
-- variant key taken from that card's own tcgplayer.prices (e.g.
-- "reverseHolofoil"), not a fabricated fixed enum.
create table public.pokemon_collection (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  pokemon_card_id text not null,
  card_name text not null,
  set_id text,
  finish text,
  quantity integer default 1,
  condition text default 'Near Mint',
  source text default 'manual',
  added_at timestamptz default now()
);
alter table public.pokemon_collection enable row level security;
create policy "Users can view their own Pokémon collection" on public.pokemon_collection for select using (auth.uid() = user_id);
create policy "Users can add to their own Pokémon collection" on public.pokemon_collection for insert with check (auth.uid() = user_id);
create policy "Users can update their own Pokémon collection" on public.pokemon_collection for update using (auth.uid() = user_id);
create policy "Users can remove from their own Pokémon collection" on public.pokemon_collection for delete using (auth.uid() = user_id);
create index pokemon_collection_user_id_idx on public.pokemon_collection (user_id);

-- Real format legalities confirmed live: {standard, expanded, unlimited},
-- values capitalized "Legal" (not Scryfall's lowercase "legal") — see
-- lib/pokemonCollection.js's checkPokemonDeckLegality. No Hero-anchor
-- concept (unlike Flesh and Blood) and no sideboard.
create table public.pokemon_decks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  format text not null default 'standard' check (format in ('standard', 'expanded', 'unlimited')),
  description text,
  labels jsonb default '[]'::jsonb,
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.pokemon_decks enable row level security;
create policy "Users can manage their own Pokémon decks" on public.pokemon_decks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.pokemon_deck_cards (
  id uuid default gen_random_uuid() primary key,
  deck_id uuid references public.pokemon_decks on delete cascade not null,
  pokemon_card_id text not null,
  card_name text not null,
  quantity integer default 1
);
alter table public.pokemon_deck_cards enable row level security;
create policy "Users can manage cards in their own Pokémon decks" on public.pokemon_deck_cards for all
  using (exists (select 1 from public.pokemon_decks where pokemon_decks.id = pokemon_deck_cards.deck_id and pokemon_decks.user_id = auth.uid()))
  with check (exists (select 1 from public.pokemon_decks where pokemon_decks.id = pokemon_deck_cards.deck_id and pokemon_decks.user_id = auth.uid()));
create index pokemon_deck_cards_deck_id_idx on public.pokemon_deck_cards (deck_id);

-- Set Lists ARE built for Pokémon (unlike Flesh and Blood) — confirmed
-- live that pokemontcg.io's set.id filter genuinely scopes correctly
-- (matched a set's own real total card count).
create table public.pokemon_binders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  labels jsonb default '[]'::jsonb,
  cover_image_url text,
  kind text not null default 'binder' check (kind in ('binder', 'set_list')),
  pokemon_set_id text,
  pokemon_set_name text,
  pokemon_set_icon_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.pokemon_binders enable row level security;
create policy "Users can manage their own Pokémon binders" on public.pokemon_binders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index pokemon_binders_user_id_idx on public.pokemon_binders (user_id);

create table public.pokemon_binder_cards (
  id uuid default gen_random_uuid() primary key,
  binder_id uuid references public.pokemon_binders on delete cascade not null,
  pokemon_card_id text not null,
  card_name text not null,
  set_id text,
  finish text,
  quantity integer not null default 1,
  condition text default 'Near Mint',
  source text default 'manual',
  added_at timestamptz default now(),
  unique (binder_id, pokemon_card_id, finish)
);
alter table public.pokemon_binder_cards enable row level security;
create policy "Users can manage cards in their own Pokémon binders" on public.pokemon_binder_cards for all
  using (exists (select 1 from public.pokemon_binders where pokemon_binders.id = pokemon_binder_cards.binder_id and pokemon_binders.user_id = auth.uid()))
  with check (exists (select 1 from public.pokemon_binders where pokemon_binders.id = pokemon_binder_cards.binder_id and pokemon_binders.user_id = auth.uid()));
create index pokemon_binder_cards_binder_id_idx on public.pokemon_binder_cards (binder_id);

insert into storage.buckets (id, name, public) values ('pokemon-covers', 'pokemon-covers', true) on conflict (id) do nothing;
create policy "Pokémon cover images are publicly viewable" on storage.objects for select using (bucket_id = 'pokemon-covers');
create policy "Users can upload their own Pokémon cover images" on storage.objects for insert with check (bucket_id = 'pokemon-covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update their own Pokémon cover images" on storage.objects for update using (bucket_id = 'pokemon-covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete their own Pokémon cover images" on storage.objects for delete using (bucket_id = 'pokemon-covers' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.guild_activity drop constraint if exists guild_activity_event_type_check;
alter table public.guild_activity add constraint guild_activity_event_type_check
  check (event_type in (
    'achievement_unlocked', 'gd_score_milestone', 'backlog_status_change',
    'wishlist_added', 'mtg_card_added', 'fab_card_added', 'pokemon_card_added', 'joined_guild'
  ));

-- Marketplace: widen the game check from the FaB migration to also allow 'pokemon'.
alter table public.marketplace_listings drop constraint if exists marketplace_listings_game_check;
alter table public.marketplace_listings add constraint marketplace_listings_game_check check (game is null or game in ('mtg', 'fab', 'pokemon'));

-- ---------- Marketplace: real price offers (additive) ----------
-- One counter round only (buyer -> seller accept/decline/counter ->
-- buyer accept/decline the counter) — enforced in lib/marketplace.js,
-- not a DB-level state machine, same as marketplace_listings.status
-- itself already has no transition enforcement beyond the CHECK.
-- Accepting never auto-marks the listing sold (a real, separate
-- action) but does trigger the same real contactSeller() friend-
-- request flow "Contact Seller" already uses.
create table public.marketplace_offers (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references public.marketplace_listings on delete cascade not null,
  buyer_id uuid references auth.users on delete cascade not null,
  amount numeric not null,
  currency text not null default 'USD',
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'countered', 'withdrawn')),
  counter_amount numeric,
  counter_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.marketplace_offers enable row level security;

-- Buyer sees their own offers; seller sees offers on listings they own.
create policy "Buyers and sellers can view relevant offers"
  on public.marketplace_offers for select
  using (
    auth.uid() = buyer_id
    or auth.uid() = (select user_id from public.marketplace_listings where id = listing_id)
  );

create policy "Buyers can create offers"
  on public.marketplace_offers for insert
  with check (auth.uid() = buyer_id);

create policy "Buyers and sellers can update relevant offers"
  on public.marketplace_offers for update
  using (
    auth.uid() = buyer_id
    or auth.uid() = (select user_id from public.marketplace_listings where id = listing_id)
  );

create index marketplace_offers_listing_id_idx on public.marketplace_offers (listing_id);
create index marketplace_offers_buyer_id_idx on public.marketplace_offers (buyer_id);

-- ---------- Guild posts: threaded comments (additive) ----------
-- One level of threading only — a reply's own parent_comment_id must
-- point at a top-level comment (null parent), enforced in the UI, not
-- the DB. is_guild_post_member already covers RLS for this table via
-- post_id, so replies inherit the exact same real membership check
-- top-level comments already use — no new RLS needed.
alter table public.guild_post_comments add column if not exists parent_comment_id uuid references public.guild_post_comments on delete cascade;
create index if not exists guild_post_comments_parent_id_idx on public.guild_post_comments (parent_comment_id);

alter table public.guild_activity drop constraint if exists guild_activity_event_type_check;
alter table public.guild_activity add constraint guild_activity_event_type_check
  check (event_type in (
    'achievement_unlocked', 'gd_score_milestone', 'backlog_status_change',
    'wishlist_added', 'mtg_card_added', 'fab_card_added', 'pokemon_card_added',
    'joined_guild', 'guild_post_commented', 'guild_comment_replied'
  ));

-- ---------- Direct Messages: real 1:1 messaging between friends (additive) ----------
-- One flat table, no separate "conversations" table — a conversation is
-- just every row where {sender_id, receiver_id} matches that pair,
-- computed client-side (see lib/messages.js), same as this app avoids a
-- separate "offer thread" table for marketplace_offers. Deliberately
-- NOT wired into logActivityForUser/logActivityForGuild — a private
-- message must never be broadcast into any Guild feed or the
-- notifications bell.
create table public.direct_messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references auth.users on delete cascade not null,
  receiver_id uuid references auth.users on delete cascade not null,
  body text not null,
  created_at timestamptz default now(),
  read_at timestamptz,
  check (sender_id <> receiver_id)
);

alter table public.direct_messages enable row level security;

create policy "Sender and receiver can view a DM"
  on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Friends-only. friends rows are symmetric (both directions written by
-- accept_friend_request), so checking one direction is sufficient —
-- same one-hop-subquery pattern marketplace_offers already uses, no
-- SECURITY DEFINER needed.
create policy "Friends can send a DM"
  on public.direct_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (select 1 from public.friends where user_id = auth.uid() and friend_id = receiver_id)
  );

-- No column-level restriction (same trust-the-app-layer precedent as
-- marketplace_offers' own update policy) — the app only ever sets read_at.
create policy "Receiver can mark a DM read"
  on public.direct_messages for update
  using (auth.uid() = receiver_id);

create index direct_messages_sender_id_idx on public.direct_messages (sender_id, created_at desc);
create index direct_messages_receiver_id_idx on public.direct_messages (receiver_id, created_at desc);

-- ---------- Guild Pulse: privacy opt-in for the activity feed (additive) ----------
-- Defaults to false (opt-in, not opt-out) — this is activity about a
-- specific named person, so silence-by-default is the right call even
-- though it means the pulse starts out emptier for everyone.
alter table public.profiles add column if not exists share_activity_with_guilds boolean not null default false;

-- accent_color's column default was never updated when the app's own
-- default theme moved from red to gold — new signups were silently
-- getting the real string 'red' from this default (not null), so the
-- app's `profile.accent_color || "gold"` fallback never actually fired
-- for them. Existing rows are untouched; this only changes what NEW
-- rows get.
alter table public.profiles alter column accent_color set default 'gold';

-- Enforced at the RLS layer, not just in application code, so it's a
-- real guarantee rather than a UI convention any direct API call could
-- bypass — every existing reader of guild_activity (the notification
-- bell, the Overview ticker, and the new Guild Pulse card below) gets
-- this for free with no query-side changes. You can always see your
-- own activity regardless of your own opt-in state.
drop policy if exists "Guild members can view their guild's activity feed" on public.guild_activity;
create policy "Guild members can view their guild's activity feed"
  on public.guild_activity for select
  using (
    exists (select 1 from public.guild_members where guild_members.guild_id = guild_activity.guild_id and guild_members.user_id = auth.uid())
    and (
      auth.uid() = guild_activity.user_id
      or exists (select 1 from public.profiles where profiles.id = guild_activity.user_id and profiles.share_activity_with_guilds = true)
    )
  );

-- ---------- Game Completions: 100%-achievement alerts (additive) ----------
-- Steam only — its achievement schema is real and authoritative (every
-- achievement that exists, not just ones a person chose to track), so
-- "100%" here is a genuine, verifiable claim. Xbox/PlayStation's manual
-- checklists in lib/platformAchievements.js don't get this: 100% of a
-- self-typed list isn't the same claim as 100% of a real platform.
--
-- One row per person per completed game. The unique constraint is what
-- makes the alert fire exactly once (see recordGameCompletionIfNew in
-- lib/achievements.js) — an insert conflict just means it was already
-- recorded, safe even if two tabs/devices detect the same completion
-- at once.
create table public.game_completions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  appid bigint not null,
  game_name text not null,
  total_achievements int not null,
  completed_at timestamptz default now(),
  unique (user_id, appid)
);

alter table public.game_completions enable row level security;

create policy "Users can view their own game completions"
  on public.game_completions for select
  using (auth.uid() = user_id);

create policy "Users can record their own game completions"
  on public.game_completions for insert
  with check (auth.uid() = user_id);

create index game_completions_user_id_idx on public.game_completions (user_id);

-- New Guild Pulse event type for a 100%-completion, broadcast through
-- the exact same logActivityForUser fan-out every other real event
-- already uses. guild_activity's CHECK constraint can't add a value in
-- place — drop/recreate, same as every prior addition above.
alter table public.guild_activity drop constraint if exists guild_activity_event_type_check;
alter table public.guild_activity add constraint guild_activity_event_type_check
  check (event_type in (
    'achievement_unlocked', 'gd_score_milestone', 'backlog_status_change',
    'wishlist_added', 'mtg_card_added', 'fab_card_added', 'pokemon_card_added',
    'joined_guild', 'guild_post_commented', 'guild_comment_replied', 'game_completed'
  ));

-- ---------- Guild roles: moderator/admin tiers (additive) ----------
-- Owner stays exactly as before — the immutable guilds.created_by,
-- never a role row, so an owner can never be demoted or kicked through
-- the new role-management policies below. This adds two tiers *under*
-- owner: admin (can manage members' roles + kick + moderate content)
-- and moderator (can moderate content only). Every existing membership
-- row defaults to 'member', so nothing changes for anyone until an
-- owner/admin actively promotes someone.
alter table public.guild_members add column if not exists role text not null default 'member' check (role in ('member', 'moderator', 'admin'));

create or replace function public.can_manage_guild_members(p_guild_id uuid, p_user_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select
    exists (select 1 from public.guilds where id = p_guild_id and created_by = p_user_id)
    or exists (select 1 from public.guild_members where guild_id = p_guild_id and user_id = p_user_id and role = 'admin');
$$;

create or replace function public.can_moderate_guild_content(p_guild_id uuid, p_user_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select
    public.can_manage_guild_members(p_guild_id, p_user_id)
    or exists (select 1 from public.guild_members where guild_id = p_guild_id and user_id = p_user_id and role = 'moderator');
$$;

-- Owner/admin can change another member's role. Excludes the owner's
-- own row (ownership isn't a role, so it can't be targeted at all) and
-- the actor's own row (no self-promotion). No column-level restriction
-- on the UPDATE beyond that — same trust-the-app-layer precedent
-- direct_messages' own update policy already uses, since the app only
-- ever writes the role column here.
create policy "Managers can change another member's role"
  on public.guild_members for update
  using (
    public.can_manage_guild_members(guild_id, auth.uid())
    and user_id <> auth.uid()
    and user_id <> (select created_by from public.guilds where id = guild_id)
  )
  with check (
    public.can_manage_guild_members(guild_id, auth.uid())
    and user_id <> auth.uid()
    and user_id <> (select created_by from public.guilds where id = guild_id)
  );

-- Owner/admin can kick another member — same exclusions as above.
-- Removing your own membership still goes through the existing "Users
-- can leave a guild themselves" policy, not this one.
create policy "Managers can kick another member"
  on public.guild_members for delete
  using (
    public.can_manage_guild_members(guild_id, auth.uid())
    and user_id <> auth.uid()
    and user_id <> (select created_by from public.guilds where id = guild_id)
  );

-- Owner/admin/moderator can delete any post or comment in a guild they
-- moderate — additive alongside the existing "Authors can delete their
-- own X" policies (RLS ORs permissive policies together for the same
-- command, so this doesn't replace self-delete, just adds to it).
create policy "Moderators can delete any post in their guild"
  on public.guild_posts for delete
  using (public.can_moderate_guild_content(guild_id, auth.uid()));

create policy "Moderators can delete any comment in their guild"
  on public.guild_post_comments for delete
  using (
    exists (
      select 1 from public.guild_posts
      where guild_posts.id = guild_post_comments.post_id
        and public.can_moderate_guild_content(guild_posts.guild_id, auth.uid())
    )
  );

-- ---------- Mastery score history (daily snapshots) ----------
-- Applied in production via add_mastery_score_history migration;
-- documented here so local schema stays the source of truth.

create table if not exists public.mastery_score_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  overall_mastery_score numeric not null,
  recorded_at timestamptz not null default now()
);

create index if not exists mastery_score_history_user_time_idx
  on public.mastery_score_history (user_id, recorded_at desc);

alter table public.mastery_score_history enable row level security;

create policy "Users can read their own mastery history"
  on public.mastery_score_history for select
  using (user_id = auth.uid());

-- Friend-scoped history for charts (see friends.js). Unioned with
-- each friend's LIVE overall_mastery_score (as a synthetic "now" row)
-- so a same-day recompute (e.g. clicking "Recompute Gaming Mastery",
-- or the daily Xbox/PSN cron) shows up immediately on the chart
-- instead of waiting for the next 4am UTC snapshot-mastery-scores-
-- daily pg_cron run (see mastery_score_history's own comment above) —
-- confirmed live: a friend's chart didn't reflect their same-day
-- recompute at all before this, since the history table itself is
-- only ever written once a day.
create or replace function public.get_friends_mastery_history(p_ids uuid[], p_since timestamptz default (now() - '90 days'::interval))
returns table (user_id uuid, overall_mastery_score numeric, recorded_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select h.user_id, h.overall_mastery_score, h.recorded_at
  from public.mastery_score_history h
  where h.user_id = any(p_ids)
    and h.recorded_at >= p_since
    and exists (
      select 1 from public.friends f
      where f.user_id = auth.uid()
        and f.friend_id = h.user_id
    )
  union all
  select p.id, p.overall_mastery_score, now()
  from public.profiles p
  where p.id = any(p_ids)
    and p.overall_mastery_score > 0
    and exists (
      select 1 from public.friends f
      where f.user_id = auth.uid()
        and f.friend_id = p.id
    )
  order by recorded_at asc;
$$;

-- Guildmate-scoped history — same trust model, shared-guild check.
-- This function was documented here for a long time without ever
-- actually being applied to the live database (confirmed live: a
-- pg_proc lookup came back empty) — every call from
-- fetchGuildmatesMasteryHistory (lib/guilds.js, used by the Overview
-- chart's guild/red peer lines) was silently failing this whole time,
-- caught and logged as a warning, rendering as "no guild data" rather
-- than a visible error. Actually applied now, with the same live
-- "now" row unioned in as get_friends_mastery_history above, for the
-- same reason (a same-day recompute otherwise waits for the next
-- daily snapshot to show up at all).
create or replace function public.get_guildmates_mastery_history(p_ids uuid[], p_since timestamptz default (now() - '90 days'::interval))
returns table (user_id uuid, overall_mastery_score numeric, recorded_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select h.user_id, h.overall_mastery_score, h.recorded_at
  from public.mastery_score_history h
  where h.user_id = any(p_ids)
    and h.recorded_at >= p_since
    and exists (
      select 1
      from public.guild_members mine
      join public.guild_members theirs on mine.guild_id = theirs.guild_id
      where mine.user_id = auth.uid()
        and theirs.user_id = h.user_id
        and theirs.user_id = any(p_ids)
    )
  union all
  select p.id, p.overall_mastery_score, now()
  from public.profiles p
  where p.id = any(p_ids)
    and p.overall_mastery_score > 0
    and exists (
      select 1
      from public.guild_members mine
      join public.guild_members theirs on mine.guild_id = theirs.guild_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p.id
        and theirs.user_id = any(p_ids)
    )
  order by recorded_at asc;
$$;

-- ---------- Xbox Live / PSN OAuth tokens (real Gamerscore/trophy sync) ----------
-- Applied in production via add_xbox_psn_oauth_tokens migration;
-- documented here so local schema stays the source of truth. See
-- api/pricing.js's handleXbox/handlePsn and lib/xboxOAuth.js/
-- lib/psnAuth.js for the real OAuth flows these back.
--
-- Deliberately NO select/insert/update/delete policy granted to anon/
-- authenticated on either table — these are session credentials, not
-- public profile data, so only the Vercel proxy's service_role client
-- ever reads/writes them, never the client directly (same posture as
-- the "act as Lykodex" session-vending endpoint's use of service_role).

create table if not exists public.xbox_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  ms_access_token text not null,
  ms_refresh_token text,
  ms_expires_at timestamptz not null,
  xsts_token text not null,
  xsts_expires_at timestamptz not null,
  userhash text not null,
  xuid text not null,
  gamertag text,
  -- Set at link time (see api/pricing.js's handleXbox "link" mode):
  -- true when this account was linked via the packaged-app flow
  -- (redirect_uri = lykodex://xbox-callback, a public client in
  -- Azure), false for the web flow (a confidential client). A later
  -- refresh_token request has no redirect_uri of its own to infer
  -- this from, but must still send/omit client_secret the same way
  -- the original link did — Microsoft rejects a public-client
  -- request outright if a secret is present at all ("Public clients
  -- can't send a client secret", confirmed live testing desktop
  -- Xbox sign-in).
  is_public_client boolean not null default false,
  updated_at timestamptz default now()
);

alter table public.xbox_tokens enable row level security;

create table if not exists public.psn_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  account_id text,
  online_id text,
  updated_at timestamptz default now()
);

alter table public.psn_tokens enable row level security;

-- Narrow status-only RPCs — xbox_tokens/psn_tokens intentionally have
-- no client-readable RLS policy above, so the UI needs a safe way to
-- check "is MY account linked" without exposing token values. Each
-- only reveals whether the CALLING user's own row exists.
create or replace function public.is_xbox_linked()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.xbox_tokens where user_id = auth.uid());
$$;
revoke execute on function public.is_xbox_linked() from public, anon;
grant execute on function public.is_xbox_linked() to authenticated;

create or replace function public.is_psn_linked()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.psn_tokens where user_id = auth.uid());
$$;
revoke execute on function public.is_psn_linked() from public, anon;
grant execute on function public.is_psn_linked() to authenticated;

-- ---------- Per-user timezone (captured, not yet used by the cron) ----------
-- Applied in production via add_profiles_timezone migration. Captured
-- client-side (see AppContext.jsx) from the browser's own
-- Intl.DateTimeFormat().resolvedOptions().timeZone on login — an IANA
-- name (e.g. "Australia/Sydney"), not a raw UTC offset, so it stays
-- correct across daylight saving changes. api/pricing.js's
-- mastery-cron runs once daily for everyone at one fixed UTC time
-- (see vercel.json) — an hourly, per-person-local-midnight version of
-- this cron was tried and reverted: Vercel's Hobby plan hard-rejects
-- any cron expression that would run more than once a day, and it
-- silently blocked every deployment until reverted. This column is
-- kept captured and current for whenever a Pro-plan upgrade makes
-- real per-timezone precision possible to build.

-- ---------- Gaming Collection's real owned-games library ----------
-- One flat list of every game a person owns on Xbox/PlayStation/
-- Steam, each tagged with its platform — no status/completion
-- tracking at all (that's backlog_items' job, a deliberately separate
-- list for games someone's actively deciding to play next). Xbox/PSN's
-- "Import Library" buttons on Account Linking write here now (see
-- lib/libraryImport.js) instead of backlog_items — bulk-importing a
-- person's full owned library into backlog_items would've silently
-- defaulted every single imported game to status 'backlog' (not yet
-- played), which is wrong for games they've already finished. Steam's
-- own owned-games list isn't stored here at all — LibraryPage.jsx
-- still live-fetches that directly from Steam's Web API on every
-- load, same as before this table existed.
create table public.game_library_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  platform text not null,
  steam_appid text,
  parent_title text,
  added_at timestamptz default now()
);

alter table public.game_library_items enable row level security;

create policy "Users can view their own game library"
  on public.game_library_items for select
  using (auth.uid() = user_id);

create policy "Users can add to their own game library"
  on public.game_library_items for insert
  with check (auth.uid() = user_id);

create policy "Users can remove their own game library items"
  on public.game_library_items for delete
  using (auth.uid() = user_id);

create index game_library_items_user_id_idx on public.game_library_items (user_id);
-- Exact-case match is intentional, not a shortcut: titles come
-- consistently from each import API's own casing, and the same game
-- appearing once per platform (e.g. "Portal 2" for both Xbox and
-- Steam) is two real, distinct rows, not a duplicate to collapse.
create unique index game_library_items_user_platform_title_idx on public.game_library_items (user_id, platform, title);
alter table public.profiles add column if not exists timezone text;

-- ---------- Primary guild + Guild Mastery Score average ----------
-- Applied in production via add_guild_primary_and_mastery_average
-- migration. At most one primary guild per user (a partial unique
-- index on user_id where is_primary is true), not one per guild - a
-- personal choice among a user's own guild memberships, set via
-- set_primary_guild() from the Guilds screen (see lib/guilds.js's
-- setPrimaryGuild).
alter table public.guild_members add column if not exists is_primary boolean not null default false;
create unique index if not exists guild_members_one_primary_per_user_idx
  on public.guild_members (user_id) where (is_primary);

create or replace function public.set_primary_guild(p_guild_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.guild_members
    where guild_id = p_guild_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this guild';
  end if;

  update public.guild_members set is_primary = false where user_id = auth.uid() and is_primary = true;
  update public.guild_members set is_primary = true where guild_id = p_guild_id and user_id = auth.uid();
end;
$$;
revoke execute on function public.set_primary_guild(uuid) from public, anon;
grant execute on function public.set_primary_guild(uuid) to authenticated;

-- Guild Mastery Score: the real average of every member's own Overall
-- Mastery Score - always computed live (no cache/recompute trigger
-- needed, guild rosters are small), and public to any signed-in user
-- (matches "Any signed-in user can browse guilds") since an aggregate
-- average doesn't reveal any one member's individual score. See
-- lib/masteryTiers.js for the tier bands this feeds into.
create or replace function public.get_guild_mastery_average(p_guild_id uuid)
returns table (avg_score numeric, member_count integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(avg(p.overall_mastery_score), 0) as avg_score,
    count(*)::integer as member_count
  from public.guild_members gm
  join public.profiles p on p.id = gm.user_id
  where gm.guild_id = p_guild_id;
$$;
revoke execute on function public.get_guild_mastery_average(uuid) from public, anon;
grant execute on function public.get_guild_mastery_average(uuid) to authenticated;

-- ---------- Crunchyroll linking (unofficial, cookie-based) ----------
-- Applied in production via add_crunchyroll_tokens migration.
-- Crunchyroll has no public developer API at all — this uses the same
-- internal beta-api.crunchyroll.com endpoints crunchyroll.com's own
-- website calls (confirmed against HarshitKumar9030/crunchyroll-api's
-- actual working source, not guessed): POST /auth/v1/token with
-- grant_type=etp_rt_cookie and the person's own etp_rt session cookie
-- (extracted from their own logged-in browser, same "paste a token
-- from your own session" shape as PSN's npsso) -> {access_token,
-- refresh_token, expires_in, profile_id, account_id}. Watch history
-- lives at GET /content/v2/{accountId}/watch-history, each entry's
-- real title at entry.panel.title. Same posture as xbox_tokens/
-- psn_tokens: RLS enabled, zero client policies — service_role only.
create table public.crunchyroll_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  access_token text not null,
  refresh_token text,
  account_id text,
  profile_id text,
  device_id text not null,
  expires_at timestamptz not null,
  updated_at timestamptz default now()
);

alter table public.crunchyroll_tokens enable row level security;

create or replace function public.is_crunchyroll_linked()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.crunchyroll_tokens where user_id = auth.uid());
$$;
revoke execute on function public.is_crunchyroll_linked() from public, anon;
grant execute on function public.is_crunchyroll_linked() to authenticated;

-- ---------- Library College's real imported-media library ----------
-- Applied in production via add_media_library_items migration. Same
-- shape/reason as game_library_items (Gaming): a flat "you have this,
-- from this source" list with no status/completion tracking forced
-- onto it — entertainment_entries already has a status field
-- (completed/watching/want_to_watch) for what a person manually
-- tracks; bulk-importing a full Crunchyroll/Kindle/Audible history
-- into that table would silently default every imported title to one
-- status, wrong for a mix of finished/in-progress/never-started real
-- history.
create table public.media_library_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  source text not null, -- 'crunchyroll' | 'kindle' | 'audible'
  added_at timestamptz default now()
);

alter table public.media_library_items enable row level security;

create policy "Users can view their own media library"
  on public.media_library_items for select
  using (auth.uid() = user_id);

create policy "Users can add to their own media library"
  on public.media_library_items for insert
  with check (auth.uid() = user_id);

create policy "Users can remove their own media library items"
  on public.media_library_items for delete
  using (auth.uid() = user_id);

create index media_library_items_user_id_idx on public.media_library_items (user_id);
-- Exact-case match, same reasoning as game_library_items: titles come
-- consistently from each import source's own casing.

-- ---------- Achievement/trophy categories (additive) ----------
-- Lets trophies/achievements be grouped into named sections (Story,
-- Combat, Collectibles, etc.) so AchievementsPage can collapse a section
-- once everything in it is checked off — same "close off what you've
-- finished" layout as IGN's trophy-guide wikis.
--
-- Xbox/PlayStation's manual tracker (platform_achievements) gets the
-- column directly since the app owns every row there. Steam has no
-- category data of its own (see platform_achievements' comment above)
-- and its achievement rows are a live view, never stored — so tagging a
-- Steam achievement needs its own small table keyed by (appid, apiname),
-- independent of unlock state (which always stays a live read from
-- Steam).
alter table public.platform_achievements add column if not exists category text;

-- ---------- Real Xbox/PlayStation achievement sync (additive) ----------
-- The comment on platform_achievements above ("neither platform has a
-- public API") turned out to be wrong for real per-title data: Xbox
-- Live's achievements.xboxlive.com and PSN's per-npCommunicationId
-- trophy endpoints both work today with the exact same tokens already
-- stored in xbox_tokens/psn_tokens for gamerscore/trophy-count and
-- library — unofficial and undocumented (Sony/Microsoft could change
-- them without notice), but real, confirmed against the same reference
-- implementations (OpenXbox/xbox-webapi-python, achievements-app/
-- psn-api) already cited throughout api/pricing.js. See
-- AchievementsPage.jsx's ManualAchievements for the "pick a game from
-- your real library, then Refresh" flow this powers.
--
-- A synced row lives in this same table, not a separate one — a
-- "Refresh" upserts on the existing (user_id, platform, game_name,
-- achievement_name) unique constraint, updating only unlocked/
-- unlocked_at/description/icon_url, so a person's own category tag on
-- a synced achievement survives every future refresh untouched.
-- external_id is the achievement/trophy's own id (Xbox achievement id
-- / PSN trophyId); external_title_id is the game's id (Xbox titleId /
-- PSN npCommunicationId) — carried on every row for that game so the
-- per-game Refresh button knows what to re-fetch without a second
-- table just to remember "which games are tracked."
alter table public.platform_achievements add column if not exists external_id text;
alter table public.platform_achievements add column if not exists external_title_id text;
alter table public.platform_achievements add column if not exists icon_url text;
alter table public.platform_achievements add column if not exists source text not null default 'manual' check (source in ('manual', 'synced'));

create table public.steam_achievement_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  appid bigint not null,
  apiname text not null,
  category text not null,
  updated_at timestamptz default now(),
  unique (user_id, appid, apiname)
);

alter table public.steam_achievement_categories enable row level security;

create policy "Users can manage their own Steam achievement categories"
  on public.steam_achievement_categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index steam_achievement_categories_user_appid_idx
  on public.steam_achievement_categories (user_id, appid);
create unique index media_library_items_user_source_title_idx on public.media_library_items (user_id, source, title);
