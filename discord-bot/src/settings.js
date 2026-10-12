// Per-Discord-server settings (feed channel etc.), stored in the
// discord_guild_settings table — see sql/001_discord_bot.sql.
import { supabase } from "./supabase.js";

export async function getSettings(discordGuildId) {
  const { data, error } = await supabase
    .from("discord_guild_settings")
    .select("*")
    .eq("discord_guild_id", discordGuildId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveSettings(discordGuildId, patch) {
  const { data, error } = await supabase
    .from("discord_guild_settings")
    .upsert(
      { discord_guild_id: discordGuildId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "discord_guild_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function allFeedSettings() {
  const { data, error } = await supabase
    .from("discord_guild_settings")
    .select("*")
    .not("feed_channel_id", "is", null);
  if (error) throw error;
  return data || [];
}
