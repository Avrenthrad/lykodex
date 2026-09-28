// Overall Mastery Score — real data gathering + Supabase persistence.
// The actual scoring math lives in lib/overallMastery.js (pure, no
// network); this file gathers each College's real, already-stored
// data and combines it via that module, then caches the result on the
// profile the same way lib/gameMasteryData.js already does for
// Gaming's own score.

import { supabase } from "./supabaseClient";
import { fetchCollection, fetchDecks, enrichCollectionEntry } from "./mtg";
import { fetchEntertainmentEntries } from "./entertainment";
import { fetchCollectibles } from "./collectibles";
import { fetchCampaigns, fetchCharacters, fetchArmies } from "./tabletop";
import { computeTcgRaw, computeEntertainmentRaw, computeCollectiblesRaw, computeTabletopRaw, computeSocialRaw, computeOverallScore, accountXpFromMastery, levelFromXp } from "./overallMastery";

async function gatherTcg(userId) {
  const [rows, decks] = await Promise.all([fetchCollection(userId), fetchDecks(userId)]);
  if (rows.length === 0) return null;
  const enriched = await Promise.all(rows.map(enrichCollectionEntry));
  return computeTcgRaw(enriched, decks.length);
}

// Totals recorded by the Lykodex Discord bot (opt-in tracking) — voice
// chat, Spotify listening and "Watching" time. null when the person has
// never had any Discord activity recorded (or the view doesn't exist
// yet), which simply leaves those contributions out.
async function fetchDiscordTotals(userId) {
  const { data, error } = await supabase
    .from("discord_activity_totals")
    .select("voice_active_seconds, listening_seconds, watching_seconds")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function gatherEntertainment(userId, discordTotals) {
  const entries = await fetchEntertainmentEntries(userId);
  const media = {
    listeningSeconds: Number(discordTotals?.listening_seconds) || 0,
    watchingSeconds: Number(discordTotals?.watching_seconds) || 0,
  };
  if (entries.length === 0 && media.listeningSeconds + media.watchingSeconds === 0) return null;
  return computeEntertainmentRaw(entries, media);
}

function gatherSocial(discordTotals) {
  const seconds = Number(discordTotals?.voice_active_seconds) || 0;
  return seconds > 0 ? computeSocialRaw(seconds) : null;
}

async function gatherCollectibles(userId) {
  const entries = await fetchCollectibles(userId);
  const owned = entries.filter((e) => !e.is_wishlist);
  if (owned.length === 0) return null;
  return computeCollectiblesRaw(entries);
}

async function gatherTabletop(userId) {
  const [campaigns, characters, armies] = await Promise.all([
    fetchCampaigns(userId),
    fetchCharacters(userId),
    fetchArmies(userId),
  ]);
  if (campaigns.length === 0 && characters.length === 0 && armies.length === 0) return null;
  return computeTabletopRaw(campaigns, characters.length, armies.length);
}

// The one function the rest of the app calls: gathers whatever real
// data each College actually has (a College with nothing added is
// simply left out, per computeOverallScore's rule), combines it, and
// persists the result on the profile — recomputed on demand /
// key-event triggers rather than on every render, same cached-on-
// profile pattern gd_score and mastery_score already use.
export async function recomputeOverallMastery(userId, gamingMasteryScore) {
  const discordTotals = await fetchDiscordTotals(userId).catch((err) => {
    console.error("Discord activity totals fetch failed:", err);
    return null;
  });
  const socialRaw = gatherSocial(discordTotals);
  const [tcgRaw, entertainmentRaw, collectiblesRaw, tabletopRaw] = await Promise.all([
    gatherTcg(userId).catch((err) => { console.error("TCG mastery data fetch failed:", err); return null; }),
    gatherEntertainment(userId, discordTotals).catch((err) => { console.error("Entertainment mastery data fetch failed:", err); return null; }),
    gatherCollectibles(userId).catch((err) => { console.error("Collectibles mastery data fetch failed:", err); return null; }),
    gatherTabletop(userId).catch((err) => { console.error("Tabletop mastery data fetch failed:", err); return null; }),
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

  return {
    overallScore: result.overallScore,
    accountXp: result.accountXp,
    accountLevel: level,
    breakdown: result.breakdown,
    computedAt,
  };
}
