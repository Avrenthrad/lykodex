import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from "discord.js";
import { getSettings, saveSettings } from "../settings.js";
import { invalidateMemberCache } from "../feed.js";
import { brandEmbed } from "./shared.js";

// Server admin settings. Requires Manage Server.
export const data = new SlashCommandBuilder()
  .setName("lykodex-setup")
  .setDescription("Configure the Lykodex bot for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName("feed")
      .setDescription("Choose where Lykodex activity gets posted")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel for the activity feed")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName("now_playing").setDescription("Also post when someone starts playing a game (default: off)"),
      ),
  )
  .addSubcommand((s) => s.setName("feed-off").setDescription("Stop posting the activity feed"))
  .addSubcommand((s) => s.setName("status").setDescription("Show current settings"));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "feed") {
    const channel = interaction.options.getChannel("channel");
    const perms = channel.permissionsFor(interaction.client.user);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.ViewChannel)) {
      return interaction.reply({
        content: `I can't post in ${channel} — give me **View Channel** and **Send Messages** there first.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const existing = await getSettings(guildId);
    const nowPlaying = interaction.options.getBoolean("now_playing");
    await saveSettings(guildId, {
      feed_channel_id: channel.id,
      feed_enabled: true,
      post_now_playing: nowPlaying ?? existing?.post_now_playing ?? false,
      // Start from "now" when the feed is new or was paused, so turning
      // it on doesn't dump a backlog of old events into the channel.
      feed_cursor:
        existing?.feed_enabled !== false && existing?.feed_cursor ? existing.feed_cursor : new Date().toISOString(),
    });
    invalidateMemberCache(guildId);
    return interaction.reply({
      content: `✅ Lykodex activity will post in ${channel}.${nowPlaying ? " Now-playing posts are **on**." : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "feed-off") {
    await saveSettings(guildId, { feed_enabled: false });
    return interaction.reply({ content: "⏸️ Activity feed paused. Run `/lykodex-setup feed` to turn it back on.", flags: MessageFlags.Ephemeral });
  }

  const s = await getSettings(guildId);
  const embed = brandEmbed()
    .setTitle("Lykodex settings")
    .addFields(
      { name: "Feed channel", value: s?.feed_channel_id ? `<#${s.feed_channel_id}>` : "not set", inline: true },
      { name: "Feed", value: s?.feed_enabled === false || !s?.feed_channel_id ? "off" : "on", inline: true },
      { name: "Now-playing posts", value: s?.post_now_playing ? "on" : "off", inline: true },
    );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
