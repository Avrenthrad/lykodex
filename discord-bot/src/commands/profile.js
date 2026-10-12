import { SlashCommandBuilder } from "discord.js";
import { supabase } from "../supabase.js";
import { resolveTarget, brandEmbed, siteButtonRow } from "./shared.js";
import { formatNumber, platformLabel } from "../format.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Show a Lykodex profile card")
  .addUserOption((o) => o.setName("user").setDescription("Whose profile (default: you)"));

export async function execute(interaction) {
  const target = await resolveTarget(interaction);
  if (target.reply) return interaction.reply(target.reply);
  const { profile, discordUser, name } = target;

  const { data: activity } = await supabase
    .from("current_activity")
    .select("platform, game_name, updated_at")
    .eq("user_id", profile.id)
    .maybeSingle();

  const gamertags = [
    profile.xbox_gamertag && `Xbox: **${profile.xbox_gamertag}**`,
    profile.playstation_online_id && `PSN: **${profile.playstation_online_id}**`,
    profile.linked_steam_id && "Steam: linked",
  ].filter(Boolean);

  const embed = brandEmbed()
    .setTitle(`${name}'s Lykodex`)
    .setThumbnail(profile.avatar_url || discordUser.displayAvatarURL())
    .addFields(
      {
        name: "Overall Mastery",
        value: `Level **${profile.overall_mastery_level ?? 0}** · ${formatNumber(profile.overall_mastery_score, 1)}`,
        inline: true,
      },
      {
        name: "Gaming Mastery",
        value: `Level **${profile.mastery_level ?? 0}** · ${formatNumber(profile.mastery_score, 1)}`,
        inline: true,
      },
    );
  if (activity?.game_name) {
    const where = platformLabel(activity.platform);
    embed.addFields({ name: "Now playing", value: `🎮 ${activity.game_name}${where ? ` (${where})` : ""}` });
  }
  if (gamertags.length) embed.addFields({ name: "Platforms", value: gamertags.join(" · ") });
  if (profile.friend_code) embed.addFields({ name: "Friend code", value: `\`${profile.friend_code}\``, inline: true });

  return interaction.reply({ embeds: [embed], components: [siteButtonRow()] });
}
