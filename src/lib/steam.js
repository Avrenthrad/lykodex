// Client-side helper for Steam data.
// Talks to our own /api/steam serverless function (see api/steam.js) —
// Steam blocks direct browser requests, so this proxy is required,
// not just a nice-to-have like it is for CheapShark.

// Steam's public CDN box art — no API key needed, just an appid, and
// no proxy required since these are plain static image URLs (verified
// live: 200 for a real appid, 404 for a bogus one — not a guessed
// shape). Real box art instead of the 32x32 img_icon_url used to be
// the only image available for a game row, which is fine at true icon
// size but was previously stretched up as a "hero" thumbnail.
export function steamLibraryArt(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
}

export function steamHeaderArt(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

import { getCached, setCached, deleteCached, CACHE_TTL } from "./cache";
import { API_BASE } from "./apiBase";

export async function fetchOwnedGames(steamId) {
  const res = await fetch(`${API_BASE}/api/steam?steamid=${encodeURIComponent(steamId)}`);
  if (!res.ok) throw new Error("Failed to load Steam library");
  const data = await res.json();
  return data.response?.games || [];
}

export async function fetchAchievements(steamId, appId) {
  const res = await fetch(`${API_BASE}/api/steam?steamid=${encodeURIComponent(steamId)}&appid=${appId}`);
  if (!res.ok) throw new Error("Failed to load Steam achievements");
  const data = await res.json();
  return data.playerstats?.achievements || [];
}

// Public endpoint — no Steam account needed, just an appid.
export async function fetchCurrentPlayers(appId) {
  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=players`);
  if (!res.ok) throw new Error("Failed to load Steam player count");
  const data = await res.json();
  return data.response?.player_count ?? null;
}

// Top played games (rank + appid + player counts). Names aren't
// included by Steam here — resolveGameName below fills those in for
// however many rows you actually display (calling it for all ~100
// would be slow, so only resolve the slice you're rendering).
export async function fetchTopPlayedGames() {
  const res = await fetch(`${API_BASE}/api/steam?mode=charts`);
  if (!res.ok) throw new Error("Failed to load Steam charts");
  const data = await res.json();
  return data.response?.ranks || [];
}

// Cached 24h — game metadata (name, release date, genres, scores)
// barely changes day to day, and Hype Charts alone calls this up to
// 100 times per load once expanded to the full top 100.
export async function resolveGameName(appId) {
  const cacheKey = `gd-appinfo:${appId}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  // A missing name is a failed lookup, including the appdetails key
  // mismatch that used to cache { name: null } for 24h. Treat that as
  // a miss and drop it so the next load can resolve the real title.
  if (cached?.name) return cached;
  if (cached !== undefined) deleteCached(cacheKey);

  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=appinfo`);
  if (!res.ok) throw new Error(`Failed to resolve name for appid ${appId}`);
  const data = await res.json(); // { name, thumb, releaseDate, comingSoon, metacriticScore, metacriticUrl, genres, steamAuPrice } or { name: null }

  if (data?.name) setCached(cacheKey, data);
  return data;
}

// Cached 24h — the human-readable achievement list for a game barely
// ever changes.
export async function fetchAchievementSchema(appId) {
  const cacheKey = `gd-achschema:${appId}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=achievementSchema`);
  if (!res.ok) throw new Error(`Failed to load achievement schema for appid ${appId}`);
  const data = await res.json();
  const list = data.game?.availableGameStats?.achievements || [];

  setCached(cacheKey, list);
  return list; // [{ name (apiname), displayName, description, icon, icongray }, ...]
}

// Cached 24h — global unlock rarity shifts slowly.
export async function fetchGlobalAchievementPercentages(appId) {
  const cacheKey = `gd-achpct:${appId}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=globalAchievementPercentages`);
  if (!res.ok) throw new Error(`Failed to load global achievement percentages for appid ${appId}`);
  const data = await res.json();
  const list = data.achievementpercentages?.achievements || [];

  setCached(cacheKey, list);
  return list; // [{ name (apiname), percent }, ...]
}

// A person's real Steam friends — only works if their friends list is
// public. Returns just the raw relationship data (steamid + since
// date); use fetchPlayerSummaries to get names/avatars/live status.
export async function fetchFriendList(steamId) {
  const res = await fetch(`${API_BASE}/api/steam?steamid=${steamId}&mode=friendList`);
  if (!res.ok) throw new Error("Failed to load Steam friends list");
  const data = await res.json();
  return data.friendslist?.friends || [];
}

// Live status for up to 100 people at once — online/offline, and
// what they're currently playing if anything. This is real-time, not
// cached, since "currently playing" would go stale almost immediately.
export async function fetchPlayerSummaries(steamIds) {
  if (steamIds.length === 0) return [];
  const res = await fetch(`${API_BASE}/api/steam?steamids=${steamIds.join(",")}&mode=playerSummaries`);
  if (!res.ok) throw new Error("Failed to load player summaries");
  const data = await res.json();
  return data.response?.players || [];
}

export async function fetchReviewSummary(appId) {
  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=reviews`);
  if (!res.ok) throw new Error(`Failed to load reviews for appid ${appId}`);
  return res.json(); // { scoreDesc, totalPositive, totalNegative, totalReviews } or { scoreDesc: null }
}

