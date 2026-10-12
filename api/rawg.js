// Vercel serverless function — proxies RAWG's real, official game
// database API (500,000+ games, real release dates per platform,
// genres, DLC/expansion relationships). Confirmed field/param names
// against RAWG's actual API docs (rawg.io/apidocs) rather than
// guessing from marketing copy.
//
// IMPORTANT — RAWG's free tier requires attribution: an active
// hyperlink back to RAWG on every page that shows their data. The
// frontend handles this (see the credit line on UpcomingReleasesPage) —
// don't remove it if you're touching that page.
//
// Usage from the frontend:
//   fetch("/api/rawg?mode=platforms")
//   fetch("/api/rawg?mode=genres")
//   fetch("/api/rawg?mode=upcoming&dateFrom=...&dateTo=...&platforms=...&genres=...&excludeAdditions=true&page=2")
//   fetch("/api/rawg?mode=search&q=...")
//   fetch("/api/rawg?mode=additions&gameId=...")

import { allowCors } from "./_cors.js";

const BASE_URL = "https://api.rawg.io/api";

function pageParam(searchParams) {
  const page = searchParams.get("page");
  return page && /^[1-9]\d*$/.test(page) ? page : null;
}

function withPage(url, searchParams) {
  const page = pageParam(searchParams);
  if (!page) return url;
  return `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
}

export default async function handler(req, res) {
  allowCors(res);
  const apiKey = process.env.RAWG_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: "no_key" });
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const mode = searchParams.get("mode");

  try {
    if (mode === "platforms") {
      const rawgRes = await fetch(withPage(`${BASE_URL}/platforms?key=${apiKey}&page_size=50`, searchParams));
      if (!rawgRes.ok) return res.status(502).json({ error: "Failed to load platforms." });
      const data = await rawgRes.json();
      return res.status(200).json(presentRawg(data, req));
    }

    if (mode === "genres") {
      const rawgRes = await fetch(withPage(`${BASE_URL}/genres?key=${apiKey}&page_size=50`, searchParams));
      if (!rawgRes.ok) return res.status(502).json({ error: "Failed to load genres." });
      const data = await rawgRes.json();
      return res.status(200).json(presentRawg(data, req));
    }

    if (mode === "upcoming") {
      const dateFrom = searchParams.get("dateFrom");
      const dateTo = searchParams.get("dateTo");
      const platforms = searchParams.get("platforms"); // comma-separated RAWG platform IDs
      const genres = searchParams.get("genres"); // comma-separated RAWG genre IDs
      const excludeAdditions = searchParams.get("excludeAdditions");
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: "Missing dateFrom or dateTo query parameter" });
      }

      const params = new URLSearchParams({
        key: apiKey,
        dates: `${dateFrom},${dateTo}`,
        ordering: "released",
        page_size: "40",
      });
      if (platforms) params.set("platforms", platforms);
      if (genres) params.set("genres", genres);
      if (excludeAdditions === "true") params.set("exclude_additions", "true");
      const page = pageParam(searchParams);
      if (page) params.set("page", page);

      const rawgRes = await fetch(`${BASE_URL}/games?${params.toString()}`);
      if (!rawgRes.ok) return res.status(502).json({ error: "Failed to load upcoming games." });
      const data = await rawgRes.json();
      return res.status(200).json(presentRawg(data, req));
    }

    if (mode === "search") {
      const q = searchParams.get("q");
      if (!q) return res.status(400).json({ error: "Missing q query parameter" });
      const rawgRes = await fetch(withPage(`${BASE_URL}/games?key=${apiKey}&search=${encodeURIComponent(q)}&page_size=20`, searchParams));
      if (!rawgRes.ok) return res.status(502).json({ error: "Game search failed." });
      const data = await rawgRes.json();
      return res.status(200).json(presentRawg(data, req));
    }

    if (mode === "additions") {
      const gameId = searchParams.get("gameId");
      if (!gameId) return res.status(400).json({ error: "Missing gameId query parameter" });
      const rawgRes = await fetch(withPage(`${BASE_URL}/games/${encodeURIComponent(gameId)}/additions?key=${apiKey}&page_size=20`, searchParams));
      if (!rawgRes.ok) return res.status(502).json({ error: "Failed to load additions." });
      const data = await rawgRes.json();
      return res.status(200).json(presentRawg(data, req));
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("rawg proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// RAWG puts the server key in next/previous and any other absolute URL
// in the payload. Drop it everywhere, and point pagination back at this
// proxy (same query, swapped page) so the client can page without the key.
export function presentRawg(data, req) {
  const sanitized = stripRawgSecrets(data);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return sanitized;

  for (const field of ["next", "previous"]) {
    if (typeof data?.[field] !== "string") continue;
    sanitized[field] = proxyPageLink(req, data[field]);
  }
  return sanitized;
}

export function stripRawgSecrets(value) {
  if (typeof value === "string") return stripKeyFromUrl(value);
  if (Array.isArray(value)) return value.map(stripRawgSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = stripRawgSecrets(nested);
    }
    return out;
  }
  return value;
}

function stripKeyFromUrl(value) {
  if (!/^https?:\/\//i.test(value) || !/[?&]key=/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!url.searchParams.has("key")) return value;
    url.searchParams.delete("key");
    return url.toString();
  } catch {
    return value;
  }
}

function proxyPageLink(req, rawgLink) {
  try {
    const rawgUrl = new URL(rawgLink);
    const page = rawgUrl.searchParams.get("page");
    const incoming = new URL(req.url, "http://localhost");
    if (page && /^[1-9]\d*$/.test(page)) incoming.searchParams.set("page", page);
    else incoming.searchParams.delete("page");
    incoming.searchParams.delete("key");
    return `${incoming.pathname}?${incoming.searchParams.toString()}`;
  } catch {
    return null;
  }
}
