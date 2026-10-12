// Copy of src/lib/gameMastery.js's pure scoring math — duplicated here
// because this bot is a separate deployable package from the main
// Vite app, not a shared workspace. Keep this in sync with the
// original by hand if the scoring formulas ever change there.

// ---------- Rarity multipliers ----------

// Steam (and any platform reporting a real global unlock percentage).
// null/undefined percent means "rarity unknown" — treated as common
// (1.0), never assumed rare, with the caller expected to label it as
// such rather than silently treating it like a verified common.
export function rarityMultiplierFromPercent(percent) {
  if (percent === null || percent === undefined || Number.isNaN(Number(percent))) return 1.0;
  const p = Number(percent);
  if (p <= 1) return 3.0;
  if (p <= 5) return 2.2;
  if (p <= 15) return 1.6;
  if (p <= 30) return 1.3;
  if (p <= 50) return 1.1;
  return 1.0;
}

export const PS_TROPHY_TIERS = ["bronze", "silver", "gold", "platinum"];
export const PS_TROPHY_TIER_POINTS = {
  bronze: 15,
  silver: 30,
  gold: 90,
  platinum: 180,
};

// ---------- Per-platform raw scores ----------

// xboxScore = 100 * log10(1 + gamerscore)
export function computeXboxScore(gamerscore) {
  const g = Math.max(0, Number(gamerscore) || 0);
  return 100 * Math.log10(1 + g);
}

// counts: { bronze: number, silver: number, gold: number, platinum: number }
// No rarity weighting — see src/lib/gameMastery.js for why that was
// dropped (kept in sync with this file).
export function computePsScore(counts) {
  if (!counts) return 0;
  let total = 0;
  for (const tier of PS_TROPHY_TIERS) {
    const count = Math.max(0, Number(counts[tier]) || 0);
    total += count * PS_TROPHY_TIER_POINTS[tier];
  }
  return total;
}

// achievements: [{ unlockPercent: number | null }] — one entry per
// real unlocked Steam achievement (see masteryRefresh.js for how
// these get gathered from the real Steam Web API).
export function computeSteamScore(achievements) {
  if (!achievements || achievements.length === 0) return 0;
  return achievements.reduce(
    (sum, a) => sum + 10 * rarityMultiplierFromPercent(a.unlockPercent),
    0
  );
}

// ---------- Combining into one uncapped Mastery Score ----------

// norm(x, typicalMax) = 1000 * (x / typicalMax)
// Linear, deliberately uncapped — typicalMax is a reference point
// ("about what a genuinely serious player hits"), not a ceiling. Kept
// in sync with src/lib/gameMastery.js — see that file for why the
// previous exponential diminishing-returns curve was replaced (it
// saturated to "1000/1000" for any reasonably dedicated player well
// before they were anywhere near the top of what's achievable).
export function normalize(x, typicalMax) {
  if (!typicalMax || typicalMax <= 0) return 0;
  return 1000 * (Math.max(0, x) / typicalMax);
}

export const TYPICAL_MAX = {
  xbox: 500,
  // Kept in sync with src/lib/gameMastery.js — lowered from 8000
  // alongside removing the PS rarity multipliers above.
  playstation: 5300,
  steam: 5000,
};

// rawScores: { xbox?: number, playstation?: number, steam?: number }
// — a platform key is only present when that platform is actually
// linked/reported; a platform with no real data contributes nothing,
// per the "missing platform = score from platforms present only" rule.
// Returns null when nothing is linked at all (never a fabricated 0
// pretending to be a real score for someone with no data anywhere).
export function computeMasteryScore(rawScores) {
  const entries = Object.entries(rawScores || {}).filter(
    ([, v]) => v !== null && v !== undefined
  );
  if (entries.length === 0) return null;

  const normalized = entries.map(([platform, raw]) => ({
    platform,
    raw,
    normalized: normalize(raw, TYPICAL_MAX[platform] || 1000),
  }));

  const masteryScore =
    normalized.reduce((sum, n) => sum + n.normalized, 0) / normalized.length;

  return { masteryScore, breakdown: normalized };
}

// ---------- Account XP / Level ----------

// accountXP_from_mastery = floor(masteryScore * 10)
export function accountXpFromMastery(masteryScore) {
  return Math.floor((masteryScore || 0) * 10);
}

// Triangular curve: cumulative XP required to REACH level L is
// 100 * L * (L + 1) — level 0 needs 0 XP, level 1 needs 200, level 2
// needs 600, etc.
export function cumulativeXpForLevel(level) {
  return 100 * level * (level + 1);
}

// Returns the current level for a given XP total, plus enough to
// drive an XP progress bar: how far into the current level, and how
// much the current level actually spans.
export function levelFromXp(xp) {
  const totalXp = Math.max(0, Number(xp) || 0);

  // Closed-form estimate from solving 100*L*(L+1) <= xp for L, then
  // nudged to the exact integer level — avoids an unbounded loop for
  // pathologically large XP values while staying exact.
  let level = Math.max(0, Math.floor((-100 + Math.sqrt(10000 + 400 * totalXp)) / 200));
  while (cumulativeXpForLevel(level + 1) <= totalXp) level += 1;
  while (level > 0 && cumulativeXpForLevel(level) > totalXp) level -= 1;

  const xpIntoLevel = totalXp - cumulativeXpForLevel(level);
  const xpForNextLevel = cumulativeXpForLevel(level + 1) - cumulativeXpForLevel(level);

  return {
    level,
    xpIntoLevel,
    xpForNextLevel,
    progress: xpForNextLevel > 0 ? xpIntoLevel / xpForNextLevel : 0,
  };
}
