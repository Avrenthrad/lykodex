// Vercel serverless function — proxies Steam Web API calls.
// Runs on Vercel's servers, not in the browser, so:
//   1. It can actually reach api.steampowered.com (Steam blocks direct
//      browser requests — no CORS support).
//   2. STEAM_API_KEY never gets shipped to the browser, unlike anything
//      prefixed VITE_ in .env.
//
// Usage from the frontend: fetch("/api/steam?steamid=...")            -> library
//                           fetch("/api/steam?steamid=...&appid=...") -> achievements
//                           fetch("/api/steam?appid=...&mode=players")-> live player count
//                           fetch("/api/steam?mode=charts")           -> top played games (rank + appid + players, no names)
//                           fetch("/api/steam?appid=...&mode=appinfo")-> name, thumb, release date, Metacritic score
//                           fetch("/api/steam?appid=...&mode=reviews")-> Steam's own review summary
//                           fetch("/api/steam?vanity=...&mode=resolveVanity") -> vanity URL name -> SteamID64
//                           fetch("/api/steam?steamid=...&mode=wishlist")     -> a user's public wishlist (appids)
//                           fetch("/api/steam?term=...&mode=search")          -> find games by name (primary search now, not CheapShark)
//                           fetch("/api/steam?appid=...&mode=achievementSchema")            -> achievement names/descriptions/icons
//                           fetch("/api/steam?appid=...&mode=globalAchievementPercentages") -> global unlock rarity per achievement
//                           fetch("/api/steam?steamid=...&mode=friendList")                 -> a person's real Steam friends (public profiles only)
//                           fetch("/api/steam?steamids=id1,id2,...&mode=playerSummaries")    -> live online/in-game status for up to 100 people
//                           fetch("/api/steam?appid=...&mode=news")                          -> real dev-posted announcements/patch notes for one app
//                           fetch("/api/steam?openid.*=...&mode=verifyOpenId")                -> verify a real "Sign in through Steam" callback, see lib/steamAuth.js

import { allowCors } from "./_cors.js";
import { parseSteamAppDetails } from "../src/lib/steamAppDetails.js";

