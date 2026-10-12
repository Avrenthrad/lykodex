// Copy of src/lib/overallMastery.js's pure scoring math — duplicated
// here for the same reason gameMastery.js is: this bot is a separate
// deployable package from the main Vite app, not a shared workspace.
// Keep this in sync with the original by hand if the scoring formulas
// ever change there.

import { normalize, accountXpFromMastery, levelFromXp } from "./gameMastery.js";

export { accountXpFromMastery, levelFromXp };

export const TYPICAL_MAX = {
  tcg: 1500,
  entertainment: 750,
  collectibles: 1000,
  tabletop: 900,
  // 100 hours of genuinely social voice chat ≈ 1000 (see computeSocialRaw)
  social: 1000,
};

// entries: [{ card_name, quantity, foil, card: { rarity, prices } }]
// decks: [{ ... }] (just needs .length)
export function computeTcgRaw(entries, deckCount) {
  const uniqueCards = entries.length;
  const totalValueUSD = entries.reduce((sum, e) => {
    const price = e.foil ? e.card?.prices?.usd_foil : e.card?.prices?.usd;
    return sum + (Number(price) || 0) * e.quantity;
  }, 0);
  return uniqueCards * 2 + totalValueUSD * 0.5 + (deckCount || 0) * 20;
}

// entries: entertainment_entries rows, each with .status
// discordMedia (optional): { listeningSeconds, watchingSeconds } from
// the Discord bot's opt-in tracking (discord_activity_totals).
// Watching counts more per hour than music, which tends to run in the
// background for hours.
export function computeEntertainmentRaw(entries, discordMedia) {
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const inProgressCount = entries.filter(
    (e) => e.status === "watching" || e.status === "want_to_watch"
  ).length;
  const listeningHours = (discordMedia?.listeningSeconds || 0) / 3600;
  const watchingHours = (discordMedia?.watchingSeconds || 0) / 3600;
  return completedCount * 15 + inProgressCount * 2 + listeningHours * 1 + watchingHours * 4;
}

// Social College — voice chat time tracked by the Discord bot (opt-in).
// Only "active" seconds count: not deafened, not AFK, not alone.
export function computeSocialRaw(voiceActiveSeconds) {
  return ((voiceActiveSeconds || 0) / 3600) * 10;
}

// entries: collectible_entries rows, each with .qty, .price_paid, .is_wishlist
// Wishlist-only entries aren't real owned items, so they don't count.
export function computeCollectiblesRaw(entries) {
  const owned = entries.filter((e) => !e.is_wishlist);
  const itemCount = owned.reduce((sum, e) => sum + (e.qty || 0), 0);
  const totalSpendUSD = owned.reduce((sum, e) => sum + (Number(e.price_paid) || 0) * (e.qty || 0), 0);
  return itemCount * 8 + totalSpendUSD * 0.3;
}

// campaigns: tabletop_campaigns rows (each has .total_session_minutes)
export function computeTabletopRaw(campaigns, characterCount, armyCount) {
  const sessionMinutes = campaigns.reduce((sum, c) => sum + (c.total_session_minutes || 0), 0);
  const sessionHours = sessionMinutes / 60;
  return sessionHours * 15 + campaigns.length * 40 + (characterCount || 0) * 10 + (armyCount || 0) * 15;
}

// collegeScores: { gaming?: number (already 0-1000 normalized),
//   tcg?: number (raw), entertainment?: number (raw),
//   collectibles?: number (raw), tabletop?: number (raw), social?: number (raw) }
// A key is only present when that College actually has real data —
// same "missing = not counted" rule as computeMasteryScore.
// Returns null when every College is empty (never a fabricated 0).
export function computeOverallScore(collegeScores) {
  const entries = Object.entries(collegeScores || {}).filter(
    ([, v]) => v !== null && v !== undefined
  );
  if (entries.length === 0) return null;

  const normalized = entries.map(([college, raw]) => ({
    college,
    raw,
    normalized: college === "gaming" ? raw : normalize(raw, TYPICAL_MAX[college] || 1000),
  }));

  const overallScore =
    normalized.reduce((sum, n) => sum + n.normalized, 0) / normalized.length;

  return { overallScore, breakdown: normalized };
}
