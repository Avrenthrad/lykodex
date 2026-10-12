# Lykodex Discord Bot

The always-on Lykodex Discord bot. It started as the Presence Bot (live
"now playing" + console playtime + daily Mastery refresh) and now also
has slash commands, an activity feed, leaderboards, and opt-in tracking
of voice chat, PC playtime, Spotify and Watching time for Mastery.

It uses the **same Supabase database as the Lykodex app** and needs its
own always-on host (Railway): a Discord Gateway connection can't live in
a Vercel serverless function.

## What it does

| Feature | How |
|---|---|
| **Account linking** | `/link` shows your link status, or steps to link. Linking itself happens in the app (Account Linking → Discord OAuth), so Discord proves who you are. |
| **Slash commands** | `/profile`, `/mastery`, `/collection`, `/nowplaying`, `/leaderboard` |
| **Activity feed** | Posts Lykodex activity to a channel: achievements, 100% completions, finished games, wishlist adds, new TCG cards, Mastery level-ups, and (optionally) "started playing X". Bulk events are batched into one line per person. |
| **Leaderboards** | `/leaderboard board:` Overall Mastery · Gaming Mastery · Tracked Playtime · Voice Chat Time · 100% Completions · Library Size |
| **Presence tracking** *(opt-in)* | Live "currently playing" → `current_activity`; Xbox, PlayStation and non-Steam PC session time → `platform_playtime` |
| **Voice chat time** *(opt-in)* | Voice sessions → `discord_voice_sessions` → new **Social** College in Overall Mastery |
| **Spotify / Watching** *(opt-in)* | Listening and Watching sessions → `discord_media_sessions` → **Entertainment** Mastery |
| **Daily Mastery refresh** | Recomputes Gaming + Overall Mastery for every profile every 24h |

### Tracking is opt-in

The bot records nothing about a person (not even live "now playing")
until they turn on **Discord activity tracking** in Lykodex (Account
Settings → Privacy, `profiles.discord_tracking_enabled`). Turning it
off takes effect within about 5 minutes. Nothing can be backfilled.

| What | Where it goes | Counts toward |
|---|---|---|
| Xbox / PlayStation playtime | `platform_playtime` | (recorded) |
| PC playtime, excluding games in your Steam library | `platform_playtime` (`pc`) | (recorded) |
| Voice chat, only when not deafened, not AFK, and with someone else | `discord_voice_sessions` | **Social**: 10 raw per hour, 100h ≈ 1000 |
| Spotify listening (skips under 30s ignored) | `discord_media_sessions` | **Entertainment**: +1 per hour |
| Watching (e.g. Crunchyroll) | `discord_media_sessions` | **Entertainment**: +4 per hour |

Totals come from the `discord_activity_totals` view. Weights live in
`src/mastery/overallMastery.js` (kept in sync with the app's
`src/lib/overallMastery.js`).

### Privacy rule (applies everywhere)

The bot uses the `service_role` key, so Supabase RLS doesn't protect
anyone. The bot enforces this one rule itself (`src/privacy.js`):

- You can always see **your own** stats.
- You can see **someone else's** stats, leaderboard spot and feed posts
  only if they've turned on **Share activity with guilds** in Lykodex.

That's the same opt-in Guild Pulse already uses. `/nowplaying` is the
one exception: it only shows what Discord already shows everyone in the
member list.

## Commands

| Command | Who | What |
|---|---|---|
| `/link` | anyone | Link status / how to link |
| `/profile [user]` | anyone | Profile card: mastery levels, now playing, gamertags |
| `/mastery [user]` | anyone | Overall + Gaming Mastery with XP bars and breakdown |
| `/collection [user]` | anyone | Counts across Gaming, TCG, Entertainment, Collectibles |
| `/nowplaying` | anyone | Who in the server is playing what right now |
| `/leaderboard [board]` | anyone | Server leaderboard (incl. Voice Chat Time) |
| `/lykodex-setup feed channel:#x [now_playing]` | Manage Server | Turn on the activity feed in a channel |
| `/lykodex-setup feed-off` | Manage Server | Pause the feed |
| `/lykodex-setup status` | Manage Server | Show settings |

## Setup (upgrading the existing bot)

The bot token, intents and Railway service stay the same. Env var names
are unchanged, so the existing Railway variables keep working.

1. **Database:** run the two SQL files in `sql/` once, in order, in the
   Supabase SQL editor. They're the same as the last two blocks of
   `supabase/schema.sql`, and both are additive and safe to re-run.
2. **Re-invite the bot** so slash commands work. The original invite
   only had the `bot` scope. Developer Portal → your app → **OAuth2 →
   URL Generator**: scopes `bot` + `applications.commands`; permissions
   **View Channels**, **Send Messages**, **Embed Links**. Open the URL
   and pick your server. It won't kick or duplicate the bot; it only
   adds permissions.
3. **Optional Railway variable:** `DISCORD_GUILD_ID` = your server's ID
   (Developer Mode → right-click server → Copy Server ID). Commands
   appear instantly in that server; without it they register globally
   and can take up to an hour to show.
4. **Deploy:** merging to `main` redeploys the existing Railway service
   (Root Directory `discord-bot`, `npm start`). Nothing else to change.
5. **In Discord:** `/lykodex-setup feed channel:#your-channel`.
6. **Each person:** turn on **Discord activity tracking** in Lykodex
   (Account Settings → Privacy).

**Heads-up:** the old version tracked every linked account. This one
only tracks people who opt in, so anyone who hasn't turned tracking on
stops getting now-playing and console hours after the upgrade.

Intents: **Presence** and **Server Members** (already on) are still
required. Voice tracking uses the Voice States intent, which isn't
privileged, so there's nothing new to toggle.

### Running locally

```
cp .env.example .env   # fill in token + Supabase URL/service key
npm install
npm start
```

Don't run a local copy while the Railway one is up with tracking on,
or playtime gets counted twice. Set `ENABLE_PRESENCE_TRACKING=false` and
`ENABLE_MASTERY_REFRESH=false` locally if you need to.

## Development

```
npm test          # unit tests (formatting, batching, privacy, level-ups, voice/media tracking, command JSON)
```

```
src/
  index.js            startup, wiring, schedules
  config.js           env parsing
  supabase.js         service_role client
  links.js            Discord ↔ Lykodex lookups (discord_links)
  privacy.js          the one visibility rule
  format.js           pure formatting / batching / ranking helpers
  settings.js         discord_guild_settings access
  feed.js             activity feed poller + now-playing / level-up posts
  tracking.js         opt-in gate + Steam-library exclusion for PC playtime
  presence.js         now playing, playtime, Spotify/Watching sessions
  voice.js            voice chat sessions → Social Mastery
  mastery/            scoring math + daily refresh (ported) + level-up diff
  commands/           one file per slash command
sql/                  schema additions for the shared Lykodex database
```

`src/mastery/gameMastery.js` and `overallMastery.js` are hand-kept copies
of the app's `src/lib/` scoring math. If the formulas change there, update
them here too.
