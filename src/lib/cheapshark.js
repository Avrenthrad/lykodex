import { API_BASE } from "./apiBase";
// Client-side helper for CheapShark data.
// Talks to our own /api/pricing serverless function (service=cheapshark,
// see api/pricing.js) — CheapShark blocks direct browser requests via
// CORS, confirmed by real testing.
//
// CheapShark's role has been deliberately narrowed: it's no longer the
// primary way games get found (that's Steam's own search now — see
// lib/steam.js searchSteamGames), only the source for the 3 stores
// with no API of their own (GOG, Epic Games Store, Humble Bundle).
// Games are looked up by their exact Steam App ID (CheapShark supports
// this directly) instead of fuzzy title matching, which is both more
// precise and cuts CheapShark's share of the workload down to just
// what's actually needed from it.

const BASE_URL = `${API_BASE}/api/pricing?service=cheapshark`;

// Store IDs (e.g. 1 = Steam) only make sense once mapped to a name —
// fetch that list once and reuse it for every game we look up.
let storeNameCache = null;

export async function getStoreNames() {
  if (storeNameCache) return storeNameCache;

  const res = await fetch(`${BASE_URL}&endpoint=stores`);
  if (!res.ok) throw new Error("Failed to load CheapShark store list");
  const stores = await res.json();

  storeNameCache = {};
  stores.forEach((s) => {
    storeNameCache[s.storeID] = s.storeName;
  });
  return storeNameCache;
}

// Fallback only — used when a game isn't found on Steam at all (some
// DLC and non-Steam titles), since that's the one case CheapShark's
// own title search is still needed for.
async function searchGamesByTitle(title, pageSize = 1) {
  const url = `${BASE_URL}&endpoint=games&title=${encodeURIComponent(title)}&pageSize=${pageSize}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.upstreamBody || body.error || `HTTP ${res.status}`;
    throw new Error(`CheapShark search failed for "${title}": ${detail}`);
  }
  return res.json();
}

// The precise path — given a Steam App ID (from Steam's own search),
// find CheapShark's matching record for it directly.
async function searchGamesBySteamAppId(steamAppID) {
  const url = `${BASE_URL}&endpoint=games&steamAppID=${steamAppID}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.upstreamBody || body.error || `HTTP ${res.status}`;
    throw new Error(`CheapShark steamAppID lookup failed: ${detail}`);
  }
  return res.json();
}

async function getGameDetails(gameID) {
  const res = await fetch(`${BASE_URL}&endpoint=games&id=${gameID}`);
  if (!res.ok) throw new Error(`CheapShark details failed for game ${gameID}`);
  return res.json();
}

// Shared by every lookup path below — turns one raw CheapShark match
// into the normalized shape every card in the app expects.
async function buildDealFromMatch(match, storeNames) {
  const details = await getGameDetails(match.gameID);

  const stores = details.deals
    .map((deal) => ({
      store: storeNames[deal.storeID] || `Store #${deal.storeID}`,
      price: parseFloat(deal.price),
      rrp: parseFloat(deal.retailPrice),
      dealID: deal.dealID,
    }))
    .sort((a, b) => a.price - b.price);

  if (stores.length === 0) return null;

  const lowestEver = details.cheapestPriceEver;

  return {
    game: details.info.title,
    thumb: details.info.thumb || match.thumb || null,
    stores,
    lowest: parseFloat(lowestEver.price),
    lowestDate: lowestEver.date
      ? new Date(lowestEver.date * 1000).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
      : "—",
    steamAppID: match.steamAppID || null,
  };
}

// Given a Steam App ID (already resolved via Steam's own search), get
// back one normalized deal object. Falls back to null (not an error)
// if CheapShark simply doesn't track that title on GOG/Epic/Humble —
// that's a normal outcome, not a failure.
export async function fetchDealBySteamAppId(steamAppID) {
  const results = await searchGamesBySteamAppId(steamAppID);
  const match = results[0];
  if (!match) return null;
  const storeNames = await getStoreNames();
  return buildDealFromMatch(match, storeNames);
}

// Fallback path for titles Steam's search didn't find at all (some
// DLC, delisted games, etc.) — only hits CheapShark's title search,
// which is otherwise avoided.
export async function fetchDealByTitle(title) {
  const results = await searchGamesByTitle(title, 1);
  const match = results[0];
  if (!match) return null;
  const storeNames = await getStoreNames();
  return buildDealFromMatch(match, storeNames);
}

// Real current top discounts across every CheapShark-tracked store —
// used on the Current Sales page. Unrelated to the search/matching
// changes above; this genuinely needs CheapShark's own deals feed.
export async function fetchTopDeals(limit = 6) {
  const url = `${BASE_URL}&endpoint=deals&sortBy=Savings&pageSize=${limit}&onSale=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load top deals");
  const deals = await res.json();
  const storeNames = await getStoreNames();

  return deals
    .map((d) => ({
      title: d.title,
      thumb: d.thumb,
      steamAppID: d.steamAppID || null,
      store: storeNames[d.storeID] || `Store #${d.storeID}`,
      price: parseFloat(d.salePrice),
      normalPrice: parseFloat(d.normalPrice),
      savings: Math.round(parseFloat(d.savings)),
      dealID: d.dealID,
    }))
    // A few listings (seen in practice with Epic's free weekly
    // giveaways specifically) come back with missing/malformed price
    // fields from CheapShark rather than real numbers — rather than
    // show "undefinedNaN", skip anything that didn't parse to a real
    // number.
    .filter((d) => Number.isFinite(d.price) && Number.isFinite(d.normalPrice) && Number.isFinite(d.savings));
}
