// Pure formatting helpers — no Discord or Supabase calls, so they're
// easy to unit test (see test/format.test.js).

export const BRAND_COLOR = 0xd4a537; // Lykodex gold

export function formatNumber(n, digits = 0) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-AU", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatMinutes(totalMinutes) {
  const m = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem ? `${formatNumber(h)}h ${rem}m` : `${formatNumber(h)}h`;
}

export function progressBar(fraction, width = 12) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const filled = Math.round(f * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function displayName(profile, fallback = "Someone") {
  return profile?.username || profile?.first_name || fallback;
}

const PLATFORM_LABELS = {
  xbox: "Xbox",
  playstation: "PlayStation",
  steam: "PC / Steam",
  unknown: "",
};
export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] ?? "";
}

const MEDALS = ["🥇", "🥈", "🥉"];
export function rankPrefix(index) {
  return MEDALS[index] || `\`#${index + 1}\``;
}

// ---------- Activity feed ----------

// How each Lykodex guild_activity event reads in Discord. {n} is the
// count when several of the same event get batched together.
export const EVENT_TEXT = {
  achievement_unlocked: { one: "unlocked an achievement", many: "unlocked {n} achievements", emoji: "🏆" },
  game_completed: { one: "100%'d a game", many: "100%'d {n} games", emoji: "💯" },
  backlog_completed: { one: "finished a game", many: "finished {n} games", emoji: "✅" },
  backlog_status_change: { one: "updated their backlog", many: "made {n} backlog updates", emoji: "📋" },
  wishlist_added: { one: "wishlisted", many: "added {n} games to their wishlist", emoji: "⭐" },
  gd_score_milestone: { one: "hit a score milestone", many: "hit {n} score milestones", emoji: "📈" },
  mtg_card_added: { one: "added a Magic card", many: "added {n} Magic cards", emoji: "🃏" },
  fab_card_added: { one: "added a Flesh and Blood card", many: "added {n} Flesh and Blood cards", emoji: "🃏" },
  pokemon_card_added: { one: "added a Pokémon card", many: "added {n} Pokémon cards", emoji: "🃏" },
  yugioh_card_added: { one: "added a Yu-Gi-Oh! card", many: "added {n} Yu-Gi-Oh! cards", emoji: "🃏" },
  onepiece_card_added: { one: "added a One Piece card", many: "added {n} One Piece cards", emoji: "🃏" },
  riftbound_card_added: { one: "added a Riftbound card", many: "added {n} Riftbound cards", emoji: "🃏" },
};

// Guild-internal events (posts/comments inside a Lykodex guild, joins)
// only make sense inside that guild, so they don't go to Discord.
export function isFeedableEvent(eventType) {
  return Object.hasOwn(EVENT_TEXT, eventType);
}

// Lykodex fans one real event out into one guild_activity row per
// Lykodex guild the person is in, so the same event shows up N times.
// Collapse those back to one before posting.
export function dedupeActivity(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.user_id}|${row.event_type}|${JSON.stringify(row.event_data ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// rows: deduped guild_activity rows, oldest first.
// Returns one line per (person, event type), e.g.
//   "⭐ **Josh** added 37 games to their wishlist — Hades, Celeste, Tunic +34 more"
export function summarizeActivity(rows, nameFor, maxTitles = 3) {
  const groups = new Map();
  for (const row of rows) {
    if (!isFeedableEvent(row.event_type)) continue;
    const key = `${row.user_id}|${row.event_type}`;
    if (!groups.has(key)) groups.set(key, { userId: row.user_id, eventType: row.event_type, titles: [] });
    const title = row.event_data?.title;
    groups.get(key).titles.push(title ? String(title) : null);
  }

  return [...groups.values()].map(({ userId, eventType, titles }) => {
    const text = EVENT_TEXT[eventType];
    const n = titles.length;
    const verb = n === 1 ? text.one : text.many.replace("{n}", formatNumber(n));
    const named = titles.filter(Boolean);
    let detail = "";
    if (named.length) {
      const shown = named.slice(0, maxTitles).map((t) => `**${truncate(t, 60)}**`);
      const extra = n - shown.length;
      detail = (n === 1 ? ": " : " — ") + shown.join(", ") + (extra > 0 ? ` +${formatNumber(extra)} more` : "");
    }
    return `${text.emoji} **${nameFor(userId)}** ${verb}${detail}`;
  });
}

export function truncate(s, max) {
  const str = String(s ?? "");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// Discord message content limit is 2000 chars — split lines into
// messages that each fit.
export function chunkLines(lines, limit = 1900) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && current) {
      chunks.push(current);
      current = truncate(line, limit);
    } else {
      current = truncate(next, limit);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------- Leaderboards ----------

// entries: [{ userId, value }] -> sorted, zero/missing values dropped,
// ties share a rank position in order they arrived.
export function rankEntries(entries, limit = 10) {
  return entries
    .filter((e) => Number(e.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, limit);
}
