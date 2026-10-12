import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { supabase } from "../supabase.js";
import { lykodexUserIdFor } from "../links.js";
import { canView, PRIVATE_MESSAGE } from "../privacy.js";
import { BRAND_COLOR, displayName } from "../format.js";
import { config } from "../config.js";

export const PROFILE_COLUMNS =
  "id, username, first_name, avatar_url, share_activity_with_guilds, " +
  "mastery_score, mastery_level, mastery_xp, mastery_breakdown, mastery_computed_at, " +
  "overall_mastery_score, overall_mastery_level, overall_mastery_xp, overall_mastery_breakdown, overall_mastery_computed_at, " +
  "xbox_gamertag, playstation_online_id, linked_steam_id, friend_code";

export function brandEmbed() {
  return new EmbedBuilder().setColor(BRAND_COLOR).setFooter({ text: "Lykodex" });
}

export function siteButtonRow(label = "Open Lykodex") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(config.siteBaseUrl),
  );
}

export function notLinkedReply(isSelf, discordUser) {
  const who = isSelf ? "Your Discord account isn't" : `**${discordUser.displayName ?? discordUser.username}** isn't`;
  return {
    content: isSelf
      ? `${who} linked to Lykodex yet. Run \`/link\` to see how.`
      : `${who} linked to a Lykodex account yet.`,
    flags: MessageFlags.Ephemeral,
  };
}

// Resolves "the user option, or me" into a Lykodex profile the viewer
// is allowed to see. Returns { profile, discordUser } or { reply } when
// the command should stop and send that reply instead.
export async function resolveTarget(interaction, optionName = "user") {
  const discordUser = interaction.options.getUser(optionName) || interaction.user;
  const isSelf = discordUser.id === interaction.user.id;

  const [targetUserId, viewerUserId] = await Promise.all([
    lykodexUserIdFor(discordUser.id),
    isSelf ? null : lykodexUserIdFor(interaction.user.id),
  ]);
  if (!targetUserId) return { reply: notLinkedReply(isSelf, discordUser) };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return { reply: { content: "Couldn't find that Lykodex profile.", flags: MessageFlags.Ephemeral } };

  const viewer = isSelf ? targetUserId : viewerUserId;
  if (!canView(viewer, profile)) return { reply: { content: PRIVATE_MESSAGE, flags: MessageFlags.Ephemeral } };

  return { profile, discordUser, isSelf, name: displayName(profile, discordUser.username) };
}
