// Xbox/PlayStation achievement/trophy tracker — see platform_achievements
// in schema.sql for why this exists and why game_name is free text
// rather than a foreign key. A row is either typed in by hand (source =
// 'manual') or synced from the person's own real Xbox/PSN library
// (source = 'synced', see upsertSyncedAchievements below and
// AchievementsPage.jsx's game-picker) — both live in the same table and
// render through the same list/category UI either way. Steam
// achievements never go through here at all; they're a live view of
// lib/steam.js's real API data (see AchievementsPage.jsx).

import { supabase } from "./supabaseClient";

export async function fetchPlatformAchievements(userId, platform) {
  const { data, error } = await supabase
    .from("platform_achievements")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .order("game_name", { ascending: true })
    .order("added_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addPlatformAchievement(userId, platform, { gameName, achievementName, description, category }) {
  const { error } = await supabase.from("platform_achievements").insert({
    user_id: userId,
    platform,
    game_name: gameName,
    achievement_name: achievementName,
    description: description || null,
    category: category || null,
  });
  if (error) throw error;
}

export async function toggleAchievementUnlocked(achievementId, unlocked) {
  const { error } = await supabase
    .from("platform_achievements")
    .update({ unlocked, unlocked_at: unlocked ? new Date().toISOString() : null })
    .eq("id", achievementId);
  if (error) throw error;
}

// Groups achievements/trophies into named sections (Story, Collectibles,
// etc.) so the page can collapse a section once it's fully checked off —
// same "close off what you've finished" layout as IGN's trophy-guide wikis.
export async function updateAchievementCategory(achievementId, category) {
  const { error } = await supabase
    .from("platform_achievements")
    .update({ category: category || null })
    .eq("id", achievementId);
  if (error) throw error;
}

// Real Xbox/PSN achievement sync — upserts on the same (user_id,
// platform, game_name, achievement_name) constraint manual rows already
// use, so a "Refresh" only ever touches unlocked/unlocked_at/
// description/icon_url. category is deliberately left out of every row
// here: an upsert only overwrites the columns it's given, so a person's
// own category tag on a previously-synced achievement survives every
// future refresh untouched. achievements come from fetchXboxAchievements
// (externalId -> id) or fetchPsnTitleTrophies (externalId -> trophyId).
export async function upsertSyncedAchievements(userId, platform, gameName, externalTitleId, achievements) {
  const rows = achievements.map((a) => ({
    user_id: userId,
    platform,
    game_name: gameName,
    achievement_name: a.name,
    description: a.description || null,
    icon_url: a.icon || null,
    external_id: String(a.externalId),
    external_title_id: String(externalTitleId),
    source: "synced",
    unlocked: a.unlocked,
    unlocked_at: a.unlockedAt || null,
  }));
  const { error } = await supabase
    .from("platform_achievements")
    .upsert(rows, { onConflict: "user_id,platform,game_name,achievement_name" });
  if (error) throw error;
}

export async function deletePlatformAchievement(achievementId) {
  const { error } = await supabase.from("platform_achievements").delete().eq("id", achievementId);
  if (error) throw error;
}
