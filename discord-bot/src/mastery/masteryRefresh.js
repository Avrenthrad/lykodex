// Daily Gaming + Overall Mastery refresh.
//
// Mirrors src/lib/gameMasteryData.js's recomputeMastery() and
// src/lib/overallMasteryData.js's recomputeOverallMastery(), but runs
// here on the always-on bot on a 24h schedule (see index.js) instead
// of on-demand in the browser — a Vercel Cron Job was the other
// option, but the Hobby plan's ~10s serverless execution limit makes
// it unreliable for scanning many users' Steam libraries (or MTG
// collections) in one run.
//
// Honest scope, Gaming Mastery: every run pulls REAL, live data from
// the Steam Web API for anyone with a linked Steam account, so that
// portion is a genuine daily refresh. Xbox Gamerscore and PlayStation
// trophy counts are self-reported (see mastery_inputs in schema.sql —
// no public API exists for either, confirmed while building Account
// Linking), so this does NOT pull anything new for them. It just
// re-applies whatever numbers the person last typed in themselves,
// recombined with the fresh Steam score — keeping the combined
// Mastery Score from silently going stale on the Steam side.
//
// Honest scope, Overall Mastery: TCG's contribution is real live
// Scryfall pricing for a person's MTG collection specifically — same
// as the browser's own overallMasteryData.js, which only wires in
// lib/mtg.js (not lib/fabCollection.js or lib/pokemonCollection.js
// yet). Entertainment/Collectibles/Tabletop use whatever's already
// stored in Supabase, same as the browser does — no live external
// calls needed for those three.

import {
  computeXboxScore,
  computePsScore,
  computeSteamScore,
  computeMasteryScore,
  accountXpFromMastery,
  levelFromXp,
} from "./gameMastery.js";
import {
  computeTcgRaw,
  computeEntertainmentRaw,
  computeCollectiblesRaw,
  computeTabletopRaw,
  computeSocialRaw,
  computeOverallScore,
} from "./overallMastery.js";

// The site's own /api/steam Vercel function — same proxy the browser
// calls, reused here instead of duplicating a second STEAM_API_KEY +
// the fetch logic in api/steam.js on the bot's side.
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "https://lykodex.vercel.app").replace(/\/$/, "");

// Same bound as gameMasteryData.js's GAMES_TO_SCAN — scanning a
// person's entire library isn't worth the API load for a periodic
// recompute; this is an honestly-labeled subset, not the whole thing.
const GAMES_TO_SCAN = 15;

async function steamApi(query) {
  const res = await fetch(`${SITE_BASE_URL}/api/steam?${query}`);
  if (!res.ok) throw new Error(`Steam proxy request failed (${res.status}): ${query}`);
  return res.json();
}

async function fetchOwnedGames(steamId) {
  const data = await steamApi(`steamid=${encodeURIComponent(steamId)}`);
  return data.response?.games || [];
}

async function fetchAchievements(steamId, appId) {
  const data = await steamApi(`steamid=${encodeURIComponent(steamId)}&appid=${appId}`);
  return data.playerstats?.achievements || [];
}

async function fetchGlobalAchievementPercentages(appId) {
  const data = await steamApi(`appid=${appId}&mode=globalAchievementPercentages`);
  return data.achievementpercentages?.achievements || [];
}