export default async function handler(req, res) {
  allowCors(res);
  const apiKey = process.env.STEAM_API_KEY;
  const { steamid, appid, mode } = req.query;

  // Real "Sign in through Steam" verification (see lib/steamAuth.js) —
  // the browser redirect's ?openid.* params are trivially forgeable
  // client-side on their own, so this is the actual proof: re-post the
  // exact params Steam signed back to it with openid.mode switched to
  // check_authentication, and only trust the SteamID64 in
  // openid.claimed_id if Steam itself confirms is_valid:true. No API
  // key needed for this call — it's a different, keyless endpoint of
  // Steam's own OpenID provider, not the Steam Web API.
  if (mode === "verifyOpenId") {
    const params = { ...req.query };
    delete params.mode;
    if (!params["openid.claimed_id"] || !params["openid.sig"]) {
      return res.status(400).json({ error: "Missing OpenID response parameters" });
    }

    try {
      const body = new URLSearchParams({ ...params, "openid.mode": "check_authentication" });
      const steamRes = await fetch("https://steamcommunity.com/openid/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      // Steam's response here is plain key:value lines, not JSON.
      const text = await steamRes.text();
      if (!text.includes("is_valid:true")) {
        return res.status(400).json({ error: "Steam sign-in couldn't be verified" });
      }

      const claimedId = params["openid.claimed_id"];
      const steamIdMatch = /\/openid\/id\/(\d{17})$/.exec(claimedId);
      if (!steamIdMatch) {
        return res.status(400).json({ error: "Couldn't read a SteamID64 from the sign-in response" });
      }

      return res.status(200).json({ steamId: steamIdMatch[1] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Current player count is a public Steam endpoint — no key, no
  // steamid, just an appid. Kept in the same proxy since Steam still
  // blocks direct browser requests to it either way.
  if (mode === "players") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(appid)}`;
      const steamRes = await fetch(url);
      // Steam's own convention for this specific endpoint: a 404 status
      // with a genuinely valid JSON body ({"response":{"result":42}})
      // is how it signals "no live player-count data for this appid" —
      // true for the majority of non-blockbuster titles, not a real
      // failure. Treating !ok as a hard error here discarded that valid
      // body and turned "no data" into a thrown error for every such
      // wishlist item. Only a body that doesn't even parse as the
      // expected shape is a genuine failure.
      const data = await steamRes.json().catch(() => null);
      if (!data?.response) {
        return res.status(steamRes.status).json({ error: "Steam API request failed" });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Top played games chart — public, no key needed. Only returns
  // appid + rank + player counts, not names (that's what "appinfo" is for).
  if (mode === "charts") {
    try {
      const url = "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/";
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam charts request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Resolve one appid to its store name/thumbnail/release date/Metacritic
  // score — used to flesh out the wishlist cards. All of this comes from
  // Steam's own store API, which genuinely includes Metacritic scores
  // when a title has one (Valve licenses that data directly).
  if (mode === "appinfo") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=au`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam appdetails request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(parseSteamAppDetails(data, appid));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Steam's own aggregate review summary (e.g. "Very Positive", 94%
  // of 12,345 reviews). Public, no key needed.
  if (mode === "reviews") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    try {
      const url = `https://store.steampowered.com/appreviews/${encodeURIComponent(appid)}?json=1&language=all&purchase_type=all`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam reviews request failed" });
      }
      const data = await steamRes.json();
      const summary = data.query_summary;
      if (!summary) {
        return res.status(200).json({ scoreDesc: null });
      }
      return res.status(200).json({
        scoreDesc: summary.review_score_desc,
        totalPositive: summary.total_positive,
        totalNegative: summary.total_negative,
        totalReviews: summary.total_reviews,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Resolve a Steam vanity URL name (steamcommunity.com/id/NAME) to a
  // real SteamID64 — needed since GetWishlist only accepts the numeric ID.
  if (mode === "resolveVanity") {
    const { vanity } = req.query;
    if (!vanity) {
      return res.status(400).json({ error: "Missing vanity query parameter" });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "STEAM_API_KEY not set on the server" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanity)}`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam vanity URL resolve failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data.response);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // A user's wishlist — real endpoint on Valve's own API domain
  // (same style as GetOwnedGames etc.), just not listed on Valve's
  // sparse official docs page. Only works if the wishlist is public.
  if (mode === "wishlist") {
    if (!steamid) {
      return res.status(400).json({ error: "Missing steamid query parameter" });
    }
    try {
      const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamid)}`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam wishlist request failed — is it set to public?" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data.response);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Steam's own search — used as the primary way to find a game now,
  // instead of leaning on CheapShark for it. Public, no key needed.
  if (mode === "search") {
    const { term } = req.query;
    if (!term) {
      return res.status(400).json({ error: "Missing term query parameter" });
    }
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=au`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam search request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Achievement schema — the human-readable name/description/icon per
  // achievement (GetPlayerAchievements below only gives raw apiname +
  // achieved 0/1, not anything display-ready). Needs a key but not a
  // steamid — this is the same for every player, just game-specific.
  if (mode === "achievementSchema") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "STEAM_API_KEY not set on the server" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${encodeURIComponent(appid)}&key=${apiKey}`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam schema request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Global unlock rarity per achievement — public, no key needed. This
  // is where "X% of players have this" comes from.
  if (mode === "globalAchievementPercentages") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${encodeURIComponent(appid)}`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam global achievement percentages request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // A person's real Steam friends list — only works if their profile's
  // friends list is set to public.
  if (mode === "friendList") {
    if (!steamid) {
      return res.status(400).json({ error: "Missing steamid query parameter" });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "STEAM_API_KEY not set on the server" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${apiKey}&steamid=${encodeURIComponent(steamid)}&relationship=friend`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        // Steam returns a non-200 here when the friends list is
        // private, not just on a real error — surface it as empty
        // rather than a hard failure.
        return res.status(200).json({ friendslist: { friends: [] } });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Real, official dev-posted news for one app — patch notes, beta
  // access, preorder/launch announcements, whatever the developer
  // actually posts to their Steam Community hub. Public, no key
  // needed. This is Steam's real content, not a scrape or a general
  // news aggregator guessing at relevance.
  if (mode === "news") {
    if (!appid) {
      return res.status(400).json({ error: "Missing appid query parameter" });
    }
    try {
      const count = req.query.count || "5";
      const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appid)}&count=${encodeURIComponent(count)}&maxlength=300&format=json`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam news request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data.appnews || { newsitems: [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Real-time status for up to 100 people at once — online/offline,
  // and if they're currently in a game, which one. This is where
  // "live activity" actually comes from.
  if (mode === "playerSummaries") {
    const { steamids } = req.query;
    if (!steamids) {
      return res.status(400).json({ error: "Missing steamids query parameter" });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "STEAM_API_KEY not set on the server" });
    }
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${encodeURIComponent(steamids)}`;
      const steamRes = await fetch(url);
      if (!steamRes.ok) {
        return res.status(steamRes.status).json({ error: "Steam player summaries request failed" });
      }
      const data = await steamRes.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!apiKey) {
    return res.status(500).json({ error: "STEAM_API_KEY not set on the server" });
  }
  if (!steamid) {
    return res.status(400).json({ error: "Missing steamid query parameter" });
  }

  try {
    const url = appid
      ? `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${encodeURIComponent(appid)}&key=${apiKey}&steamid=${encodeURIComponent(steamid)}`
      : `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${encodeURIComponent(steamid)}&format=json&include_appinfo=1`;

    const steamRes = await fetch(url);
    if (!steamRes.ok) {
      return res.status(steamRes.status).json({ error: "Steam API request failed" });
    }
    const data = await steamRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
