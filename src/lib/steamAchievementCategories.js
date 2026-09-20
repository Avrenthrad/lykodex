// Category tags for Steam achievements — Steam's own schema/API has no
// concept of grouping (see fetchAchievementSchema in steam.js), so this
// is a Lykodex-side overlay purely for organizing the Achievements page
// into collapsible sections (Story, Collectibles, etc.), same as the
// manual Xbox/PlayStation tracker's category column. Unlock state always
// stays a live read from Steam; this table never touches it.

import { supabase } from "./supabaseClient";

export async function fetchSteamAchievementCategories(userId, appid) {
  const { data, error } = await supabase
    .from("steam_achievement_categories")
    .select("apiname, category")
    .eq("user_id", userId)
    .eq("appid", appid);
  if (error) throw error;
  const byApiname = {};
  (data || []).forEach((row) => { byApiname[row.apiname] = row.category; });
  return byApiname;
}

export async function setSteamAchievementCategory(userId, appid, apiname, category) {
  const trimmed = (category || "").trim();
  if (!trimmed) {
    const { error } = await supabase
      .from("steam_achievement_categories")
      .delete()
      .eq("user_id", userId)
      .eq("appid", appid)
      .eq("apiname", apiname);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("steam_achievement_categories")
    .upsert(
      { user_id: userId, appid, apiname, category: trimmed, updated_at: new Date().toISOString() },
      { onConflict: "user_id,appid,apiname" }
    );
  if (error) throw error;
}
