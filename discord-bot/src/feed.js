// Activity feed: posts Lykodex activity (achievements, completions,
// wishlist adds, new cards…) from linked server members into each
// Discord server's chosen feed channel.
//
// Source of truth is the app's own guild_activity table — the same
// rows that drive Guild Pulse — so anything that shows up in the app
// shows up here, with no changes needed on the app side. Polling (not
// Supabase Realtime) on purpose: simpler, survives restarts via a
// stored cursor, and a minute of delay is fine for a feed.
//
// Privacy: only people who opted into "Share activity with guilds"
// are ever posted, same as Guild Pulse.
import { supabase } from "./supabase.js";
import { allFeedSettings, saveSettings } from "./settings.js";
import { linkedMembersOf } from "./links.js";
import { dedupeActivity, summarizeActivity, chunkLines, displayName, platformLabel } from "./format.js";

const MEMBER_CACHE_MS = 5 * 60 * 1000;
const memberCache = new Map(); // discordGuildId -> { at, linked }

async function sharingMembers(guild) {
  const hit = memberCache.get(guild.id);
  if (hit && Date.now() - hit.at < MEMBER_CACHE_MS) return hit.linked;

  const linked = await linkedMembersOf(guild);
  if (linked.length === 0) {
    memberCache.set(guild.id, { at: Date.now(), linked: [] });
    return [];
  }
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, username, first_name, share_activity_with_guilds")
    .in("id", linked.map((l) => l.userId));
  if (error) throw error;
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  const result = linked
    .filter((l) => byId.get(l.userId)?.share_activity_with_guilds)
    .map((l) => ({ ...l, profile: byId.get(l.userId) }));
  memberCache.set(guild.id, { at: Date.now(), linked: result });
  return result;
}

async function feedChannel(client, settings) {
  const channel = await client.channels.fetch(settings.feed_channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function pollGuild(client, settings) {
  const guild = client.guilds.cache.get(settings.discord_guild_id);
  if (!guild) return; // bot was removed from this server
  const channel = await feedChannel(client, settings);
  if (!channel) return;

  const members = await sharingMembers(guild);
  if (members.length === 0) return;

  const cursor = settings.feed_cursor || new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("guild_activity")
    .select("user_id, event_type, event_data, created_at")
    .in("user_id", members.map((m) => m.userId))
    .gt("created_at", cursor)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!rows || rows.length === 0) return;

  const nameFor = (userId) => {
    const m = members.find((x) => x.userId === userId);
    return displayName(m?.profile, m?.member.displayName);
  };
  const lines = summarizeActivity(dedupeActivity(rows), nameFor);
  for (const content of chunkLines(lines)) {
    await channel.send({ content, allowedMentions: { parse: [] } });
  }

  const newCursor = rows[rows.length - 1].created_at;
  settings.feed_cursor = newCursor;
  await saveSettings(settings.discord_guild_id, { feed_cursor: newCursor });
}

let polling = false;
export async function pollFeeds(client) {
  if (polling) return; // previous run still going — skip, don't stack
  polling = true;
  try {
    const all = await allFeedSettings();
    for (const settings of all) {
      if (settings.feed_enabled === false) continue;
      try {
        await pollGuild(client, settings);
      } catch (err) {
        console.error(`Feed poll failed for server ${settings.discord_guild_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Feed poll failed:", err.message);
  } finally {
    polling = false;
  }
}

export function invalidateMemberCache(discordGuildId) {
  memberCache.delete(discordGuildId);
}

// ---------- Extra bot-generated posts (not from guild_activity) ----------

// Posts one line to every feed channel in servers where this Lykodex
// user is a sharing member. Used for "started playing" and level-ups.
async function postToMemberFeeds(client, userId, buildLine, { requireNowPlaying = false } = {}) {
  let all;
  try {
    all = await allFeedSettings();
  } catch (err) {
    console.error("Feed settings lookup failed:", err.message);
    return;
  }
  for (const settings of all) {
    if (settings.feed_enabled === false) continue;
    if (requireNowPlaying && !settings.post_now_playing) continue;
    const guild = client.guilds.cache.get(settings.discord_guild_id);
    if (!guild) continue;
    try {
      const members = await sharingMembers(guild);
      const member = members.find((m) => m.userId === userId);
      if (!member) continue;
      const channel = await feedChannel(client, settings);
      if (!channel) continue;
      await channel.send({ content: buildLine(member), allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`Feed post failed for server ${settings.discord_guild_id}:`, err.message);
    }
  }
}

const NOW_PLAYING_COOLDOWN_MS = 30 * 60 * 1000;
const lastNowPlaying = new Map(); // `${userId}|${game}` -> ms

export async function announceNowPlaying(client, userId, gameName, platform) {
  const key = `${userId}|${gameName}`;
  const last = lastNowPlaying.get(key);
  if (last && Date.now() - last < NOW_PLAYING_COOLDOWN_MS) return;
  lastNowPlaying.set(key, Date.now());
  const where = platformLabel(platform);
  await postToMemberFeeds(
    client,
    userId,
    (m) => `🎮 **${displayName(m.profile, m.member.displayName)}** started playing **${gameName}**${where ? ` on ${where}` : ""}`,
    { requireNowPlaying: true },
  );
}

export async function announceLevelUp(client, userId, kind, fromLevel, toLevel) {
  const label = kind === "overall" ? "Overall Mastery" : "Gaming Mastery";
  await postToMemberFeeds(
    client,
    userId,
    (m) => `⬆️ **${displayName(m.profile, m.member.displayName)}** reached **${label} Level ${toLevel}** (was ${fromLevel})`,
  );
}
