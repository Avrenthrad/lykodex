// Presence tracking — everything Discord's live status tells us, for
// people who opted in (profiles.discord_tracking_enabled, see
// tracking.js):
//
//   Playing   → current_activity (live "now playing" on the site)
//             → platform_playtime for Xbox, PlayStation and PC.
//               PC games owned on Steam are skipped — Steam's own API
//               already reports those hours.
//   Listening → discord_media_sessions (kind 'listening', e.g. Spotify)
//   Watching  → discord_media_sessions (kind 'watching', e.g. Crunchyroll)
//
// Honest limitation: nothing can be backfilled. Tracking only counts
// from when someone opts in and shares a server with the bot.
import { supabase } from "./supabase.js";
import { trackedUserIdFor, isOwnedOnSteam } from "./tracking.js";
import { announceNowPlaying } from "./feed.js";

const ACTIVITY_PLAYING = 0;
const ACTIVITY_LISTENING = 2;
const ACTIVITY_WATCHING = 3;
const MIN_MEDIA_SECONDS = 30; // skipped tracks don't count

// Platform shown on the site's live status (matches current_activity's
// existing check constraint). Discord's platform field can be
// unreliable, so anything unexpected is "unknown", not a guess.
export function normalizePlatform(activity) {
  const raw = (activity?.platform || "").toLowerCase();
  if (raw === "xbox") return "xbox";
  if (raw === "playstation" || raw === "ps4" || raw === "ps5") return "playstation";
  if (raw === "desktop" || raw === "steam") return "steam";
  return "unknown";
}

// Platform used for playtime. Discord's desktop game detection leaves
// the platform empty or "desktop" — that's a PC game. Mobile/other
// platforms stay "unknown" and aren't counted.
export function playtimePlatform(activity) {
  const raw = (activity?.platform || "").toLowerCase();
  if (raw === "xbox") return "xbox";
  if (raw === "playstation" || raw === "ps4" || raw === "ps5") return "playstation";
  if (raw === "" || raw === "desktop") return "pc";
  return "unknown";
}

export function currentGameActivity(presence) {
  return presence?.activities?.find((a) => a.type === ACTIVITY_PLAYING) || null;
}

// Pure — the listening/watching session a presence represents, or null.
export function mediaFromPresence(presence) {
  const a = presence?.activities?.find((x) => x.type === ACTIVITY_LISTENING || x.type === ACTIVITY_WATCHING);
  if (!a) return null;
  const kind = a.type === ACTIVITY_LISTENING ? "listening" : "watching";
  const title = a.details || a.name || null;
  const subtitle = a.state || null;
  return { kind, source: a.name || "Unknown", title, subtitle, key: `${kind}|${a.name}|${title}|${subtitle}` };
}

const gameSessions = new Map(); // discordUserId -> { userId, platform, gameName, startedAt }
const mediaSessions = new Map(); // discordUserId -> { userId, kind, source, title, subtitle, key, startedAt }

async function updateCurrentActivity(userId, activity) {
  const { error } = await supabase.from("current_activity").upsert(
    {
      user_id: userId,
      platform: activity ? normalizePlatform(activity) : null,
      game_name: activity?.name || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) console.error("current_activity upsert failed:", error.message);
}

async function accumulatePlaytime(session, endedAt = Date.now()) {
  const { userId, platform, gameName, startedAt } = session;
  if (!["xbox", "playstation", "pc"].includes(platform)) return;
  const minutes = Math.round((endedAt - startedAt) / 60000);
  if (minutes <= 0) return;
  if (platform === "pc" && (await isOwnedOnSteam(userId, gameName))) return;

  const { data: existing } = await supabase
    .from("platform_playtime")
    .select("total_minutes")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("game_name", gameName)
    .maybeSingle();

  const { error } = await supabase.from("platform_playtime").upsert(
    {
      user_id: userId,
      platform,
      game_name: gameName,
      total_minutes: (existing?.total_minutes || 0) + minutes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform,game_name" },
  );
  if (error) console.error("platform_playtime upsert failed:", error.message);
}

async function saveMediaSession(session, endedAt = Date.now()) {
  const seconds = Math.round((endedAt - session.startedAt) / 1000);
  if (seconds < MIN_MEDIA_SECONDS) return;
  const { error } = await supabase.from("discord_media_sessions").insert({
    user_id: session.userId,
    kind: session.kind,
    source: session.source,
    title: session.title,
    subtitle: session.subtitle,
    started_at: new Date(session.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    duration_seconds: seconds,
  });
  if (error) console.error("discord_media_sessions insert failed:", error.message);
}

async function handleGame(client, discordUserId, userId, presence) {
  const activity = currentGameActivity(presence);
  const platform = activity ? playtimePlatform(activity) : null;
  const gameName = activity?.name || null;
  const prev = gameSessions.get(discordUserId);

  // The same person in several servers fires one update per server —
  // only act when the game actually changed.
  if (prev?.gameName === gameName && prev?.platform === platform) return;

  if (prev) await accumulatePlaytime(prev);
  if (activity) {
    gameSessions.set(discordUserId, { userId, platform, gameName, startedAt: Date.now() });
    announceNowPlaying(client, userId, gameName, normalizePlatform(activity)).catch((err) =>
      console.error("now-playing announce failed:", err.message),
    );
  } else {
    gameSessions.delete(discordUserId);
  }
  await updateCurrentActivity(userId, activity);
}

async function handleMedia(discordUserId, userId, presence) {
  const media = mediaFromPresence(presence);
  const prev = mediaSessions.get(discordUserId);
  if (prev?.key === media?.key) return;
  if (prev) await saveMediaSession(prev);
  if (media) mediaSessions.set(discordUserId, { ...media, userId, startedAt: Date.now() });
  else mediaSessions.delete(discordUserId);
}

export function registerPresenceTracking(client) {
  client.on("presenceUpdate", async (_old, presence) => {
    try {
      const discordUserId = presence.userId;
      const userId = await trackedUserIdFor(discordUserId);
      if (!userId) {
        // Opted out (or never in) — drop anything open without saving.
        gameSessions.delete(discordUserId);
        mediaSessions.delete(discordUserId);
        return;
      }
      await handleGame(client, discordUserId, userId, presence);
      await handleMedia(discordUserId, userId, presence);
    } catch (err) {
      console.error("presenceUpdate handler failed:", err.message);
    }
  });
}

// Close out open sessions on shutdown so accrued time isn't lost.
export async function flushSessions() {
  const now = Date.now();
  for (const s of gameSessions.values()) await accumulatePlaytime(s, now);
  for (const s of mediaSessions.values()) await saveMediaSession(s, now);
  gameSessions.clear();
  mediaSessions.clear();
}
