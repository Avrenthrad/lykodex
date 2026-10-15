// Data for Overview's stock-style chart — mastery history (real daily
// snapshots) and Steam-attributed active hours (real per-game
// rtime_last_played when Steam provides it; otherwise an honest note).

import { supabase } from "./supabaseClient";
import { withLiveMasteryPoint } from "./masterySnapshot.js";

export { withLiveMasteryPoint };
import { fetchFriends, fetchFriendsSteamIds, fetchFriendsMasteryHistory } from "./friends";
import { fetchGuildmateIds, fetchGuildmatesMasteryHistory } from "./guilds";
import { getPublicProfiles } from "./publicProfiles";
import { fetchOwnedGames } from "./steam";

export const CHART_RANGES = [
  { id: "day", label: "D", days: 1 },
  { id: "week", label: "W", days: 7 },
  { id: "month", label: "M", days: 30 },
  { id: "year", label: "Y", days: 365 },
  { id: "all", label: "All", days: 3650 },
];

export function rangeToDays(rangeId) {
  return CHART_RANGES.find((r) => r.id === rangeId)?.days ?? 7;
}

function peerLabel(profile) {
  if (!profile) return "Someone";
  const full = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return full || profile.username || "Someone";
}

function dayKeyFromUnix(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function toChartPoints(dayValueMap) {
  return [...dayValueMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({
      time: Math.floor(new Date(`${day}T12:00:00Z`).getTime() / 1000),
      value: Math.round(value * 10) / 10,
    }));
}

function masteryRowsToPoints(rows) {
  const bySecond = new Map();
  for (const row of rows) {
    const time = Math.floor(new Date(row.recorded_at).getTime() / 1000);
    bySecond.set(time, Number(row.overall_mastery_score));
  }
  return [...bySecond.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time, value }));
}

function buildMasteryPeerSeries(rows, kind, profileById) {
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  return [...byUser.entries()]
    .map(([userId, userRows]) => ({
      userId,
      kind,
      label: peerLabel(profileById[userId]),
      points: masteryRowsToPoints(userRows),
    }))
    .filter((s) => s.points.length > 0);
}

function steamHoursByDay(games, sinceUnix) {
  const map = new Map();
  for (const g of games) {
    const mins = g.playtime_2weeks || 0;
    if (mins <= 0) continue;
    if (g.rtime_last_played && g.rtime_last_played >= sinceUnix) {
      const day = dayKeyFromUnix(g.rtime_last_played);
      map.set(day, (map.get(day) || 0) + mins / 60);
    }
  }
  return toChartPoints(map);
}

function gamesToDayMap(games, sinceUnix) {
  const map = new Map();
  for (const g of games) {
    const mins = g.playtime_2weeks || 0;
    if (mins <= 0 || !g.rtime_last_played || g.rtime_last_played < sinceUnix) continue;
    const day = dayKeyFromUnix(g.rtime_last_played);
    map.set(day, (map.get(day) || 0) + mins / 60);
  }
  return map;
}

export async function fetchSelfMasteryHistory(userId, sinceDays) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from("mastery_score_history")
    .select("overall_mastery_score, recorded_at")
    .eq("user_id", userId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// The status RPC lands with the mastery refresh migration. Until that
// SQL is applied, the chart still works — it just has no job timestamp.
export async function fetchMasteryRefreshStatus() {
  const { data, error } = await supabase.rpc("get_mastery_refresh_status");
  if (error) {
    const missing = /get_mastery_refresh_status|PGRST202|schema cache/i.test(error.message || "");
    if (!missing) console.warn("Mastery refresh status unavailable:", error.message);
    return null;
  }
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function loadOverviewChartData({ userId, linkedSteamId, sinceDays, includeHours = false }) {
  const friends = await fetchFriends(userId);
  const friendIds = friends.map((f) => f.friend_id);
  const friendProfileById = Object.fromEntries(friends.map((f) => [f.friend_id, f.profile]));
  const sinceUnix = Math.floor((Date.now() - sinceDays * 86400000) / 1000);

  const guildmateIds = await fetchGuildmateIds(userId, { excludeIds: friendIds });

  const [selfMasteryRows, friendMasteryRows, guildMasteryRows, steamLinks, refreshJob] = await Promise.all([
    fetchSelfMasteryHistory(userId, sinceDays),
    fetchFriendsMasteryHistory(friendIds, sinceDays),
    fetchGuildmatesMasteryHistory(guildmateIds, sinceDays).catch((err) => {
      console.warn("Guild mastery history unavailable:", err);
      return [];
    }),
    includeHours ? fetchFriendsSteamIds(friendIds) : Promise.resolve([]),
    fetchMasteryRefreshStatus(),
  ]);

  const guildProfiles = guildmateIds.length
    ? await getPublicProfiles(guildmateIds)
    : [];
  const guildProfileById = Object.fromEntries(guildProfiles.map((p) => [p.id, p]));

  const masteryYou = masteryRowsToPoints(selfMasteryRows);
  const masteryPeers = [
    ...buildMasteryPeerSeries(friendMasteryRows, "friend", friendProfileById),
    ...buildMasteryPeerSeries(guildMasteryRows, "guild", guildProfileById),
  ];

  let hoursYou = [];
  let hoursPeers = [];
  let hoursNote = null;

  // Active hours needs a Steam library fetch per person. The default
  // Mastery view never plots that, so don't pay for it until it's on screen.
  if (includeHours && linkedSteamId) {
    const selfGames = await fetchOwnedGames(linkedSteamId).catch(() => []);
    hoursYou = steamHoursByDay(selfGames, sinceUnix);
    if (hoursYou.length === 0) {
      const totalHours = selfGames.reduce((s, g) => s + (g.playtime_2weeks || 0), 0) / 60;
      if (totalHours > 0) {
        hoursNote = `${Math.round(totalHours)}h in Steam's 2-week window — no per-day timestamps yet`;
      }
    }
  }

  if (includeHours && steamLinks.length > 0) {
    const friendGames = await Promise.all(
      steamLinks.map((l) => fetchOwnedGames(l.linked_steam_id).catch(() => [])),
    );
    hoursPeers = steamLinks
      .map((link, i) => ({
        userId: link.id,
        kind: "friend",
        label: peerLabel(friendProfileById[link.id]),
        points: toChartPoints(gamesToDayMap(friendGames[i], sinceUnix)),
      }))
      .filter((peer) => peer.points.length > 0);
  }

  return {
    mastery: { you: masteryYou, peers: masteryPeers },
    hours: { you: hoursYou, peers: hoursPeers, note: hoursNote },
    friendCount: friends.length,
    guildmateCount: guildmateIds.length,
    refreshJob,
  };
}
