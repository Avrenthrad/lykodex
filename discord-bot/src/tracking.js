// Opt-in gate + helpers shared by presence and voice tracking.
//
// Nothing about a person is recorded unless they've turned on
// "Discord activity tracking" in Lykodex (profiles.discord_tracking_enabled).
// Cached briefly, so turning it off can take up to CACHE_TTL_MS to apply.
import { supabase } from "./supabase.js";
import { lykodexUserIdFor } from "./links.js";
import { config } from "./config.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const optInCache = new Map(); // userId -> { enabled, steamId, at }

async function trackingProfile(userId) {
  const hit = optInCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const { data, error } = await supabase
    .from("profiles")
    .select("discord_tracking_enabled, linked_steam_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("tracking opt-in lookup failed:", error.message);
    return hit || { enabled: false, steamId: null };
  }
  const entry = { enabled: data?.discord_tracking_enabled === true, steamId: data?.linked_steam_id || null, at: Date.now() };
  optInCache.set(userId, entry);
  return entry;
}

// Discord user -> Lykodex userId, only if they've opted in. Else null.
export async function trackedUserIdFor(discordUserId) {
  const userId = await lykodexUserIdFor(discordUserId);
  if (!userId) return null;
  const { enabled } = await trackingProfile(userId);
  return enabled ? userId : null;
}

export function forgetTrackingCache(userId) {
  optInCache.delete(userId);
}

// ---------- Steam exclusion for PC playtime ----------
// Steam already reports its own playtime, so PC games the person owns
// on Steam are skipped. Their owned-games list is fetched through the
// site's /api/steam proxy and cached for 12h.
const STEAM_CACHE_MS = 12 * 60 * 60 * 1000;
const steamGamesCache = new Map(); // steamId -> { names:Set, at }

export function normalizeGameName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function steamGameNames(steamId) {
  const hit = steamGamesCache.get(steamId);
  if (hit && Date.now() - hit.at < STEAM_CACHE_MS) return hit.names;
  try {
    const res = await fetch(`${config.siteBaseUrl}/api/steam?steamid=${encodeURIComponent(steamId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const names = new Set((data.response?.games || []).map((g) => normalizeGameName(g.name)));
    steamGamesCache.set(steamId, { names, at: Date.now() });
    return names;
  } catch (err) {
    console.error("Steam owned-games fetch failed:", err.message);
    return hit?.names || null; // null = unknown
  }
}

// true if this PC game should NOT be counted (it's in their Steam
// library). If Steam can't be reached we skip counting rather than
// risk double-counting Steam hours.
export async function isOwnedOnSteam(userId, gameName) {
  const { steamId } = await trackingProfile(userId);
  if (!steamId) return false;
  const names = await steamGameNames(steamId);
  if (names === null) return true;
  return names.has(normalizeGameName(gameName));
}
