// Vercel serverless function — merges several pricing-related proxies
// (xbxprices.js, platprices.js, cheapshark.js, currency.js, plus MTG
// pricing: cardkingdom, tcgaggregator, and Rebrickable for LEGO) into
// one file, purely to stay under Vercel's Hobby plan's 12-serverless-
// function limit — /api was already at exactly 12 files when
// Rebrickable was added, so it landed here rather than as its own
// file. No behavior changed for the original services — each keeps
// its own exact logic, just dispatched by ?service= instead of being
// separate files. Same consolidation reasoning as the bungie.js merge.
//
// The lykodex-session service below is genuinely unrelated to pricing
// — it's here purely because this is the file already designated as
// the "merge point to dodge the function-count ceiling," same as
// comicvine/rebrickable before it, not because it belongs here
// conceptually.
//
// Usage from the frontend:
//   fetch("/api/pricing?service=xbxprices&endpoint=search&q=...&region=au")
//   fetch("/api/pricing?service=xbxprices&endpoint=game&ppid=...&region=au")
//   fetch("/api/pricing?service=platprices&name=...")
//   fetch("/api/pricing?service=cheapshark&endpoint=games&title=...")
//   fetch("/api/pricing?service=currency")
//   fetch("/api/pricing?service=cardkingdom&scryfallIds=id1,id2,...")
//   fetch("/api/pricing?service=tcgaggregator&...")
//   fetch("/api/pricing?service=rebrickable&mode=search&q=...")
//   fetch("/api/pricing?service=rebrickable&mode=set&setNum=...")
//   fetch("/api/pricing?service=comicvine&q=...")
//   fetch("/api/pricing?service=riftbound&mode=search&q=...")
//   fetch("/api/pricing?service=riftbound&mode=card&id=...")
//   POST /api/pricing?service=xbox&mode=link, Authorization: Bearer <token>, body {code, redirectUri}
//   POST /api/pricing?service=xbox&mode=gamerscore, Authorization: Bearer <token>
//   POST /api/pricing?service=xbox&mode=presence, Authorization: Bearer <token>
//   POST /api/pricing?service=xbox&mode=library, Authorization: Bearer <token>
//   POST /api/pricing?service=xbox&mode=wishlist, Authorization: Bearer <token>
//   POST /api/pricing?service=xbox&mode=achievements, Authorization: Bearer <token>, body {titleId}
//   POST /api/pricing?service=psn&mode=link, Authorization: Bearer <token>, body {npsso}
//   POST /api/pricing?service=psn&mode=trophies, Authorization: Bearer <token>
//   POST /api/pricing?service=psn&mode=presence, Authorization: Bearer <token>
//   POST /api/pricing?service=psn&mode=library, Authorization: Bearer <token>
//   POST /api/pricing?service=psn&mode=wishlist, Authorization: Bearer <token>
//   POST /api/pricing?service=psn&mode=trophy-titles, Authorization: Bearer <token>
//   POST /api/pricing?service=psn&mode=title-trophies, Authorization: Bearer <token>, body {npCommunicationId, npServiceName}
//   POST /api/pricing?service=lykodex-session, Authorization: Bearer <caller's access token>
//   GET  /api/pricing?service=mastery-cron, Authorization: Bearer <CRON_SECRET> (Vercel Cron only, see vercel.json)

import { allowCors } from "./_cors.js";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { computeXboxScore, computePsScore, computeSteamScore, computeMasteryScore, accountXpFromMastery, levelFromXp } from "../src/lib/gameMastery.js";
import { computeOverallScore } from "../src/lib/overallMastery.js";

const XBXPRICES_BASE = "https://xbxprices.com/api/v2";
const CHEAPSHARK_ALLOWED_ENDPOINTS = ["games", "deals", "stores"];

