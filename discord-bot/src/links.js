// Discord <-> Lykodex account lookups, backed by discord_links (which
// the Lykodex app fills in right after someone signs in / links with
// Discord — see syncDiscordLink in the main app's src/lib/auth.js).
//
// Presence updates hit this constantly, so results are cached briefly.
// /link status bypasses the cache so a freshly-linked account shows up
// straight away.
import { supabase } from "./supabase.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // discordUserId -> { userId, cachedAt }

export async function lykodexUserIdFor(discordUserId, { fresh = false } = {}) {
  const hit = cache.get(discordUserId);
  if (!fresh && hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.userId;

  const { data, error } = await supabase
    .from("discord_links")
    .select("user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) {
    console.error("discord_links lookup failed:", error.message);
    return hit?.userId ?? null;
  }
  const userId = data?.user_id ?? null;
  cache.set(discordUserId, { userId, cachedAt: Date.now() });
  return userId;
}

// Bulk version for leaderboards/feed: Discord IDs -> Map(discordId -> userId)
export async function lykodexUserIdsFor(discordUserIds) {
  const result = new Map();
  const ids = [...new Set(discordUserIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("discord_links")
      .select("user_id, discord_user_id")
      .in("discord_user_id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      result.set(row.discord_user_id, row.user_id);
      cache.set(row.discord_user_id, { userId: row.user_id, cachedAt: Date.now() });
    }
  }
  return result;
}

export function forgetDiscordUser(discordUserId) {
  cache.delete(discordUserId);
}

// Every linked Lykodex account in a Discord server, as
// [{ discordId, userId, member }]. Needs the Server Members intent.
export async function linkedMembersOf(guild) {
  const members = await guild.members.fetch();
  const humans = [...members.values()].filter((m) => !m.user.bot);
  const map = await lykodexUserIdsFor(humans.map((m) => m.id));
  return humans
    .filter((m) => map.has(m.id))
    .map((m) => ({ discordId: m.id, userId: map.get(m.id), member: m }));
}
