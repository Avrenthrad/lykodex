// Ordered Steam cover URLs, plus a rate-limited lookup of the real
// header_image. Static CDN files are free; store.steampowered.com/api/appdetails
// is not — Steam 429s a burst of those — so the image component only
// calls fetchSteamHeaderImage after the static chain misses, and that
// call goes through the existing /api/steam?mode=appinfo proxy, which
// resolveGameName already caches for 24h.

import { getCached, setCached, deleteCached, CACHE_TTL } from "./cache.js";

const CDN = "https://cdn.akamai.steamstatic.com/steam/apps";

export function steamLibraryArt(appid) {
  return `${CDN}/${appid}/library_600x900.jpg`;
}

export function steamHeaderArt(appid) {
  return `${CDN}/${appid}/header.jpg`;
}

export function steamHeroArt(appid) {
  return `${CDN}/${appid}/library_hero.jpg`;
}

export function steamCapsuleArt(appid) {
  return `${CDN}/${appid}/capsule_616x353.jpg`;
}

const ART_TTL = CACHE_TTL.ONE_WEEK;
const MAX_HEADER_LOOKUPS = 2;

let activeLookups = 0;
const lookupQueue = [];
const headerLookups = new Map();

function normalizeAppId(appid) {
  if (appid == null || appid === "") return null;
  const id = String(appid).trim();
  if (!/^\d+$/.test(id) || id === "0") return null;
  return id;
}

function uniqueUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function staticUrls(appid, variant) {
  const header = steamHeaderArt(appid);
  const hero = steamHeroArt(appid);
  const capsule = steamCapsuleArt(appid);
  const portrait = steamLibraryArt(appid);
  // Wide frames want library_hero first: it's the file that still
  // exists when the legacy header has moved to a hashed path, and it's
  // the resolution a 16/7 hero actually needs. Thumbs try the small
  // header first so a library of older games doesn't download a 1920px
  // banner for an 80px slot.
  if (variant === "hero") return [hero, header, capsule, portrait];
  return [header, hero, capsule, portrait];
}

export function steamArtCandidates(appid, { variant = "header", preferred = [] } = {}) {
  const id = normalizeAppId(appid);
  return uniqueUrls([...preferred, ...(id ? staticUrls(id, variant) : [])]);
}

function artCacheKey(appid, variant) {
  return `gd-steam-art:${variant}:${appid}`;
}

export function readCachedSteamArt(appid, variant = "header") {
  const id = normalizeAppId(appid);
  if (!id) return null;
  const url = getCached(artCacheKey(id, variant), ART_TTL);
  return typeof url === "string" && url ? url : null;
}

export function writeCachedSteamArt(appid, variant, url) {
  const id = normalizeAppId(appid);
  if (!id || !url) return;
  setCached(artCacheKey(id, variant), url);
}

export function clearCachedSteamArt(appid, variant = "header") {
  const id = normalizeAppId(appid);
  if (!id) return;
  deleteCached(artCacheKey(id, variant));
}

export function readCachedSteamHeader(appid) {
  const id = normalizeAppId(appid);
  if (!id) return null;
  const info = getCached(`gd-appinfo:${id}`, CACHE_TTL.ONE_DAY);
  return info?.thumb || null;
}

function drainLookups() {
  while (activeLookups < MAX_HEADER_LOOKUPS && lookupQueue.length > 0) {
    const job = lookupQueue.shift();
    activeLookups += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeLookups -= 1;
        drainLookups();
      });
  }
}

function enqueueLookup(task) {
  return new Promise((resolve, reject) => {
    lookupQueue.push({ task, resolve, reject });
    drainLookups();
  });
}

// Real store header (hashed store_item_assets path included). Null when
// Steam has nothing, or the proxy/network failed — callers treat null
// as "try the next image", not as a hard error.
export function fetchSteamHeaderImage(appid) {
  const id = normalizeAppId(appid);
  if (!id) return Promise.resolve(null);

  const cached = readCachedSteamHeader(id);
  if (cached) return Promise.resolve(cached);
  if (headerLookups.has(id)) return headerLookups.get(id);

  const pending = enqueueLookup(async () => {
    try {
      // Loaded lazily so this module doesn't pull steam.js (and
      // import.meta.env) into the unit tests that only check URL order.
      const { resolveGameName } = await import("./steam.js");
      const info = await resolveGameName(id);
      return info?.thumb || null;
    } catch {
      return null;
    }
  });
  headerLookups.set(id, pending);
  return pending;
}
