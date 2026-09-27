// Client-side helper for RAWG's real game database (upcoming releases,
// DLC/expansions, genres, platforms). See api/rawg.js for field-name
// verification notes and the attribution requirement.
//
// One honest gap: RAWG's general /games list endpoint doesn't cleanly
// expose "is this specific result a DLC/addition" — it only has a
// documented exclude_additions toggle to filter them OUT entirely.
// So general browse only offers New Games / Everything as the release
// type, not a standalone "DLC only" view — reliable per-title DLC
// data only exists via the per-game /additions endpoint, which is
// what the personalized (logged-in) path uses against the person's
// own wishlist/library/backlog titles instead of guessing at scale.
//
// RAWG's free tier is 20,000 requests/month total across every
// Lykodex user sharing this one key, so search results (the highest-
// traffic call — every Backlog "add from any platform" search and
// every DLC lookup goes through it) are cached the same way
// xbxprices.js caches its own tighter 1,000/month quota: by
// normalized query, "no_key" results deliberately never cached so
// adding a real key later takes effect immediately instead of
// waiting out a stale TTL.

import { API_BASE } from "./apiBase";
import { getCached, setCached, CACHE_TTL } from "./cache";

export async function fetchRawgPlatforms() {
  const cacheKey = "gd-rawg-platforms";
  const cached = getCached(cacheKey, CACHE_TTL.ONE_WEEK);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?mode=platforms`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";
  const list = data.results || [];
  setCached(cacheKey, list);
  return list; // [{ id, name }, ...]
}

export async function fetchRawgGenres() {
  const cacheKey = "gd-rawg-genres";
  const cached = getCached(cacheKey, CACHE_TTL.ONE_WEEK);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?mode=genres`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";
  const list = data.results || [];
  setCached(cacheKey, list);
  return list; // [{ id, name }, ...]
}

export async function fetchUpcomingReleases({ dateFrom, dateTo, platformId, genreId, excludeAdditions, page = 1 }) {
  const params = new URLSearchParams({ mode: "upcoming", dateFrom, dateTo });
  if (platformId) params.set("platforms", platformId);
  if (genreId) params.set("genres", genreId);
  if (excludeAdditions) params.set("excludeAdditions", "true");
  if (page > 1) params.set("page", String(page));

  // Every filter is already folded into params.toString(), so two
  // people (or the same person re-opening the page) browsing the same
  // date/platform/genre/page combo share one cached result instead of
  // each spending their own request on it.
  const cacheKey = `gd-rawg-upcoming:${params.toString()}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  // Older entries were a bare array and had no next/previous, so they
  // can't drive pagination. Ignore them and refetch.
  if (cached !== undefined && !Array.isArray(cached)) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?${params.toString()}`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";

  // Deliberately not attempting to flag which of these results are
  // DLC/additions individually — RAWG's general list response doesn't
  // cleanly expose that per-entry, only the confirmed
  // exclude_additions toggle for filtering them out entirely. Rather
  // than guess, "Release type" in the browse UI only offers New
  // Games / Everything — reliable "is this DLC" data only exists
  // per-game via /additions, used by the personalized path below.
  const list = (data.results || []).map((g) => ({
    id: g.id,
    name: g.name,
    released: g.released,
    backgroundImage: g.background_image,
    metacritic: g.metacritic,
    platforms: (g.platforms || []).map((p) => p.platform?.name).filter(Boolean),
  }));
  const payload = {
    results: list,
    page,
    hasNext: Boolean(data.next),
    hasPrevious: Boolean(data.previous) || page > 1,
  };
  setCached(cacheKey, payload);
  return payload;
}

export async function searchRawgGame(title) {
  const cacheKey = `gd-rawg-search1:${title.trim().toLowerCase()}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?mode=search&q=${encodeURIComponent(title)}`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";
  const match = data.results?.[0] || null; // best match, or null
  setCached(cacheKey, match);
  return match;
}

// Up to 20 matches, each with its real list of platforms (from RAWG's
// own catalog, not guessed) — powers Backlog's "add from any
// platform" search, since Steam's own search only ever finds Steam
// titles and misses anything console-exclusive. This is the single
// highest-traffic RAWG call in the app (every Backlog search goes
// through it), so it's the one most worth caching.
export async function searchRawgGames(title) {
  const cacheKey = `gd-rawg-searchN:${title.trim().toLowerCase()}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?mode=search&q=${encodeURIComponent(title)}`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";
  const list = (data.results || []).map((g) => ({
    id: g.id,
    name: g.name,
    backgroundImage: g.background_image,
    metacritic: g.metacritic,
    platforms: (g.platforms || []).map((p) => p.platform?.name).filter(Boolean),
  }));
  setCached(cacheKey, list);
  return list;
}