async function handleXbxprices(searchParams, res) {
  const personalKey = searchParams.get("personalKey");
  const apiKey = personalKey || process.env.XBXPRICES_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });

  const endpoint = searchParams.get("endpoint");
  const region = searchParams.get("region") || "au";

  try {
    let url;
    if (endpoint === "search") {
      const q = searchParams.get("q");
      if (!q) return res.status(400).json({ error: "Missing q query parameter" });
      url = `${XBXPRICES_BASE}/games/search?q=${encodeURIComponent(q)}&region=${region}`;
    } else if (endpoint === "game") {
      const ppid = searchParams.get("ppid");
      if (!ppid) return res.status(400).json({ error: "Missing ppid query parameter" });
      url = `${XBXPRICES_BASE}/games/${ppid}?region=${region}`;
    } else {
      return res.status(400).json({ error: "Missing or invalid endpoint parameter" });
    }

    const xbxRes = await fetch(url, { headers: { "X-API-Key": apiKey } });
    const data = await xbxRes.json();
    if (!xbxRes.ok) {
      console.error("pricing (xbxprices): upstream error", { url, status: xbxRes.status, data });
      return res.status(xbxRes.status).json({ error: "XBXprices request failed", upstream: data });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error("pricing (xbxprices): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

async function handlePlatprices(searchParams, res) {
  const name = searchParams.get("name");
  const personalKey = searchParams.get("personalKey");
  const apiKey = personalKey || process.env.PLATPRICES_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });
  if (!name) return res.status(400).json({ error: "Missing name query parameter" });

  try {
    const url = `https://platprices.com/api.php?key=${apiKey}&name=${encodeURIComponent(name)}&region=au`;
    const ppRes = await fetch(url);
    if (!ppRes.ok) return res.status(ppRes.status).json({ error: "PlatPrices API request failed" });
    const data = await ppRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleCheapshark(searchParams, res) {
  const endpoint = searchParams.get("endpoint");
  if (!endpoint || !CHEAPSHARK_ALLOWED_ENDPOINTS.includes(endpoint)) {
    console.error("pricing (cheapshark): bad endpoint", { endpoint });
    return res.status(400).json({ error: "Missing or invalid endpoint parameter", received: endpoint || null });
  }

  // Strip the routing params so only CheapShark's own real params
  // pass through to the upstream URL.
  searchParams.delete("endpoint");
  searchParams.delete("service");
  const query = searchParams.toString();
  const url = `https://www.cheapshark.com/api/1.0/${endpoint}${query ? `?${query}` : ""}`;

  try {
    const csRes = await fetch(url, {
      headers: { "User-Agent": "Lykodex/1.0 (+https://lykodex.vercel.app)", "Accept": "application/json" },
    });
    if (!csRes.ok) {
      const bodyText = await csRes.text().catch(() => "");
      console.error("pricing (cheapshark): upstream request failed", { url, status: csRes.status, body: bodyText.slice(0, 500) });
      return res.status(csRes.status).json({ error: "CheapShark request failed", upstreamStatus: csRes.status, upstreamBody: bodyText.slice(0, 500) });
    }
    const data = await csRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("pricing (cheapshark): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- Card Kingdom (real public MTG singles pricelist, no key needed) ----------
// Verified live: https://api.cardkingdom.com/api/pricelist returns a
// real, public, ~45MB JSON pricelist covering Card Kingdom's actual
// MTG singles inventory, each entry carrying a real scryfall_id — no
// fuzzy name matching needed. Confirmed real field names by fetching
// it directly, not guessed. This does NOT include sealed product —
// checked the data for booster/box entries and found none; sealed
// pricing isn't available through this feed, so this project doesn't
// claim it.
//
// The file is too large to fetch+parse on every single card lookup,
// so it's cached in this function's own memory (persists across warm
// invocations on Vercel, not across cold starts) for 12h — retail
// prices don't move meaningfully faster than that, and this is a
// shared cache serving every user's lookups, not per-user.
const CARD_KINGDOM_URL = "https://api.cardkingdom.com/api/pricelist";
const CARD_KINGDOM_TTL_MS = 12 * 60 * 60 * 1000;
let ckCache = null; // { byScryfallId: Map<string, Array<entry>>, fetchedAt: number, asOf: string }

async function loadCardKingdomIndex() {
  if (ckCache && Date.now() - ckCache.fetchedAt < CARD_KINGDOM_TTL_MS) return ckCache;

  const ckRes = await fetch(CARD_KINGDOM_URL, { headers: { "User-Agent": "Lykodex/1.0 (+https://lykodex.vercel.app)" } });
  if (!ckRes.ok) throw new Error(`Card Kingdom pricelist request failed (${ckRes.status})`);
  const json = await ckRes.json();

  const byScryfallId = new Map();
  for (const entry of json.data || []) {
    if (!entry.scryfall_id) continue;
    const trimmed = {
      name: entry.name,
      variation: entry.variation,
      edition: entry.edition,
      isFoil: entry.is_foil === "true",
      priceRetail: entry.price_retail !== null && entry.price_retail !== "" ? Number(entry.price_retail) : null,
      qtyRetail: entry.qty_retail,
      url: entry.url ? `https://www.cardkingdom.com/${entry.url}` : null,
    };
    const list = byScryfallId.get(entry.scryfall_id) || [];
    list.push(trimmed);
    byScryfallId.set(entry.scryfall_id, list);
  }

  ckCache = { byScryfallId, fetchedAt: Date.now(), asOf: json.meta?.created_at || null };
  return ckCache;
}

async function handleCardKingdom(searchParams, res) {
  const idsParam = searchParams.get("scryfallIds");
  if (!idsParam) return res.status(400).json({ error: "Missing scryfallIds query parameter" });
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 75);

  try {
    const index = await loadCardKingdomIndex();
    const results = {};
    for (const id of ids) {
      const entries = index.byScryfallId.get(id);
      if (entries) results[id] = entries;
    }
    return res.status(200).json({ asOf: index.asOf, results });
  } catch (err) {
    console.error("pricing (cardkingdom): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- Multi-game TCG aggregator (Pokemon/Yu-Gi-Oh/One Piece/Riftbound) ----------
// No specific real provider has been named or verified for this yet.
// This project's own hard rule is to never guess an API's real
// endpoint/field names (learned from a real Fortnite pricing bug
// earlier in this project) — so rather than wire a fabricated
// integration against a made-up shape, this stays an honest
// "not configured" response even once TCGAPI_KEY is set, until a real
// provider is named and its docs are actually verified against a live
// response the way cardkingdom above was.
async function handleTcgAggregator(res) {
  const apiKey = process.env.TCGAPI_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });
  return res.status(200).json({
    error: "not_configured",
    message: "TCGAPI_KEY is set, but no real multi-game pricing provider is wired yet — see handleTcgAggregator in api/pricing.js.",
  });
}

// ---------- JustTCG (real FaB pricing — deferred at launch, same "don't guess" rule as handleTcgAggregator) ----------
// Confirmed real and covering Flesh and Blood (their own homepage FAQ
// names it explicitly among 18 supported games) — genuinely requires
// a key (confirmed live: unauthenticated /v1/cards returns a real 401
// {"error":"API key is required","code":"MISSING_API_KEY"}), sent via
// an `x-api-key` header (confirmed from their own quickstart example),
// not a query param.
//
// Confirmed real response shape from their schema docs: Card has
// {uuid, id, name, game, set, set_name, number, tcgplayerId,
// mtgjsonId, scryfallId, rarity, details, variants[]}, each Variant
// has {uuid, id, printing, condition, price, lastUpdated} — a single
// real `price` number per variant, not a low/mid/high spread like
// Pokémon TCG's TCGplayer data.
//
// NOT wired to a real search call: the exact query parameter names
// for searching cards by name/game (as opposed to looking one up by
// a known id) are not confirmed anywhere accessible without a real
// key — their docs page describes "9 search params" without naming
// them. This project has a real, hard-learned rule against guessing
// an API's endpoint/param shape (a past Fortnite pricing bug came
// from doing exactly that) — same as handleTcgAggregator above, this
// stays an honest "not_configured" once a key is set, until the real
// param names are confirmed against a live authenticated response.
async function handleJustTcg(res) {
  const apiKey = process.env.JUSTTCG_API_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });
  return res.status(200).json({
    error: "not_configured",
    message: "JUSTTCG_API_KEY is set, but the real search parameter names haven't been confirmed against a live response yet — see handleJustTcg in api/pricing.js.",
  });
}

// ---------- Rebrickable (real LEGO set database) ----------
// Confirmed live that Rebrickable genuinely requires authentication —
// a real keyless request to /lego/sets/ returns a real 401 "Authentication
// credentials were not provided." Field names (set_num, name, year,
// theme_id, num_parts, set_img_url) and endpoint shapes
// (/lego/sets/?search=..., /lego/sets/{set_num}/) are confirmed against
// Rebrickable's own real API docs and a community client library's
// README, NOT guessed — but not spot-checked against a real
// authenticated response (no key held while building this), so treat
// the exact field list as the best real information available rather
// than 100% verified, and double check once REBRICKABLE_KEY is set.
const REBRICKABLE_BASE = "https://rebrickable.com/api/v3/lego";

async function handleRebrickable(searchParams, res) {
  const apiKey = process.env.REBRICKABLE_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });

  const mode = searchParams.get("mode");
  const headers = { Authorization: `key ${apiKey}` };

  try {
    if (mode === "search") {
      const q = searchParams.get("q");
      if (!q) return res.status(400).json({ error: "Missing q query parameter" });
      const url = `${REBRICKABLE_BASE}/sets/?search=${encodeURIComponent(q)}&page_size=20&ordering=-year`;
      const rbRes = await fetch(url, { headers });
      if (!rbRes.ok) return res.status(rbRes.status).json({ error: "Rebrickable search failed" });
      const data = await rbRes.json();
      return res.status(200).json(data);
    }

    if (mode === "set") {
      const setNum = searchParams.get("setNum");
      if (!setNum) return res.status(400).json({ error: "Missing setNum query parameter" });
      const url = `${REBRICKABLE_BASE}/sets/${encodeURIComponent(setNum)}/`;
      const rbRes = await fetch(url, { headers });
      if (rbRes.status === 404) return res.status(404).json({ error: "Set not found" });
      if (!rbRes.ok) return res.status(rbRes.status).json({ error: "Rebrickable lookup failed" });
      const data = await rbRes.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("pricing (rebrickable): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- Comic Vine (real, general comics database — all publishers) ----------
// Confirmed live that Comic Vine genuinely requires a key (a real
// unauthenticated request returns a real 401 with a clean
// {"error":"Invalid API Key",...} body) and confirmed via their real
// API documentation (not guessed) that /search issue fields include:
// aliases, api_detail_url, cover_date, date_added, date_last_updated,
// deck, description, has_staff_review, id, image, issue_number, name,
// site_detail_url, store_date, volume. The docs page didn't spell out
// image's own sub-fields, so multiple real candidate keys
// (medium_url/small_url/thumb_url) are tried with fallbacks client-side
// rather than assuming one. Confirmed live: Comic Vine sends no CORS
// headers, so this must be proxied (unlike Discogs) — it's here rather
// than its own file because /api was already at Vercel's 12-function
// cap when this was added.
const COMIC_VINE_BASE = "https://comicvine.gamespot.com/api";

async function handleComicVine(searchParams, res) {
  const apiKey = process.env.COMIC_VINE_KEY;
  if (!apiKey) return res.status(200).json({ error: "no_key" });

  const q = searchParams.get("q");
  if (!q) return res.status(400).json({ error: "Missing q query parameter" });

  try {
    const url = `${COMIC_VINE_BASE}/search/?api_key=${apiKey}&format=json&query=${encodeURIComponent(q)}&resources=issue&limit=10`;
    const cvRes = await fetch(url, { headers: { "User-Agent": "Lykodex/1.0 (+https://lykodex.vercel.app)" } });
    if (!cvRes.ok) return res.status(cvRes.status).json({ error: "Comic Vine request failed" });
    const data = await cvRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("pricing (comicvine): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- Riftbound (real card data via Riftcodex, community API) ----------
// Confirmed live: api.riftcodex.com sends no CORS headers at all
// (unlike its TCG-College neighbors YGOPRODeck and optcgapi.com, both
// of which send Access-Control-Allow-Origin: * and so are called
// directly from lib/yugioh.js/lib/onepiece.js with no proxy) — so this
// one has to be proxied. Confirmed real endpoints against a live
// response, not guessed: GET /cards/name?fuzzy=<query> for search, GET
// /cards/{id} for a single lookup by Riftcodex's own real id. No real
// pricing field exists on the card object (has a tcgplayer_id, but no
// embedded price) — same honest situation Flesh and Blood is in.
//
// Confirmed live: Riftcodex (Cloudflare-fronted) returns a real 403 to
// requests actually originating from Vercel's infrastructure, while
// identical requests from elsewhere succeed. Tried the same
// User-Agent fix that resolves this for Card Kingdom/Comic Vine above
// — confirmed live (retested against the real deployed endpoint,
// several minutes after deploy) that it does NOT fix this one, so
// this is very likely an IP/ASN-range block on Vercel's egress IPs
// specifically, not a header-based bot check — a header can't route
// around that. This service is currently NON-FUNCTIONAL in production
// as a result (works fine calling api.riftcodex.com directly from
// outside Vercel, which is how it was verified while building this).
// Real remaining options, none attempted yet: ask Riftcodex
// (support@riftcodex.com, per its own OpenAPI contact) to allowlist
// Vercel's ranges; proxy through a non-Vercel host instead; or proxy
// through a Cloudflare Worker (Riftcodex is also Cloudflare-fronted,
// so that path may not trip the same block — unverified guess, not
// confirmed).
const RIFTCODEX_BASE = "https://api.riftcodex.com";
const RIFTCODEX_HEADERS = { Accept: "application/json", "User-Agent": "Lykodex/1.0 (+https://lykodex.vercel.app)" };

async function handleRiftbound(searchParams, res) {
  const mode = searchParams.get("mode");

  try {
    if (mode === "search") {
      const q = searchParams.get("q");
      if (!q) return res.status(400).json({ error: "Missing q query parameter" });
      const url = `${RIFTCODEX_BASE}/cards/name?fuzzy=${encodeURIComponent(q)}`;
      const rcRes = await fetch(url, { headers: RIFTCODEX_HEADERS });
      if (!rcRes.ok) {
        const bodyText = await rcRes.text().catch(() => "");
        console.error("pricing (riftbound): search upstream error", { url, status: rcRes.status, body: bodyText.slice(0, 300) });
        return res.status(rcRes.status).json({ error: "Riftbound search failed" });
      }
      const data = await rcRes.json();
      return res.status(200).json(data);
    }

    if (mode === "card") {
      const id = searchParams.get("id");
      if (!id) return res.status(400).json({ error: "Missing id query parameter" });
      const url = `${RIFTCODEX_BASE}/cards/${encodeURIComponent(id)}`;
      const rcRes = await fetch(url, { headers: RIFTCODEX_HEADERS });
      if (rcRes.status === 404) return res.status(404).json({ error: "Card not found" });
      if (!rcRes.ok) {
        const bodyText = await rcRes.text().catch(() => "");
        console.error("pricing (riftbound): card upstream error", { url, status: rcRes.status, body: bodyText.slice(0, 300) });
        return res.status(rcRes.status).json({ error: "Riftbound lookup failed" });
      }
      const data = await rcRes.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("pricing (riftbound): fetch threw", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- Xbox Live (real Gamerscore via Microsoft OAuth + XSTS) ----------
// Real 3-step exchange confirmed against OpenXbox/xbox-webapi-python's
// actual working implementation (not guessed): (1) authorization code
// -> Microsoft OAuth2 token at login.live.com, (2) that access token
// -> an Xbox Live "user token" at user.auth.xboxlive.com, (3) the user
// token -> an XSTS token at xsts.auth.xboxlive.com (this step also
// hands back userhash/xuid/gamertag via DisplayClaims.xui[0]). The
// XSTS token authorizes calls to the real Xbox Live API
// (profile.xboxlive.com) via `Authorization: XBL3.0 x=<userhash>;<token>`.
//
// Tokens are stored server-side only (xbox_tokens table, no RLS
// policies granted — service_role only, same posture as the
// lykodex-session endpoint above) and never sent to the client.
//
// usePublicClient: true for the packaged-app flow (redirect_uri is
// the lykodex://xbox-callback scheme, registered in Azure under
// "Mobile and desktop applications" with "Allow public client flows"
// on — see xboxOAuth.js) — Microsoft rejects that flow outright if a
// client_secret is present at all ("Public clients can't send a
// client secret", confirmed live testing desktop sign-in), since a
// packaged app can't actually keep one confidential. The web flow
// (redirect_uri under the "Web" platform) is a confidential client
// and still requires it. Which one applies has to be remembered per
// stored token (xbox_tokens.is_public_client, set at link time) since
// a later refresh_token request carries no redirect_uri of its own to
// infer this from.
async function xboxOAuthTokenRequest(params, { usePublicClient = false } = {}) {
  // Deliberately the SAME env var lib/xboxOAuth.js reads client-side
  // (VITE_MICROSOFT_CLIENT_ID), not a separate server-only name — the
  // client ID isn't a secret, and Vercel's serverless runtime still
  // has VITE_-prefixed vars in process.env regardless (that prefix
  // only controls what Vite inlines into the browser bundle). Using
  // two different names here was a real bug: the token exchange
  // silently sent client_id="" (process.env.MICROSOFT_CLIENT_ID was
  // never actually set by anyone, since setup instructions only ever
  // said to set VITE_MICROSOFT_CLIENT_ID), which Microsoft correctly
  // rejected as "the client does not exist."
  const clientId = process.env.VITE_MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const body = new URLSearchParams({ ...params, client_id: clientId });
  if (clientSecret && !usePublicClient) body.set("client_secret", clientSecret);
  const res = await fetch("https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Microsoft OAuth token request failed: ${data.error_description || data.error || res.status}`);
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function xboxRequestUserToken(msAccessToken) {
  const res = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
      Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msAccessToken}` },
    }),
  });
  if (!res.ok) throw new Error(`Xbox Live user token request failed (${res.status})`);
  return res.json(); // { Token, DisplayClaims: { xui: [...] } }
}

async function xboxRequestXstsToken(userToken) {
  const res = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
      Properties: { UserTokens: [userToken], SandboxId: "RETAIL" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Xbox Live XSTS authorize failed (${res.status}): ${data?.XErr || ""}`);
  return data; // { Token, DisplayClaims: { xui: [{ xid, uhs, gtg, ... }] } }
}

async function xboxFetchGamerscore(userhash, xstsToken) {
  const res = await fetch("https://profile.xboxlive.com/users/me/profile/settings?settings=Gamerscore,Gamertag", {
    headers: {
      "x-xbl-contract-version": "3",
      Authorization: `XBL3.0 x=${userhash};${xstsToken}`,
    },
  });
  if (!res.ok) throw new Error(`Xbox Live profile request failed (${res.status})`);
  const data = await res.json();
  const settings = data?.profileUsers?.[0]?.settings || [];
  const get = (id) => settings.find((s) => s.id === id)?.value;
  return { gamerscore: Number(get("Gamerscore")) || 0, gamertag: get("Gamertag") || null };
}

// Real refresh-if-needed + fetch, factored out so both the per-user
// endpoint (mode=gamerscore, caller's own bearer token) and the daily
// cron below (service_role, iterating every linked user) share the
// exact same logic — returns "not_linked" / "expired" as sentinel
// strings (rather than throwing) so both callers can render honest,
// specific messages instead of a generic 500.
async function getLiveXboxGamerscore(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("xbox_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let { userhash, xuid, xsts_token: xstsToken } = stored;
  const xstsExpired = new Date(stored.xsts_expires_at).getTime() < Date.now();
  const msExpired = new Date(stored.ms_expires_at).getTime() < Date.now();

  if (xstsExpired) {
    let msAccessToken = stored.ms_access_token;
    let newMsFields = null;
    if (msExpired) {
      if (!stored.ms_refresh_token) return "expired";
      const refreshed = await xboxOAuthTokenRequest({ grant_type: "refresh_token", refresh_token: stored.ms_refresh_token, scope: "Xboxlive.signin Xboxlive.offline_access" }, { usePublicClient: stored.is_public_client });
      msAccessToken = refreshed.access_token;
      newMsFields = {
        ms_access_token: refreshed.access_token,
        ms_refresh_token: refreshed.refresh_token || stored.ms_refresh_token,
        ms_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
    }
    const userTokenResp = await xboxRequestUserToken(msAccessToken);
    const xsts = await xboxRequestXstsToken(userTokenResp.Token);
    const claims = xsts.DisplayClaims.xui[0];
    userhash = claims.uhs;
    xuid = claims.xid;
    xstsToken = xsts.Token;
    await adminClient.from("xbox_tokens").update({
      ...(newMsFields || {}),
      xsts_token: xsts.Token,
      xsts_expires_at: xsts.NotAfter,
      userhash: claims.uhs,
      xuid: claims.xid,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const { gamerscore, gamertag } = await xboxFetchGamerscore(userhash, xstsToken);
  if (gamertag) await adminClient.from("xbox_tokens").update({ gamertag }).eq("user_id", userId);
  return { gamertag: gamertag || stored.gamertag, gamerscore, xuid };
}

// Real live activity confirmed against OpenXbox/xbox-webapi-python's
// actual working implementation — same Authorization header as the
// Gamerscore call above, different endpoint. Real response shape:
// { xuid, state: "Online"|"Offline", lastSeen: { titleName, ... },
// devices: [{ titles: [{ name, activity: [{ richPresence }], state,
// placement }] }] } — devices[].titles filtered to state === "Active"
// is what's actually being played right now, not just owned.
async function xboxFetchPresence(userhash, xstsToken) {
  const res = await fetch("https://userpresence.xboxlive.com/users/me?level=all", {
    headers: {
      "x-xbl-contract-version": "3",
      Accept: "application/json",
      Authorization: `XBL3.0 x=${userhash};${xstsToken}`,
    },
  });
  if (!res.ok) throw new Error(`Xbox Live presence request failed (${res.status})`);
  return res.json();
}

// Same refresh-if-needed pattern as getLiveXboxGamerscore above, just
// calling xboxFetchPresence instead at the end — kept as its own
// function (rather than a shared "refresh then do X" wrapper) since
// the two call sites want different response shapes back.
async function getLiveXboxPresence(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("xbox_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let { userhash, xsts_token: xstsToken } = stored;
  const xstsExpired = new Date(stored.xsts_expires_at).getTime() < Date.now();
  const msExpired = new Date(stored.ms_expires_at).getTime() < Date.now();

  if (xstsExpired) {
    let msAccessToken = stored.ms_access_token;
    let newMsFields = null;
    if (msExpired) {
      if (!stored.ms_refresh_token) return "expired";
      const refreshed = await xboxOAuthTokenRequest({ grant_type: "refresh_token", refresh_token: stored.ms_refresh_token, scope: "Xboxlive.signin Xboxlive.offline_access" }, { usePublicClient: stored.is_public_client });
      msAccessToken = refreshed.access_token;
      newMsFields = {
        ms_access_token: refreshed.access_token,
        ms_refresh_token: refreshed.refresh_token || stored.ms_refresh_token,
        ms_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
    }
    const userTokenResp = await xboxRequestUserToken(msAccessToken);
    const xsts = await xboxRequestXstsToken(userTokenResp.Token);
    const claims = xsts.DisplayClaims.xui[0];
    userhash = claims.uhs;
    xstsToken = xsts.Token;
    await adminClient.from("xbox_tokens").update({
      ...(newMsFields || {}),
      xsts_token: xsts.Token,
      xsts_expires_at: xsts.NotAfter,
      userhash: claims.uhs,
      xuid: claims.xid,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const presence = await xboxFetchPresence(userhash, xstsToken);
  const activeTitle = (presence.devices || [])
    .flatMap((d) => d.titles || [])
    .find((t) => t.state === "Active");
  return {
    online: presence.state === "Online",
    playing: activeTitle ? { name: activeTitle.name, richPresence: activeTitle.activity?.[0]?.richPresence || null } : null,
  };
}

// Real owned/played title history confirmed against OpenXbox/xbox-
// webapi-python's actual working titlehub provider. Same
// Authorization scheme as the other Xbox calls, plus titlehub's own
// required client-identity headers (x-xbl-client-name etc. — a real
// request without these was confirmed to fail while researching
// this). maxItems=1000 to get the real full history, not just recent.
async function xboxFetchLibrary(userhash, xstsToken, xuid) {
  const url = `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/achievement,image?maxItems=1000`;
  const res = await fetch(url, {
    headers: {
      "x-xbl-contract-version": "2",
      "x-xbl-client-name": "XboxApp",
      "x-xbl-client-type": "UWA",
      "x-xbl-client-version": "39.39.22001.0",
      // Node's built-in fetch sends "Accept-Language: *" when nothing
      // overrides it, and titlehub (unlike the gamerscore/presence
      // endpoints above) validates this header strictly and rejects
      // the wildcard outright — confirmed live: "Request contains
      // Accept-Language header with invalid locale value: *". The
      // real xbox-webapi-python reference always sets a real locale
      // here for exactly this reason.
      "Accept-Language": "en-US",
      Authorization: `XBL3.0 x=${userhash};${xstsToken}`,
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Xbox Live title history request failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
  }
  const data = await res.json();
  return (data.titles || []).map((t) => ({
    titleId: t.titleId,
    name: t.name,
    imageUrl: t.displayImage || null,
    currentGamerscore: t.achievement?.currentGamerscore ?? null,
    totalGamerscore: t.achievement?.totalGamerscore ?? null,
    lastPlayed: t.titleHistory?.lastTimePlayed || null,
  }));
}

// Same refresh-if-needed pattern as getLiveXboxGamerscore/
// getLiveXboxPresence above, calling xboxFetchLibrary at the end.
async function getLiveXboxLibrary(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("xbox_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let { userhash, xuid, xsts_token: xstsToken } = stored;
  const xstsExpired = new Date(stored.xsts_expires_at).getTime() < Date.now();
  const msExpired = new Date(stored.ms_expires_at).getTime() < Date.now();

  if (xstsExpired) {
    let msAccessToken = stored.ms_access_token;
    let newMsFields = null;
    if (msExpired) {
      if (!stored.ms_refresh_token) return "expired";
      const refreshed = await xboxOAuthTokenRequest({ grant_type: "refresh_token", refresh_token: stored.ms_refresh_token, scope: "Xboxlive.signin Xboxlive.offline_access" }, { usePublicClient: stored.is_public_client });
      msAccessToken = refreshed.access_token;
      newMsFields = {
        ms_access_token: refreshed.access_token,
        ms_refresh_token: refreshed.refresh_token || stored.ms_refresh_token,
        ms_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
    }
    const userTokenResp = await xboxRequestUserToken(msAccessToken);
    const xsts = await xboxRequestXstsToken(userTokenResp.Token);
    const claims = xsts.DisplayClaims.xui[0];
    userhash = claims.uhs;
    xuid = claims.xid;
    xstsToken = xsts.Token;
    await adminClient.from("xbox_tokens").update({
      ...(newMsFields || {}),
      xsts_token: xsts.Token,
      xsts_expires_at: xsts.NotAfter,
      userhash: claims.uhs,
      xuid: claims.xid,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const games = await xboxFetchLibrary(userhash, xstsToken, xuid);
  return { games };
}

// Real per-title achievement list confirmed against OpenXbox/xbox-
// webapi-python's AchievementsProvider (not guessed) — same
// Authorization scheme as the other Xbox calls, achievements.xboxlive.com
// instead of titlehub. progressState is "Achieved" once unlocked;
// timeUnlocked only populates then. mediaAssets carries the real icon
// (type "Icon"); rewards carries the real Gamerscore value for this
// achievement specifically (titlehub's currentGamerscore/
// totalGamerscore above is only the title's running total, not a
// per-achievement breakdown).
async function xboxFetchAchievements(userhash, xstsToken, xuid, titleId) {
  const url = `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=1000`;
  const res = await fetch(url, {
    headers: {
      "x-xbl-contract-version": "2",
      Accept: "application/json",
      "Accept-Language": "en-US",
      Authorization: `XBL3.0 x=${userhash};${xstsToken}`,
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Xbox Live achievements request failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
  }
  const data = await res.json();
  return (data.achievements || []).map((a) => {
    const unlocked = a.progressState === "Achieved";
    return {
      id: a.id,
      name: a.name,
      description: (unlocked ? a.description : a.lockedDescription || a.description) || "",
      icon: a.mediaAssets?.find((m) => m.type === "Icon")?.url || null,
      unlocked,
      unlockedAt: a.progression?.timeUnlocked || null,
      gamerscore: Number(a.rewards?.find((r) => r.type === "Gamerscore")?.value) || 0,
      rarity: a.rarity?.currentPercentage != null ? Number(a.rarity.currentPercentage) : null,
    };
  });
}

// Same refresh-if-needed pattern as getLiveXboxGamerscore/
// getLiveXboxLibrary above, calling xboxFetchAchievements at the end.
async function getLiveXboxAchievements(adminClient, userId, titleId) {
  const { data: stored, error: fetchError } = await adminClient.from("xbox_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let { userhash, xuid, xsts_token: xstsToken } = stored;
  const xstsExpired = new Date(stored.xsts_expires_at).getTime() < Date.now();
  const msExpired = new Date(stored.ms_expires_at).getTime() < Date.now();

  if (xstsExpired) {
    let msAccessToken = stored.ms_access_token;
    let newMsFields = null;
    if (msExpired) {
      if (!stored.ms_refresh_token) return "expired";
      const refreshed = await xboxOAuthTokenRequest({ grant_type: "refresh_token", refresh_token: stored.ms_refresh_token, scope: "Xboxlive.signin Xboxlive.offline_access" }, { usePublicClient: stored.is_public_client });
      msAccessToken = refreshed.access_token;
      newMsFields = {
        ms_access_token: refreshed.access_token,
        ms_refresh_token: refreshed.refresh_token || stored.ms_refresh_token,
        ms_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
    }
    const userTokenResp = await xboxRequestUserToken(msAccessToken);
    const xsts = await xboxRequestXstsToken(userTokenResp.Token);
    const claims = xsts.DisplayClaims.xui[0];
    userhash = claims.uhs;
    xuid = claims.xid;
    xstsToken = xsts.Token;
    await adminClient.from("xbox_tokens").update({
      ...(newMsFields || {}),
      xsts_token: xsts.Token,
      xsts_expires_at: xsts.NotAfter,
      userhash: claims.uhs,
      xuid: claims.xid,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const achievements = await xboxFetchAchievements(userhash, xstsToken, xuid, titleId);
  return { achievements };
}

// Microsoft doesn't document a public wishlist list API for third-party
// apps — xbox.com loads it through internal emerald routes that need
// extra S2S headers we can't obtain from a normal OAuth link. This
// probes the most likely emerald path; if it 404s, the Prices page
// shows an honest "not available yet" message instead of faking data.
async function xboxFetchWishlist(userhash, xstsToken) {
  const url = "https://emerald.xboxservices.com/xboxcomfd/wishlist?locale=en-US";
  const res = await fetch(url, {
    headers: {
      Authorization: `XBL3.0 x=${userhash};${xstsToken}`,
      "x-ms-api-version": "1.0",
      Referer: "https://www.xbox.com/",
      Origin: "https://www.xbox.com",
    },
  });
  if (!res.ok) {
    throw Object.assign(
      new Error("Xbox wishlist sync isn't available yet — Microsoft doesn't expose wishlist data through the linked-account API."),
      { status: 501 }
    );
  }
  const data = await res.json();
  const products = data?.products || data?.items || data?.wishlistItems || [];
  if (!Array.isArray(products) || products.length === 0) {
    throw Object.assign(
      new Error("Xbox wishlist sync isn't available yet — Microsoft doesn't expose wishlist data through the linked-account API."),
      { status: 501 }
    );
  }
  return products
    .map((item) => ({
      name: item.title || item.name || item.productTitle || null,
      productId: item.productId || item.id || null,
    }))
    .filter((item) => item.name);
}

async function getLiveXboxWishlist(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("xbox_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let { userhash, xsts_token: xstsToken } = stored;
  const xstsExpired = new Date(stored.xsts_expires_at).getTime() < Date.now();
  const msExpired = new Date(stored.ms_expires_at).getTime() < Date.now();

  if (xstsExpired) {
    let msAccessToken = stored.ms_access_token;
    let newMsFields = null;
    if (msExpired) {
      if (!stored.ms_refresh_token) return "expired";
      const refreshed = await xboxOAuthTokenRequest({ grant_type: "refresh_token", refresh_token: stored.ms_refresh_token, scope: "Xboxlive.signin Xboxlive.offline_access" }, { usePublicClient: stored.is_public_client });
      msAccessToken = refreshed.access_token;
      newMsFields = {
        ms_access_token: refreshed.access_token,
        ms_refresh_token: refreshed.refresh_token || stored.ms_refresh_token,
        ms_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
    }
    const userTokenResp = await xboxRequestUserToken(msAccessToken);
    const xsts = await xboxRequestXstsToken(userTokenResp.Token);
    const claims = xsts.DisplayClaims.xui[0];
    userhash = claims.uhs;
    xstsToken = xsts.Token;
    await adminClient.from("xbox_tokens").update({
      ...(newMsFields || {}),
      xsts_token: xsts.Token,
      xsts_expires_at: xsts.NotAfter,
      userhash: claims.uhs,
      xuid: claims.xid,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const items = await xboxFetchWishlist(userhash, xstsToken);
  return { items };
}

// Verifies the caller against their own Supabase session (same pattern
// as handleLykodexSession above) and returns a service_role admin
// client for reading/writing this user's stored tokens.
async function verifyCallerAndGetAdminClient(req) {
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!callerToken) throw Object.assign(new Error("Missing Authorization bearer token"), { status: 401 });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw Object.assign(new Error("Server not configured for this"), { status: 500 });
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: callerData, error: callerError } = await anonClient.auth.getUser(callerToken);
  if (callerError || !callerData?.user) throw Object.assign(new Error("Invalid session"), { status: 401 });

  return { userId: callerData.user.id, adminClient };
}

async function handleXbox(req, searchParams, res) {
  const mode = searchParams.get("mode");

  try {
    if (mode === "link") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { code, redirectUri } = req.body || {};
      if (!code || !redirectUri) return res.status(400).json({ error: "Missing code or redirectUri" });

      // The packaged-app flow's redirect_uri is the lykodex://
      // scheme (see xboxOAuth.js's xboxRedirectUri) — anything else
      // is the web flow's real https:// deployed URL. Whichever this
      // link used has to be remembered (is_public_client below) so a
      // later refresh_token request sends/omits client_secret the
      // same way this initial exchange did (see xboxOAuthTokenRequest
      // above for why mixing them fails).
      const isPublicClient = redirectUri.startsWith("lykodex://");
      const oauth = await xboxOAuthTokenRequest(
        { grant_type: "authorization_code", code, redirect_uri: redirectUri, scope: "Xboxlive.signin Xboxlive.offline_access" },
        { usePublicClient: isPublicClient }
      );
      const userTokenResp = await xboxRequestUserToken(oauth.access_token);
      const xsts = await xboxRequestXstsToken(userTokenResp.Token);
      const claims = xsts.DisplayClaims.xui[0];
      const { gamerscore, gamertag } = await xboxFetchGamerscore(claims.uhs, xsts.Token);

      const now = Date.now();
      const { error: upsertError } = await adminClient.from("xbox_tokens").upsert({
        user_id: userId,
        ms_access_token: oauth.access_token,
        ms_refresh_token: oauth.refresh_token || null,
        ms_expires_at: new Date(now + oauth.expires_in * 1000).toISOString(),
        xsts_token: xsts.Token,
        xsts_expires_at: xsts.NotAfter,
        userhash: claims.uhs,
        xuid: claims.xid,
        gamertag: gamertag || claims.gtg || null,
        is_public_client: isPublicClient,
        updated_at: new Date().toISOString(),
      });
      if (upsertError) throw upsertError;

      return res.status(200).json({ gamertag: gamertag || claims.gtg, gamerscore });
    }

    if (mode === "gamerscore") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveXboxGamerscore(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "Xbox not linked" });
      if (result === "expired") return res.status(401).json({ error: "Xbox link expired — please re-link" });
      return res.status(200).json(result);
    }

    if (mode === "presence") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveXboxPresence(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "Xbox not linked" });
      if (result === "expired") return res.status(401).json({ error: "Xbox link expired — please re-link" });
      return res.status(200).json(result);
    }

    if (mode === "library") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveXboxLibrary(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "Xbox not linked" });
      if (result === "expired") return res.status(401).json({ error: "Xbox link expired — please re-link" });
      return res.status(200).json(result);
    }

    if (mode === "wishlist") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveXboxWishlist(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "Xbox not linked" });
      if (result === "expired") return res.status(401).json({ error: "Xbox link expired — please re-link" });
      return res.status(200).json(result);
    }

    if (mode === "achievements") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { titleId } = req.body || {};
      if (!titleId) return res.status(400).json({ error: "Missing titleId" });
      const result = await getLiveXboxAchievements(adminClient, userId, titleId);
      if (result === "not_linked") return res.status(404).json({ error: "Xbox not linked" });
      if (result === "expired") return res.status(401).json({ error: "Xbox link expired — please re-link" });
      return res.status(200).json(result);
    }

    if (mode === "unlink") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { error: deleteError } = await adminClient.from("xbox_tokens").delete().eq("user_id", userId);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("pricing (xbox):", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

// ---------- PlayStation Network (real trophy counts via npsso) ----------
// Real npsso -> access code -> access/refresh token exchange confirmed
// against achievements-app/psn-api's actual working implementation
// (not guessed) — Sony offers no public OAuth app registration path,
// so this is the same unofficial-but-real mechanism every PSN trophy
// tracker (PSNProfiles etc.) uses. The npsso itself is a 64-char
// session-cookie value the person copies from their own browser after
// signing into ca.account.sony.com — equivalent to a password, never
// logged, never stored (only the resulting access/refresh tokens are).
//
// The client_id/client_secret/redirect_uri/scope values below are
// PSN's own fixed, public mobile-app OAuth client (confirmed real —
// every implementation of this flow uses the exact same constants,
// they are not something Lykodex registered).
const PSN_AUTH_BASE = "https://ca.account.sony.com/api/authz/v3/oauth";
const PSN_CLIENT_AUTH_HEADER = "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const PSN_REDIRECT_URI = "com.scee.psxandroid.scecompcall://redirect";

async function psnExchangeNpssoForAccessCode(npsso) {
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: "09515159-7237-4370-9b40-3806e67c0891",
    redirect_uri: PSN_REDIRECT_URI,
    response_type: "code",
    scope: "psn:mobile.v2.core psn:clientapp",
  });
  const res = await fetch(`${PSN_AUTH_BASE}/authorize?${params.toString()}`, {
    headers: { Cookie: `npsso=${npsso}` },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  if (!location || !location.includes("?code=")) {
    throw new Error("Couldn't get a PSN access code — the npsso token may be invalid or expired.");
  }
  return new URLSearchParams(location.split("redirect/")[1]).get("code");
}

async function psnExchangeAccessCodeForTokens(accessCode) {
  const res = await fetch(`${PSN_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: PSN_CLIENT_AUTH_HEADER },
    body: new URLSearchParams({ code: accessCode, redirect_uri: PSN_REDIRECT_URI, grant_type: "authorization_code", token_format: "jwt" }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PSN token exchange failed: ${data.error_description || data.error || res.status}`);
  return data; // { access_token, refresh_token, expires_in, refresh_token_expires_in, ... }
}

async function psnRefreshTokens(refreshToken) {
  const res = await fetch(`${PSN_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: PSN_CLIENT_AUTH_HEADER },
    body: new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token", token_format: "jwt", scope: "psn:mobile.v2.core psn:clientapp" }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PSN token refresh failed: ${data.error_description || data.error || res.status}`);
  return data;
}

async function psnFetchTrophySummary(accessToken) {
  const res = await fetch("https://m.np.playstation.com/api/trophy/v1/users/me/trophySummary", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`PSN trophy summary request failed (${res.status})`);
  return res.json(); // { accountId, trophyLevel, earnedTrophies: { bronze, silver, gold, platinum } }
}

// Real live activity confirmed against achievements-app/psn-api's
// actual working implementation. accountId comes from the stored row
// (captured from the trophy summary response at link time) — same
// Bearer access token as trophy fetching, different endpoint. Real
// response shape: { basicPresence: { availability:
// "unavailable"|"availableToPlay", primaryPlatformInfo: {
// onlineStatus, platform, lastOnlineDate }, gameTitleInfoList: [{
// titleName, ... }] } }.
async function psnFetchPresence(accessToken, accountId) {
  const res = await fetch(`https://m.np.playstation.com/api/userProfile/v1/internal/users/${accountId}/basicPresences?type=primary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`PSN presence request failed (${res.status})`);
  return res.json();
}

async function getLivePsnPresence(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";
  if (!stored.account_id) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const data = await psnFetchPresence(accessToken, stored.account_id);
  const presence = data.basicPresence;
  const playingTitle = presence?.gameTitleInfoList?.[0] || null;
  return {
    online: presence?.primaryPlatformInfo?.onlineStatus === "online" || presence?.onlineStatus === "online",
    playing: presence?.availability === "availableToPlay" && playingTitle ? { name: playingTitle.titleName } : null,
  };
}

// Real played-games list confirmed against achievements-app/psn-api's
// actual working getUserPlayedGames implementation — same Bearer
// token as trophy/presence fetching, different (gamelist) endpoint.
async function psnFetchLibrary(accessToken, accountId) {
  // limit is capped server-side at 200 — confirmed live: "invalid
  // request, requested limit=500 allowed limit=200". Paginate via
  // offset (the response's own nextOffset/totalItemCount, matching
  // achievements-app/psn-api's UserPlayedGamesResponse shape) since a
  // real library can exceed 200 titles.
  const PAGE_LIMIT = 200;
  let offset = 0;
  const allTitles = [];
  for (;;) {
    const url = `https://m.np.playstation.com/api/gamelist/v2/users/${accountId}/titles?limit=${PAGE_LIMIT}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`PSN game list request failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
    }
    const data = await res.json();
    allTitles.push(...(data.titles || []));
    const total = data.totalItemCount ?? allTitles.length;
    if (allTitles.length >= total || !data.titles?.length) break;
    offset += PAGE_LIMIT;
  }

  return allTitles.map((t) => ({
    titleId: t.titleId,
    name: t.name,
    imageUrl: t.imageUrl || null,
    lastPlayed: t.lastPlayedDateTime || null,
  }));
}

// Real per-title trophy list confirmed against achievements-app/psn-
// api's getTitleTrophies/getUserTrophiesEarnedForTitle implementation
// (not guessed) — two calls merged by trophyId, same "definitions +
// player state" split Steam's own achievement merge already uses
// (lib/achievements.js's fetchMergedAchievements): getTitleTrophies has
// the real name/description/icon/hidden/type for every trophy that
// exists; getUserTrophiesEarnedForTitle has this account's real
// earned/earnedDateTime/rarity for each. titleId from psnFetchLibrary
// above IS the npCommunicationId these calls want — same field, no
// extra lookup (per psn-api's own documented usage).
async function psnFetchTitleTrophyDefinitions(accessToken, npCommunicationId, npServiceName) {
  const query = npServiceName ? `?npServiceName=${npServiceName}` : "";
  const url = `https://m.np.playstation.com/api/trophy/v1/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies${query}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw Object.assign(new Error(`PSN trophy definitions request failed (${res.status})`), { status: res.status });
  const data = await res.json();
  return data.trophies || [];
}

async function psnFetchEarnedTrophiesForTitle(accessToken, accountId, npCommunicationId, npServiceName) {
  const query = npServiceName ? `?npServiceName=${npServiceName}` : "";
  const url = `https://m.np.playstation.com/api/trophy/v1/users/${accountId}/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies${query}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw Object.assign(new Error(`PSN earned trophies request failed (${res.status})`), { status: res.status });
  const data = await res.json();
  return data.trophies || [];
}

// npServiceName has to be the title's own real value ("trophy2" for a
// PS5-native title, "trophy" for PS4/PS3/Vita) — confirmed live against
// a real account that guessing this (try none, fall back to "trophy" on
// a 404) is wrong: a real PS5 title's correct value is "trophy2", which
// that fallback never tried, so every title 404'd. The real source is
// psnFetchTrophyTitles below, which hands back each title's own
// npServiceName directly — no guessing needed once you have it.
async function psnFetchMergedTrophiesForTitle(accessToken, accountId, npCommunicationId, npServiceName) {
  const [definitions, earned] = await Promise.all([
    psnFetchTitleTrophyDefinitions(accessToken, npCommunicationId, npServiceName),
    psnFetchEarnedTrophiesForTitle(accessToken, accountId, npCommunicationId, npServiceName),
  ]);

  const earnedById = new Map(earned.map((t) => [t.trophyId, t]));
  return definitions.map((def) => {
    const earnedRow = earnedById.get(def.trophyId);
    return {
      trophyId: def.trophyId,
      name: def.trophyName,
      description: def.trophyDetail,
      icon: def.trophyIconUrl || null,
      type: def.trophyType, // bronze | silver | gold | platinum
      unlocked: !!earnedRow?.earned,
      unlockedAt: earnedRow?.earnedDateTime || null,
      rarity: earnedRow?.trophyEarnedRate != null ? Number(earnedRow.trophyEarnedRate) : null,
    };
  });
}

// Real trophy-eligible title list confirmed against achievements-app/
// psn-api's getUserTrophyTitles implementation — this, not the general
// "played games" gamelist (psnFetchLibrary), is the real source for
// which of a person's games have trophies at all, since it's the only
// endpoint that hands back a title's real npCommunicationId (NPWR-
// format) AND its exact npServiceName together — confirmed live that
// the gamelist's own titleId (PPSA-format) is a different ID space
// entirely and 404s outright against the trophy endpoints.
async function psnFetchTrophyTitles(accessToken, accountId) {
  const PAGE_LIMIT = 200;
  let offset = 0;
  const allTitles = [];
  for (;;) {
    const url = `https://m.np.playstation.com/api/trophy/v1/users/${accountId}/trophyTitles?limit=${PAGE_LIMIT}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`PSN trophy title list request failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
    }
    const data = await res.json();
    allTitles.push(...(data.trophyTitles || []));
    const total = data.totalItemCount ?? allTitles.length;
    if (allTitles.length >= total || !data.trophyTitles?.length) break;
    offset += PAGE_LIMIT;
  }

  return allTitles.map((t) => ({
    npCommunicationId: t.npCommunicationId,
    npServiceName: t.npServiceName,
    name: t.trophyTitleName,
    imageUrl: t.trophyTitleIconUrl || null,
    platform: t.trophyTitlePlatform || null,
    definedTrophies: t.definedTrophies || null,
    earnedTrophies: t.earnedTrophies || null,
  }));
}

async function getLivePsnTrophyTitles(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";
  if (!stored.account_id) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const games = await psnFetchTrophyTitles(accessToken, stored.account_id);
  return { games };
}

// Same refresh-if-needed pattern as getLiveTrophies/getLivePsnLibrary
// above, calling psnFetchMergedTrophiesForTitle at the end.
async function getLiveTrophiesForTitle(adminClient, userId, npCommunicationId, npServiceName) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";
  if (!stored.account_id) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const trophies = await psnFetchMergedTrophiesForTitle(accessToken, stored.account_id, npCommunicationId, npServiceName);
  return { trophies };
}

// Undocumented persisted GraphQL query the PS App uses — confirmed
// against andshrew/PlayStation-Trophies docs (not guessed). Sony can
// rotate the hash without notice; if they do, this fails with a clear
// error rather than returning stale/wrong data.
const PSN_WISHLIST_QUERY_HASH = "571149e8aa4d76af7dd33b92e1d6f8f828ebc5fa8f0f6bf51a8324a0e6d71324";

async function psnFetchWishlist(accessToken) {
  const params = new URLSearchParams({
    operationName: "metGetStoreWishlist",
    variables: "{}",
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: PSN_WISHLIST_QUERY_HASH },
    }),
  });
  const url = `https://m.np.playstation.com/api/graphql/v1/op?${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "apollographql-client-name": "PlayStationApp-Android",
      "content-type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`PSN wishlist request failed (${res.status})`);
  const data = await res.json();
  const entries = data?.data?.storeWishlist;
  if (!Array.isArray(entries)) {
    const detail = data?.errors?.[0]?.message || "unexpected response";
    throw new Error(`PSN wishlist unavailable — Sony may have rotated the query: ${detail}`);
  }
  return entries.map((entry) => ({
    name: entry.name,
    productId: entry.id || null,
  })).filter((entry) => entry.name);
}

async function getLivePsnWishlist(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const items = await psnFetchWishlist(accessToken);
  return { items };
}

async function getLivePsnLibrary(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";
  if (!stored.account_id) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const games = await psnFetchLibrary(accessToken, stored.account_id);
  return { games };
}

// Same refresh-if-needed + fetch, factored out so both the per-user
// endpoint (mode=trophies) and the daily cron below share it — see
// getLiveXboxGamerscore above for the same reasoning.
async function getLiveTrophies(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("psn_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.access_expires_at).getTime() < Date.now()) {
    if (new Date(stored.refresh_expires_at).getTime() < Date.now()) return "expired";
    const refreshed = await psnRefreshTokens(stored.refresh_token);
    accessToken = refreshed.access_token;
    const now = Date.now();
    await adminClient.from("psn_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const summary = await psnFetchTrophySummary(accessToken);
  return { trophies: summary.earnedTrophies };
}

async function handlePsn(req, searchParams, res) {
  const mode = searchParams.get("mode");

  try {
    if (mode === "link") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { npsso } = req.body || {};
      if (!npsso) return res.status(400).json({ error: "Missing npsso" });

      const accessCode = await psnExchangeNpssoForAccessCode(npsso);
      const tokens = await psnExchangeAccessCodeForTokens(accessCode);
      const summary = await psnFetchTrophySummary(tokens.access_token);

      const now = Date.now();
      const { error: upsertError } = await adminClient.from("psn_tokens").upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(now + tokens.refresh_token_expires_in * 1000).toISOString(),
        account_id: summary.accountId || null,
        updated_at: new Date().toISOString(),
      });
      if (upsertError) throw upsertError;

      return res.status(200).json({ trophies: summary.earnedTrophies });
    }

    if (mode === "trophies") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveTrophies(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "presence") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLivePsnPresence(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "library") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLivePsnLibrary(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "wishlist") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLivePsnWishlist(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "title-trophies") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { npCommunicationId, npServiceName } = req.body || {};
      if (!npCommunicationId) return res.status(400).json({ error: "Missing npCommunicationId" });
      const result = await getLiveTrophiesForTitle(adminClient, userId, npCommunicationId, npServiceName);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "trophy-titles") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLivePsnTrophyTitles(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "PlayStation not linked" });
      if (result === "expired") return res.status(401).json({ error: "PlayStation link expired — please re-link with a fresh npsso" });
      return res.status(200).json(result);
    }

    if (mode === "unlink") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { error: deleteError } = await adminClient.from("psn_tokens").delete().eq("user_id", userId);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("pricing (psn):", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

// ---------- Crunchyroll (unofficial, cookie-based) ----------
// Crunchyroll has no public developer API at all — this talks to the
// same internal beta-api.crunchyroll.com endpoints crunchyroll.com's
// own website calls, confirmed against HarshitKumar9030/crunchyroll-
// api's actual working source (not guessed). The person signs into
// Crunchyroll normally in their own browser and pastes their own
// etp_rt session cookie value here — same "paste a token you grab
// from your own session" shape as PSN's npsso, not a real OAuth
// redirect (Crunchyroll doesn't offer one).
const CRUNCHYROLL_BASE = "https://beta-api.crunchyroll.com";
// Crunchyroll's own client_id:client_secret for this specific grant
// type, base64-encoded — this is the exact value the real
// crunchyroll.com website itself sends for an etp_rt cookie exchange,
// not a Lykodex-issued credential.
const CRUNCHYROLL_ETP_RT_AUTH_HEADER = "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6";

// Pulls just the etp_rt value out of whatever the person pasted —
// "etp_rt=<value>", "etp_rt = <value>" (a stray space after the "="
// is an easy thing to type and isn't valid inside an HTTP cookie
// value — sent verbatim it truncates to an empty etp_rt and
// Crunchyroll rejects it as invalid_grant even when the real cookie
// value is fine), a full multi-cookie DevTools copy, or a trailing
// semicolon — and rebuilds a clean "etp_rt=<value>" Cookie header
// regardless of formatting.
function normalizeEtpRtCookie(raw) {
  const match = /etp_rt\s*=\s*([^;\s]+)/i.exec(raw || "");
  return match ? `etp_rt=${match[1]}` : null;
}

async function crunchyrollExchangeCookieForTokens(cookie, deviceId) {
  const res = await fetch(`${CRUNCHYROLL_BASE}/auth/v1/token`, {
    method: "POST",
    headers: {
      Authorization: CRUNCHYROLL_ETP_RT_AUTH_HEADER,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({ device_type: "Chrome on Android", device_id: deviceId, grant_type: "etp_rt_cookie" }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Crunchyroll sign-in failed: ${data.error_description || data.error || res.status} — check the etp_rt cookie is fresh.`);
  return data; // { access_token, refresh_token, expires_in, profile_id, account_id, ... }
}

async function crunchyrollRefreshTokens(refreshToken, deviceId) {
  const res = await fetch(`${CRUNCHYROLL_BASE}/auth/v1/token`, {
    method: "POST",
    headers: {
      Authorization: CRUNCHYROLL_ETP_RT_AUTH_HEADER,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ refresh_token: refreshToken, device_id: deviceId, grant_type: "refresh_token" }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Crunchyroll token refresh failed: ${data.error_description || data.error || res.status}`);
  return data;
}

// Real watch history — each entry's real show/movie title lives at
// entry.panel.title (confirmed against the real WatchHistoryEntry/
// CrunchyItem shape, not guessed).
async function crunchyrollFetchWatchHistory(accessToken, accountId) {
  const res = await fetch(`${CRUNCHYROLL_BASE}/content/v2/${encodeURIComponent(accountId)}/watch-history?locale=en-US`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Crunchyroll watch history request failed (${res.status})`);
  const data = await res.json();
  return (data.data || [])
    .map((entry) => entry.panel?.title)
    .filter(Boolean);
}

// Same refresh-if-needed pattern as getLiveXboxGamerscore/getLiveTrophies
// above — "not_linked"/"expired" sentinel strings rather than throwing.
async function getLiveCrunchyrollLibrary(adminClient, userId) {
  const { data: stored, error: fetchError } = await adminClient.from("crunchyroll_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!stored) return "not_linked";

  let accessToken = stored.access_token;
  if (new Date(stored.expires_at).getTime() < Date.now()) {
    if (!stored.refresh_token) return "expired";
    const refreshed = await crunchyrollRefreshTokens(stored.refresh_token, stored.device_id);
    accessToken = refreshed.access_token;
    await adminClient.from("crunchyroll_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  const titles = await crunchyrollFetchWatchHistory(accessToken, stored.account_id);
  return { titles };
}

async function handleCrunchyroll(req, searchParams, res) {
  const mode = searchParams.get("mode");

  try {
    if (mode === "link") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { cookie: rawCookie } = req.body || {};
      const cookie = normalizeEtpRtCookie(rawCookie);
      if (!cookie) {
        return res.status(400).json({ error: "Missing or invalid cookie — it must include etp_rt=" });
      }

      const deviceId = randomUUID();
      const tokens = await crunchyrollExchangeCookieForTokens(cookie, deviceId);

      const { error: upsertError } = await adminClient.from("crunchyroll_tokens").upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        account_id: tokens.account_id || null,
        profile_id: tokens.profile_id || null,
        device_id: deviceId,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (upsertError) throw upsertError;

      const result = await getLiveCrunchyrollLibrary(adminClient, userId);
      return res.status(200).json({ titleCount: result === "not_linked" || result === "expired" ? 0 : result.titles.length });
    }

    if (mode === "library") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const result = await getLiveCrunchyrollLibrary(adminClient, userId);
      if (result === "not_linked") return res.status(404).json({ error: "Crunchyroll not linked" });
      if (result === "expired") return res.status(401).json({ error: "Crunchyroll link expired — please re-link with a fresh cookie" });
      return res.status(200).json(result);
    }

    if (mode === "unlink") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const { userId, adminClient } = await verifyCallerAndGetAdminClient(req);
      const { error: deleteError } = await adminClient.from("crunchyroll_tokens").delete().eq("user_id", userId);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Missing or invalid mode parameter" });
  } catch (err) {
    console.error("pricing (crunchyroll):", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

// ---------- Daily Mastery recompute (all 5 Colleges, all linked platforms) ----------
// Vercel Cron (see vercel.json, "0 4 * * *") hits this once a day for
// every user with Xbox, PSN, or Steam linked, refreshing all three
// live and recombining Overall Mastery (all 5 Colleges) from the
// result.
//
// This was originally built to fire hourly and only act at each
// person's own local midnight (profiles.timezone, captured client-
// side in AppContext.jsx, is still there and still gets kept current
// for exactly this reason) — but Vercel's Hobby plan hard-rejects any
// cron expression that would run more than once a day ("This cron
// expression would run more than once per day", confirmed via Vercel's
// own usage-and-pricing docs after an hourly schedule here silently
// failed EVERY deployment, including unrelated ones, until this was
// reverted). Genuine per-timezone-midnight precision needs a Pro-plan
// upgrade (per-minute schedules) to actually implement — until/unless
// that happens, this runs once for everyone at the one fixed UTC time
// Hobby allows, same as the original version of this cron did.
const GAMES_TO_SCAN = 15; // same bound as gameMasteryData.js's client-side gatherSteamAchievements

async function steamFetchOwnedGames(steamId) {
  const apiKey = process.env.STEAM_API_KEY;
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${encodeURIComponent(steamId)}&format=json&include_appinfo=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam owned-games request failed (${res.status})`);
  const data = await res.json();
  return data.response?.games || [];
}

async function steamFetchAchievements(steamId, appId) {
  const apiKey = process.env.STEAM_API_KEY;
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${encodeURIComponent(appId)}&key=${apiKey}&steamid=${encodeURIComponent(steamId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam achievements request failed (${res.status})`);
  const data = await res.json();
  return data.playerstats?.achievements || [];
}

async function steamFetchGlobalAchievementPercentages(appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${encodeURIComponent(appId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam global achievement percentages request failed (${res.status})`);
  const data = await res.json();
  return data.achievementpercentages?.achievements || [];
}

// Real Steam Mastery contribution, server-side — same three genuine
// Steam Web API endpoints and same top-15-most-played-games bound as
// gameMasteryData.js's gatherSteamAchievements (a browser-only file,
// not importable here — see its own header for why). Kept as its own
// function since the cron needs this without a real Supabase session
// to call the client's own /api/steam proxy through.
async function getLiveSteamMasteryRaw(steamId) {
  const games = await steamFetchOwnedGames(steamId);
  const topGames = [...games]
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, GAMES_TO_SCAN);

  const perGame = await Promise.all(
    topGames.map(async (game) => {
      try {
        const [achievements, percentages] = await Promise.all([
          steamFetchAchievements(steamId, game.appid),
          steamFetchGlobalAchievementPercentages(game.appid),
        ]);
        const unlocked = achievements.filter((a) => a.achieved === 1);
        return unlocked.map((a) => {
          const percentEntry = percentages.find((p) => p.name === a.apiname);
          return { unlockPercent: percentEntry ? Number(percentEntry.percent) : null };
        });
      } catch {
        return []; // no achievements on this game, or a private/edge-case response — skip it
      }
    })
  );

  const achievements = perGame.flat();
  return { raw: computeSteamScore(achievements), gamesScanned: topGames.length, achievementsCounted: achievements.length };
}

// Recomputes Gaming Mastery (Steam + Xbox + PlayStation) fresh,
// server-side, for the hourly midnight-local-time cron below.
// Unlike the old once-daily-for-everyone version of this cron, Steam
// is now genuinely re-fetched here too when linked — falling back to
// whatever was last computed only on a fetch failure, not skipped
// outright, since this now runs at each person's own local midnight
// rather than one shared fixed time.
async function recomputeMasteryForUserServerSide(adminClient, userId, linkedSteamId) {
  const { data: profile } = await adminClient.from("profiles").select("mastery_breakdown").eq("id", userId).maybeSingle();
  const { data: inputs } = await adminClient.from("mastery_inputs").select("*").eq("user_id", userId).maybeSingle();

  const rawScores = {};
  const sources = {};

  const existingSteam = Array.isArray(profile?.mastery_breakdown)
    ? profile.mastery_breakdown.find((e) => e.platform === "steam")
    : null;

  if (linkedSteamId) {
    try {
      const { raw, gamesScanned, achievementsCounted } = await getLiveSteamMasteryRaw(linkedSteamId);
      rawScores.steam = raw;
      sources.steam = { source: "live_steam_api", asOf: new Date().toISOString(), gamesScanned, achievementsCounted };
    } catch (err) {
      console.error(`pricing (mastery-cron): Steam fetch failed for user ${userId}`, err);
      if (existingSteam) {
        rawScores.steam = existingSteam.raw;
        sources.steam = { source: existingSteam.source, asOf: existingSteam.asOf, gamesScanned: existingSteam.gamesScanned, achievementsCounted: existingSteam.achievementsCounted };
      }
    }
  } else if (existingSteam) {
    rawScores.steam = existingSteam.raw;
    sources.steam = { source: existingSteam.source, asOf: existingSteam.asOf, gamesScanned: existingSteam.gamesScanned, achievementsCounted: existingSteam.achievementsCounted };
  }

  try {
    const result = await getLiveXboxGamerscore(adminClient, userId);
    if (result !== "not_linked" && result !== "expired") {
      rawScores.xbox = computeXboxScore(result.gamerscore);
      sources.xbox = { source: "live_xbox_api", asOf: new Date().toISOString(), gamerscore: result.gamerscore, gamertag: result.gamertag };
    } else if (inputs?.xbox_gamerscore != null) {
      rawScores.xbox = computeXboxScore(inputs.xbox_gamerscore);
      sources.xbox = { source: "self_reported", asOf: inputs.xbox_updated_at, gamerscore: inputs.xbox_gamerscore };
    }
  } catch (err) {
    console.error(`pricing (mastery-cron): Xbox fetch failed for user ${userId}`, err);
  }

  try {
    const result = await getLiveTrophies(adminClient, userId);
    if (result !== "not_linked" && result !== "expired") {
      rawScores.playstation = computePsScore(result.trophies);
      sources.playstation = { source: "live_psn_api", asOf: new Date().toISOString() };
    } else if (inputs?.ps_trophy_counts) {
      rawScores.playstation = computePsScore(inputs.ps_trophy_counts);
      sources.playstation = { source: "self_reported", asOf: inputs.ps_updated_at };
    }
  } catch (err) {
    console.error(`pricing (mastery-cron): PSN fetch failed for user ${userId}`, err);
  }

  const combined = computeMasteryScore(rawScores);
  if (!combined) return null;

  const accountXp = accountXpFromMastery(combined.masteryScore);
  const { level } = levelFromXp(accountXp);
  const breakdown = combined.breakdown.map((entry) => ({ ...entry, ...sources[entry.platform] }));

  const { error } = await adminClient.from("profiles").update({
    mastery_score: combined.masteryScore,
    mastery_xp: accountXp,
    mastery_level: level,
    mastery_breakdown: breakdown,
    mastery_computed_at: new Date().toISOString(),
  }).eq("id", userId);
  if (error) throw error;
  return combined.masteryScore;
}

// Recombines Overall Mastery (all 5 Colleges) using the just-refreshed
// Gaming score plus whatever the other 4 Colleges' contributions
// already are — deliberately NOT re-gathering TCG/Library/Loot/
// Wartable's own raw data server-side (that would mean re-implementing
// four more Colleges' worth of data-gathering here, duplicating
// mtg.js/entertainment.js/collectibles.js/tabletop.js). Those 4 only
// change when a person edits their own collection/backlog/campaigns
// directly in the app, which already triggers a fresh combine right
// then (see AppContext.jsx) — there's no external drift for them the
// way there is for Gaming's real third-party platforms, so carrying
// their last-computed raw values forward and only replacing Gaming's
// is the correct behavior here, not a shortcut. Reuses
// overall_mastery_breakdown's own stored `raw` field per College
// (see overallMastery.js's computeOverallScore) as the source of
// truth for those 4, rather than re-deriving them.
async function recomputeOverallMasteryServerSide(adminClient, userId, freshGamingScore) {
  const { data: profile } = await adminClient.from("profiles").select("overall_mastery_breakdown").eq("id", userId).maybeSingle();
  const existingBreakdown = Array.isArray(profile?.overall_mastery_breakdown) ? profile.overall_mastery_breakdown : [];

  const collegeScores = {};
  for (const entry of existingBreakdown) {
    if (entry?.college) collegeScores[entry.college] = entry.raw;
  }
  if (freshGamingScore != null) collegeScores.gaming = freshGamingScore;

  const combined = computeOverallScore(collegeScores);
  if (!combined) return false;

  const accountXp = accountXpFromMastery(combined.overallScore);
  const { level } = levelFromXp(accountXp);

  const { error } = await adminClient.from("profiles").update({
    overall_mastery_score: combined.overallScore,
    overall_mastery_xp: accountXp,
    overall_mastery_level: level,
    overall_mastery_breakdown: combined.breakdown,
    overall_mastery_computed_at: new Date().toISOString(),
  }).eq("id", userId);
  if (error) throw error;
  return true;
}

async function handleMasteryCron(req, res) {
  const authHeader = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET;
  // No CRON_SECRET configured = refuse entirely, rather than allow an
  // unauthenticated public trigger of a job that writes to every
  // user's profile.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server not configured for this" });
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Everyone with Xbox, PSN, or Steam linked — a real superset of the
  // original Xbox/PSN-only query, now that Steam genuinely refreshes
  // here too (see getLiveSteamMasteryRaw above).
  const [{ data: xboxRows }, { data: psnRows }, { data: steamRows }] = await Promise.all([
    adminClient.from("xbox_tokens").select("user_id"),
    adminClient.from("psn_tokens").select("user_id"),
    adminClient.from("profiles").select("id, linked_steam_id").not("linked_steam_id", "is", null),
  ]);
  const steamByUserId = new Map((steamRows || []).map((r) => [r.id, r.linked_steam_id]));
  const userIds = [...new Set([
    ...(xboxRows || []).map((r) => r.user_id),
    ...(psnRows || []).map((r) => r.user_id),
    ...steamByUserId.keys(),
  ])];

  // Concurrent, not sequential — confirmed live as the real cause of a
  // silent per-user failure: with users processed one at a time (each
  // needing several sequential external API round-trips — Steam, then
  // Xbox, then PSN), a second user pushed the function past Vercel's
  // default duration limit (no maxDuration was set at all before this
  // fix). A timeout just kills the function outright — no exception,
  // no entry in `failed`, the DB write for that user simply never
  // happens — which is exactly what was found: a friend's Xbox/PSN
  // tokens hadn't refreshed in 4 days even though the tokens
  // themselves were still completely valid when tested directly.
  const results = { total: userIds.length, gamingUpdated: 0, overallUpdated: 0, noData: 0, failed: 0 };
  const outcomes = await Promise.allSettled(userIds.map(async (userId) => {
    const freshGamingScore = await recomputeMasteryForUserServerSide(adminClient, userId, steamByUserId.get(userId));
    const overallUpdated = await recomputeOverallMasteryServerSide(adminClient, userId, freshGamingScore);
    return { freshGamingScore, overallUpdated };
  }));

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (outcome.status === "rejected") {
      console.error(`pricing (mastery-cron): failed for user ${userIds[i]}`, outcome.reason);
      results.failed += 1;
      continue;
    }
    if (outcome.value.freshGamingScore != null) results.gamingUpdated += 1;
    else results.noData += 1;
    if (outcome.value.overallUpdated) results.overallUpdated += 1;
  }

  return res.status(200).json(results);
}

// Real session swap for the "act as Lykodex" toggle — not a client-
// side pretend-toggle, since RLS needs a genuine auth.uid() to enforce
// anything anywhere. The service_role key bypasses RLS entirely, so
// this endpoint's whole job is verifying, server-side, that the
// caller is actually the one registered delegate BEFORE ever touching
// it — never trust a client-supplied "I'm allowed" flag for this.
//
// Flow: verify the caller's own access token names a real user (via a
// plain anon-key client — this step never needs service_role) ->
// check that user's id against profiles.lykodex_delegate_user_id on
// the Lykodex account (a service_role read, since the caller can't
// read someone else's profile row under normal RLS) -> if it matches,
// admin.generateLink() a one-time magic-link token for the Lykodex
// account and immediately redeem it via verifyOtp() on a plain
// anon-key client, which hands back a genuine session (access +
// refresh token) for the Lykodex account. The client then calls
// supabase.auth.setSession() with that to actually swap sessions.
async function handleLykodexSession(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!callerToken) return res.status(401).json({ error: "Missing Authorization bearer token" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("pricing (lykodex-session): missing Supabase env vars");
    return res.status(500).json({ error: "Server not configured for this" });
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: callerData, error: callerError } = await anonClient.auth.getUser(callerToken);
  if (callerError || !callerData?.user) return res.status(401).json({ error: "Invalid session" });

  const LYKODEX_EMAIL = "system@lykodex.internal";

  const { data: lykodexProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, lykodex_delegate_user_id")
    .eq("username", "Lykodex")
    .single();
  if (profileError || !lykodexProfile) {
    console.error("pricing (lykodex-session): couldn't load Lykodex profile", profileError);
    return res.status(500).json({ error: "Lykodex account not found" });
  }

  if (lykodexProfile.lykodex_delegate_user_id !== callerData.user.id) {
    return res.status(403).json({ error: "Not authorized to act as Lykodex" });
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: LYKODEX_EMAIL,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("pricing (lykodex-session): generateLink failed", linkError);
    return res.status(500).json({ error: "Couldn't create a Lykodex session" });
  }

  const { data: sessionData, error: verifyError } = await anonClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError || !sessionData?.session) {
    console.error("pricing (lykodex-session): verifyOtp failed", verifyError);
    return res.status(500).json({ error: "Couldn't create a Lykodex session" });
  }

  return res.status(200).json({ session: sessionData.session });
}

async function handleCurrency(res) {
  try {
    const url = "https://api.frankfurter.app/latest?from=USD&to=AUD,CAD,NZD,GBP,EUR";
    const fxRes = await fetch(url, {
      headers: { "User-Agent": "Lykodex/1.0 (+https://lykodex.vercel.app)", "Accept": "application/json" },
    });
    if (!fxRes.ok) return res.status(fxRes.status).json({ error: "Exchange rate request failed" });
    const data = await fxRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  allowCors(res);
  // The browser's CORS preflight for a non-simple request (Xbox/PSN
  // linking's POST + Authorization header, cross-origin from a
  // packaged build — see _cors.js) lands here as a real OPTIONS
  // request expecting a bare 204, not any service's actual response.
  if (req.method === "OPTIONS") return res.status(204).end();
  // Parsing from req.url rather than req.query — cheapshark.js's
  // original comment noted req.query was unreliable under some
  // vercel dev setups, keeping the same safer approach here.
  const { searchParams } = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const service = searchParams.get("service");

  if (service === "xbxprices") return handleXbxprices(searchParams, res);
  if (service === "platprices") return handlePlatprices(searchParams, res);
  if (service === "cheapshark") return handleCheapshark(searchParams, res);
  if (service === "currency") return handleCurrency(res);
  if (service === "cardkingdom") return handleCardKingdom(searchParams, res);
  if (service === "tcgaggregator") return handleTcgAggregator(res);
  if (service === "rebrickable") return handleRebrickable(searchParams, res);
  if (service === "comicvine") return handleComicVine(searchParams, res);
  if (service === "justtcg") return handleJustTcg(res);
  if (service === "riftbound") return handleRiftbound(searchParams, res);
  if (service === "xbox") return handleXbox(req, searchParams, res);
  if (service === "psn") return handlePsn(req, searchParams, res);
  if (service === "crunchyroll") return handleCrunchyroll(req, searchParams, res);
  if (service === "mastery-cron") return handleMasteryCron(req, res);
  if (service === "lykodex-session") return handleLykodexSession(req, res);

  return res.status(400).json({ error: "Missing or invalid service parameter" });
}