// Steam's own search — the primary way games get found now, instead
// of leaning on CheapShark for it (CheapShark is reserved for the 3
// stores that actually need it: GOG, Epic, Humble).
export async function searchSteamGames(term) {
  const res = await fetch(`${API_BASE}/api/steam?term=${encodeURIComponent(term)}&mode=search`);
  if (!res.ok) throw new Error(`Steam search failed for "${term}"`);
  const data = await res.json();
  return data.items || []; // [{ id (appid), name, tiny_image }, ...]
}
export async function resolveVanityUrl(vanity) {
  const res = await fetch(`${API_BASE}/api/steam?vanity=${encodeURIComponent(vanity)}&mode=resolveVanity`);
  if (!res.ok) throw new Error("Failed to resolve Steam profile");
  return res.json(); // { success, steamid } — success is 1 on a match
}

// Only works if the wishlist is set to public on Steam.
export async function fetchWishlist(steamId) {
  const res = await fetch(`${API_BASE}/api/steam?steamid=${steamId}&mode=wishlist`);
  if (!res.ok) throw new Error("Failed to load Steam wishlist — make sure it's set to public");
  const data = await res.json();
  return data?.items || [];
}

// The real, reachable equivalent of Steam's own "Personal Calendar" —
// that page (store.steampowered.com/personalcalendar) requires the
// visitor's own logged-in Steam session and can't be reached from a
// server-side API key (verified live: an unauthenticated request 302s
// straight to /login, no public-steamid path exists like there is for
// the wishlist page). This cross-references two endpoints Steam does
// expose publicly instead: the wishlist itself, then each wishlisted
// game's real release_date from Steam's own store API via
// resolveGameName (already 24h-cached) — the same underlying data
// Steam's calendar draws from, just assembled from the pieces we can
// legitimately reach. Capped at `limit` wishlist items (oldest-added
// first isn't guaranteed here, so this is "your first N wishlisted
// games", not "your soonest N") to keep this to a bounded number of
// appinfo calls per load.
export async function fetchWishlistUpcoming(steamId, limit = 40) {
  const items = await fetchWishlist(steamId);
  const infos = await Promise.all(
    items.slice(0, limit).map((item) =>
      resolveGameName(item.appid)
        .then((info) => ({ ...info, appid: item.appid }))
        .catch(() => null)
    )
  );
  return infos
    .filter((info) => info?.comingSoon && info.releaseDate && !Number.isNaN(Date.parse(info.releaseDate)))
    .map((info) => ({ appid: info.appid, name: info.name, releaseDate: info.releaseDate }))
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
}

// Real, official dev-posted news for one app — patch notes, beta
// access, preorder/launch announcements, whatever the developer
// actually posted to their Steam Community hub. Public, no key
// needed. Not a general gaming-news aggregator (no honest free source
// for that was found) — scoped to games a person actually tracks.
export async function fetchNewsForApp(appId, count = 5) {
  const res = await fetch(`${API_BASE}/api/steam?appid=${appId}&mode=news&count=${count}`);
  if (!res.ok) throw new Error("Failed to load news for this game");
  const data = await res.json();
  return (data.newsitems || []).map((item) => ({
    id: item.gid,
    title: item.title,
    url: item.url,
    author: item.author,
    contents: item.contents,
    feedLabel: item.feedlabel,
    date: item.date ? new Date(item.date * 1000).toISOString() : null,
  }));
}

// Accepts a raw SteamID64, a full profile URL (either /profiles/ID or
// /id/vanityname), or just a vanity name, and resolves it down to a
// real SteamID64 ready for fetchWishlist.
export async function resolveSteamIdInput(input) {
  const trimmed = input.trim();

  const profileIdMatch = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileIdMatch) return profileIdMatch[1];

  if (/^\d{17}$/.test(trimmed)) return trimmed;

  const vanityUrlMatch = trimmed.match(/steamcommunity\.com\/id\/([^/]+)/);
  const vanity = vanityUrlMatch ? vanityUrlMatch[1] : trimmed;

  const resolved = await resolveVanityUrl(vanity);
  if (resolved.success !== 1) return null;
  return resolved.steamid;
}