export async function fetchAdditionsForGame(gameId) {
  const cacheKey = `gd-rawg-additions:${gameId}`;
  const cached = getCached(cacheKey, CACHE_TTL.ONE_DAY);
  if (cached !== undefined) return cached;

  const res = await fetch(`${API_BASE}/api/rawg?mode=additions&gameId=${gameId}`);
  const data = await res.json();
  if (data.error === "no_key") return "no_key";
  const list = (data.results || []).map((g) => ({
    id: g.id,
    name: g.name,
    released: g.released,
    backgroundImage: g.background_image,
    tba: g.tba,
  }));
  setCached(cacheKey, list);
  return list;
}

function normalizeRawgPlatforms(game) {
  return (game?.platforms || []).map((p) => p.platform?.name).filter(Boolean);
}

function matchesDlcQuery(name, query) {
  const normalizedName = name.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedName || !normalizedQuery) return false;
  if (normalizedName.includes(normalizedQuery)) return true;
  return normalizedQuery.split(/\s+/).every((word) => normalizedName.includes(word));
}

// Backlog search — base games plus DLC/expansions from RAWG's real
// /additions endpoint. Also checks DLC for titles already in the
// person's backlog so "Phantom Liberty" can be found even when only
// Cyberpunk 2077 is tracked.
export async function searchRawgGamesAndDlc(query, backlogTitles = []) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const baseResults = await searchRawgGames(trimmed);
  if (baseResults === "no_key") return "no_key";

  const seen = new Set();
  const merged = [];

  function pushResult(result) {
    if (seen.has(result.id)) return;
    seen.add(result.id);
    merged.push(result);
  }

  for (const result of baseResults) {
    pushResult({ ...result, isDlc: false, parentTitle: null });
  }

  async function collectAdditions(parentName, parentPlatforms, parentId) {
    const additions = await fetchAdditionsForGame(parentId);
    if (additions === "no_key") return;
    for (const addition of additions) {
      if (!matchesDlcQuery(addition.name, trimmed)) continue;
      pushResult({
        id: addition.id,
        name: addition.name,
        backgroundImage: addition.backgroundImage,
        metacritic: null,
        platforms: parentPlatforms,
        isDlc: true,
        parentTitle: parentName,
      });
    }
  }

  for (const parent of baseResults.slice(0, 5)) {
    await collectAdditions(parent.name, parent.platforms, parent.id);
  }

  const parentTitles = [...new Set(backlogTitles.map((title) => title.trim()).filter(Boolean))].slice(0, 10);
  for (const title of parentTitles) {
    const match = await searchRawgGame(title);
    if (match === "no_key" || !match?.id) continue;
    await collectAdditions(match.name, normalizeRawgPlatforms(match), match.id);
  }

  merged.sort((a, b) => {
    const queryLower = trimmed.toLowerCase();
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aExact = aName === queryLower ? 1 : 0;
    const bExact = bName === queryLower ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aContains = aName.includes(queryLower) ? 1 : 0;
    const bContains = bName.includes(queryLower) ? 1 : 0;
    if (aContains !== bContains) return bContains - aContains;
    if (a.isDlc !== b.isDlc) return a.isDlc ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return merged.slice(0, 20);
}

// For logged-in users: cross-references their own games (wishlist +
// library + backlog titles, already deduplicated by the caller)
// against RAWG to find upcoming DLC/expansions specifically for
// titles they actually own or care about — much more reliable than
// trying to guess at DLC across the whole general catalog.
export async function fetchUpcomingDlcForTitles(titles) {
  const uniqueTitles = [...new Set(titles)];
  const results = await Promise.all(
    uniqueTitles.map(async (title) => {
      try {
        const match = await searchRawgGame(title);
        if (match === "no_key" || !match) return [];
        const additions = await fetchAdditionsForGame(match.id);
        if (additions === "no_key") return [];
        return additions
          .filter((a) => a.tba || (a.released && new Date(a.released) >= new Date()))
          .map((a) => ({ ...a, parentTitle: title }));
      } catch (err) {
        console.error(`DLC lookup failed for "${title}":`, err);
        return [];
      }
    })
  );
  return results.flat().sort((a, b) => new Date(a.released || "9999-12-31") - new Date(b.released || "9999-12-31"));
}
