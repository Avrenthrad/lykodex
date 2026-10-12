import { SlashCommandBuilder } from "discord.js";
import { supabase } from "../supabase.js";
import { linkedMembersOf } from "../links.js";
import { brandEmbed } from "./shared.js";
import { displayName, platformLabel } from "../format.js";
import { normalizePlatform, currentGameActivity } from "../presence.js";

// Who in this server is playing something right now. Uses Discord's
// live presence (what Discord already shows everyone in the member
// list), so no Lykodex opt-in is needed. Linked members get their
// Lykodex name shown next to it if they share activity.
export const data = new SlashCommandBuilder()
  .setName("nowplaying")
  .setDescription("See who in the server is playing something right now");

export async function execute(interaction) {
  await interaction.deferReply();
  const guild = interaction.guild;
  const members = await guild.members.fetch({ withPresences: true });

  const playing = [...members.values()]
    .filter((m) => !m.user.bot)
    .map((m) => ({ member: m, activity: currentGameActivity(m.presence) }))
    .filter((x) => x.activity);

  if (playing.length === 0) {
    return interaction.editReply({ embeds: [brandEmbed().setTitle("🎮 Now playing").setDescription("Nobody's playing anything right now.")] });
  }

  const linked = await linkedMembersOf(guild);
  const linkedIds = linked.map((l) => l.userId);
  const { data: profiles } = linkedIds.length
    ? await supabase.from("profiles").select("id, username, first_name, share_activity_with_guilds").in("id", linkedIds)
    : { data: [] };
  const profileByDiscord = new Map(
    linked.map((l) => [l.discordId, (profiles || []).find((p) => p.id === l.userId && p.share_activity_with_guilds)]),
  );

  const lines = playing
    .sort((a, b) => a.activity.name.localeCompare(b.activity.name))
    .map(({ member, activity }) => {
      const where = platformLabel(normalizePlatform(activity));
      const since = activity.timestamps?.start ? ` · <t:${Math.floor(new Date(activity.timestamps.start).getTime() / 1000)}:R>` : "";
      const lyko = profileByDiscord.get(member.id);
      const lykoName = lyko ? ` (${displayName(lyko)})` : "";
      return `**${member.displayName}**${lykoName} — ${activity.name}${where ? ` · ${where}` : ""}${since}`;
    });

  const embed = brandEmbed().setTitle(`🎮 Now playing (${playing.length})`).setDescription(lines.join("\n").slice(0, 4000));
  return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