// Same site-proxy pattern as steamApi — the site's own /api/scryfall
// Vercel function, reused instead of duplicating Scryfall's response
// shape here. Cached per run (not per user) since the same real card
// is often owned by more than one person.
const cardCache = new Map();
async function fetchScryfallCard(scryfallId) {
  if (cardCache.has(scryfallId)) return cardCache.get(scryfallId);
  const card = await fetch(`${SITE_BASE_URL}/api/scryfall?mode=card&id=${scryfallId}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data ? { prices: data.prices || {} } : null))
    .catch(() => null);
  cardCache.set(scryfallId, card);
  return card;
}

async function gatherSteamAchievements(steamId) {
  const games = await fetchOwnedGames(steamId);
  const topGames = [...games]
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, GAMES_TO_SCAN);

  const perGame = await Promise.all(
    topGames.map(async (game) => {
      try {
        const [achievements, percentages] = await Promise.all([
          fetchAchievements(steamId, game.appid),
          fetchGlobalAchievementPercentages(game.appid),
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

  return { achievements: perGame.flat(), gamesScanned: topGames.length };
}

async function recomputeMasteryForUser(supabase, userId, linkedSteamId) {
  const { data: inputs } = await supabase
    .from("mastery_inputs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const rawScores = {};
  const sources = {};

  if (inputs?.xbox_gamerscore !== null && inputs?.xbox_gamerscore !== undefined) {
    rawScores.xbox = computeXboxScore(inputs.xbox_gamerscore);
    sources.xbox = { source: "self_reported", asOf: inputs.xbox_updated_at, gamerscore: inputs.xbox_gamerscore };
  }

  if (inputs?.ps_trophy_counts) {
    rawScores.playstation = computePsScore(inputs.ps_trophy_counts);
    sources.playstation = { source: "self_reported", asOf: inputs.ps_updated_at };
  }

  if (linkedSteamId) {
    const { achievements, gamesScanned } = await gatherSteamAchievements(linkedSteamId);
    rawScores.steam = computeSteamScore(achievements);
    sources.steam = {
      source: "live_steam_api",
      asOf: new Date().toISOString(),
      gamesScanned,
      achievementsCounted: achievements.length,
    };
  }

  const combined = computeMasteryScore(rawScores);

  const result = combined
    ? {
        masteryScore: combined.masteryScore,
        accountXp: accountXpFromMastery(combined.masteryScore),
        breakdown: combined.breakdown.map((entry) => ({ ...entry, ...sources[entry.platform] })),
      }
    : { masteryScore: 0, accountXp: 0, breakdown: [] };

  const { level } = levelFromXp(result.accountXp);
  const computedAt = new Date().toISOString();

  const { error } = await supabase
    .from("profiles")
    .update({
      mastery_score: result.masteryScore,
      mastery_xp: result.accountXp,
      mastery_level: level,
      mastery_breakdown: result.breakdown,
      mastery_computed_at: computedAt,
    })
    .eq("id", userId);
  if (error) throw error;

  return combined ? result.masteryScore : null;
}

// entries: mtg_collection rows (each has .scryfall_id, .quantity, .foil)
async function gatherTcgRaw(supabase, userId) {
  const [{ data: rows, error: rowsErr }, { data: decks, error: decksErr }] = await Promise.all([
    supabase.from("mtg_collection").select("scryfall_id, quantity, foil").eq("user_id", userId),
    supabase.from("mtg_decks").select("id").eq("user_id", userId),
  ]);
  if (rowsErr) throw rowsErr;
  if (decksErr) throw decksErr;
  if (!rows || rows.length === 0) return null;

  const enriched = await Promise.all(
    rows.map(async (r) => ({ ...r, card: await fetchScryfallCard(r.scryfall_id) }))
  );
  return computeTcgRaw(enriched, (decks || []).length);
}

// Discord bot totals (voice / listening / watching seconds) — null when
// the person has never had any Discord activity recorded.
async function fetchDiscordTotals(supabase, userId) {
  const { data, error } = await supabase
    .from("discord_activity_totals")
    .select("voice_active_seconds, listening_seconds, watching_seconds")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function gatherEntertainmentRaw(supabase, userId, discordTotals) {
  const { data, error } = await supabase
    .from("entertainment_entries")
    .select("status")
    .eq("user_id", userId);
  if (error) throw error;
  const media = {
    listeningSeconds: Number(discordTotals?.listening_seconds) || 0,
    watchingSeconds: Number(discordTotals?.watching_seconds) || 0,
  };
  if ((!data || data.length === 0) && media.listeningSeconds + media.watchingSeconds === 0) return null;
  return computeEntertainmentRaw(data || [], media);
}

function gatherSocialRaw(discordTotals) {
  const seconds = Number(discordTotals?.voice_active_seconds) || 0;
  return seconds > 0 ? computeSocialRaw(seconds) : null;
}

async function gatherCollectiblesRaw(supabase, userId) {
  const { data, error } = await supabase
    .from("collectible_entries")
    .select("qty, price_paid, is_wishlist")
    .eq("user_id", userId);
  if (error) throw error;
  const owned = (data || []).filter((e) => !e.is_wishlist);
  if (owned.length === 0) return null;
  return computeCollectiblesRaw(data);
}

async function gatherTabletopRaw(supabase, userId) {
  const [
    { data: campaigns, error: campErr },
    { data: characters, error: charErr },
    { data: armies, error: armyErr },
  ] = await Promise.all([
    supabase.from("tabletop_campaigns").select("total_session_minutes").eq("user_id", userId),
    supabase.from("tabletop_characters").select("id").eq("user_id", userId),
    supabase.from("wargame_armies").select("id").eq("user_id", userId),
  ]);
  if (campErr) throw campErr;
  if (charErr) throw charErr;
  if (armyErr) throw armyErr;
  if ((campaigns || []).length === 0 && (characters || []).length === 0 && (armies || []).length === 0) return null;
  return computeTabletopRaw(campaigns || [], (characters || []).length, (armies || []).length);
}

// gamingMasteryScore: this same run's just-computed Gaming Mastery
// score for this user (null if they have no Gaming-relevant data —
// same "College absent = not counted" rule the browser's
// overallMasteryData.js already follows, applied one level up here).
async function recomputeOverallMasteryForUser(supabase, userId, gamingMasteryScore) {
  const discordTotals = await fetchDiscordTotals(supabase, userId);
  const socialRaw = gatherSocialRaw(discordTotals);
  const [tcgRaw, entertainmentRaw, collectiblesRaw, tabletopRaw] = await Promise.all([
    gatherTcgRaw(supabase, userId),
    gatherEntertainmentRaw(supabase, userId, discordTotals),
    gatherCollectiblesRaw(supabase, userId),
    gatherTabletopRaw(supabase, userId),
  ]);

  const collegeScores = {};
  if (gamingMasteryScore) collegeScores.gaming = gamingMasteryScore;
  if (tcgRaw !== null) collegeScores.tcg = tcgRaw;
  if (entertainmentRaw !== null) collegeScores.entertainment = entertainmentRaw;
  if (collectiblesRaw !== null) collegeScores.collectibles = collectiblesRaw;
  if (tabletopRaw !== null) collegeScores.tabletop = tabletopRaw;
  if (socialRaw !== null) collegeScores.social = socialRaw;

  const combined = computeOverallScore(collegeScores);

  const result = combined
    ? { overallScore: combined.overallScore, accountXp: accountXpFromMastery(combined.overallScore), breakdown: combined.breakdown }
    : { overallScore: 0, accountXp: 0, breakdown: [] };

  const { level } = levelFromXp(result.accountXp);
  const computedAt = new Date().toISOString();

  const { error } = await supabase
    .from("profiles")
    .update({
      overall_mastery_score: result.overallScore,
      overall_mastery_xp: result.accountXp,
      overall_mastery_level: level,
      overall_mastery_breakdown: result.breakdown,
      overall_mastery_computed_at: computedAt,
    })
    .eq("id", userId);
  if (error) throw error;
}

// Gaming Mastery recomputes for every profile with ANY real
// Gaming-relevant data — a linked Steam account, or a self-reported
// Xbox/PlayStation input row. Overall Mastery then runs for EVERY
// profile regardless — a person can have a real TCG/Entertainment/
// Collectibles/Tabletop score with zero Gaming data, and Overall
// Mastery should still reflect that (same "missing College isn't
// counted" rule, applied one level up). Both run sequentially (not in
// parallel) to stay polite to the Steam API and Scryfall rather than
// firing dozens of concurrent requests.
export async function runDailyMasteryRefresh(supabase) {
  const [
    { data: allProfiles, error: profilesErr },
    { data: steamProfiles, error: steamErr },
    { data: inputRows, error: inputErr },
  ] = await Promise.all([
    supabase.from("profiles").select("id"),
    supabase.from("profiles").select("id, linked_steam_id").not("linked_steam_id", "is", null),
    supabase.from("mastery_inputs").select("user_id"),
  ]);
  if (profilesErr) throw profilesErr;
  if (steamErr) throw steamErr;
  if (inputErr) throw inputErr;

  const steamByUser = new Map((steamProfiles || []).map((p) => [p.id, p.linked_steam_id]));
  const gamingRelevantIds = new Set([...steamByUser.keys(), ...(inputRows || []).map((r) => r.user_id)]);

  let succeeded = 0;
  let failed = 0;
  for (const profile of allProfiles || []) {
    const userId = profile.id;
    try {
      const gamingMasteryScore = gamingRelevantIds.has(userId)
        ? await recomputeMasteryForUser(supabase, userId, steamByUser.get(userId) || null)
        : null;
      await recomputeOverallMasteryForUser(supabase, userId, gamingMasteryScore);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(`Mastery refresh failed for user ${userId}:`, err.message);
    }
  }

  return { total: (allProfiles || []).length, succeeded, failed };
}
