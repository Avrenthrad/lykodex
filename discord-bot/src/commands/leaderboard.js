import { SlashCommandBuilder } from "discord.js";
import { supabase } from "../supabase.js";
import { linkedMembersOf } from "../links.js";
import { brandEmbed } from "./shared.js";
import { displayName, formatNumber, formatMinutes, rankEntries, rankPrefix } from "../format.js";

// Server leaderboards. Only linked members who've opted into
// "Share activity with guilds" are ranked — same rule as everywhere.
const BOARDS = {
  overall: {
    label: "Overall Mastery",
    emoji: "👑",
    async values(profiles) {
      return profiles.map((p) => ({ userId: p.id, value: p.overall_mastery_score, level: p.overall_mastery_level }));
    },
    show: (e) => `Lv ${e.level ?? 0} · ${formatNumber(e.value, 1)}`,
  },
  gaming: {
    label: "Gaming Mastery",
    emoji: "🎮",
    async values(profiles) {
      return profiles.map((p) => ({ userId: p.id, value: p.mastery_score, level: p.mastery_level }));
    },
    show: (e) => `Lv ${e.level ?? 0} · ${formatNumber(e.value, 1)}`,
  },
  playtime: {
    label: "Tracked Playtime",
    emoji: "⏱️",
    note: "Xbox, PlayStation and non-Steam PC hours tracked via Discord.",
    async values(profiles) {
      const { data, error } = await supabase
        .from("platform_playtime")
        .select("user_id, total_minutes")
        .in("user_id", profiles.map((p) => p.id));
      if (error) throw error;
      const totals = new Map();
      for (const r of data || []) totals.set(r.user_id, (totals.get(r.user_id) || 0) + (r.total_minutes || 0));
      return profiles.map((p) => ({ userId: p.id, value: totals.get(p.id) || 0 }));
    },
    show: (e) => formatMinutes(e.value),
  },
  voice: {
    label: "Voice Chat Time",
    emoji: "🎙️",
    note: "Opted-in members only. Counts time with others, not deafened or AFK.",
    async values(profiles) {
      const { data, error } = await supabase
        .from("discord_activity_totals")
        .select("user_id, voice_active_seconds")
        .in("user_id", profiles.map((p) => p.id));
      if (error) throw error;
      const byId = new Map((data || []).map((r) => [r.user_id, Number(r.voice_active_seconds) || 0]));
      return profiles.map((p) => ({ userId: p.id, value: (byId.get(p.id) || 0) / 60 }));
    },
    show: (e) => formatMinutes(e.value),
  },
  completions: {
    label: "100% Completions",
    emoji: "💯",
    note: "Steam games with every achievement unlocked.",
    values: (profiles) => countPerUser("game_completions", profiles),
    show: (e) => `${formatNumber(e.value)} games`,
  },
  library: {
    label: "Game Library Size",
    emoji: "📚",
    values: (profiles) => countPerUser("game_library_items", profiles),
    show: (e) => `${formatNumber(e.value)} games`,
  },
};

async function countPerUser(table, profiles) {
  return Promise.all(
    profiles.map(async (p) => {
      const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", p.id);
      return { userId: p.id, value: count || 0 };
    }),
  );
}

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Server leaderboard for Lykodex stats")
  .addStringOption((o) =>
    o
      .setName("board")
      .setDescription("Which leaderboard (default: Overall Mastery)")
      .addChoices(...Object.entries(BOARDS).map(([value, b]) => ({ name: b.label, value }))),
  );

export async function execute(interaction) {
  await interaction.deferReply();
  const key = interaction.options.getString("board") || "overall";
  const board = BOARDS[key];

  const linked = await linkedMembersOf(interaction.guild);
  const { data: profiles, error } = linked.length
    ? await supabase
        .from("profiles")
        .select("id, username, first_name, share_activity_with_guilds, overall_mastery_score, overall_mastery_level, mastery_score, mastery_level")
        .in("id", linked.map((l) => l.userId))
    : { data: [] };
  if (error) throw error;
  const sharing = (profiles || []).filter((p) => p.share_activity_with_guilds);

  const embed = brandEmbed().setTitle(`${board.emoji} ${board.label} — ${interaction.guild.name}`);
  if (sharing.length === 0) {
    embed.setDescription("No one here has linked Lykodex **and** turned on *Share activity with guilds* yet. Run `/link` to get started.");
    return interaction.editReply({ embeds: [embed] });
  }

  const byId = new Map(sharing.map((p) => [p.id, p]));
  const discordByUser = new Map(linked.map((l) => [l.userId, l]));
  const ranked = rankEntries(await board.values(sharing));

  const lines = ranked.map((e, i) => {
    const l = discordByUser.get(e.userId);
    const name = displayName(byId.get(e.userId), l?.member.displayName);
    const me = l?.discordId === interaction.user.id ? " ← you" : "";
    return `${rankPrefix(i)} **${name}** — ${board.show(e)}${me}`;
  });
  embed.setDescription(lines.length ? lines.join("\n") : "Nobody has any numbers on this board yet.");
  const hidden = linked.length - sharing.length;
  const notes = [board.note, hidden > 0 ? `${hidden} linked member(s) hidden — sharing is off.` : null].filter(Boolean);
  if (notes.length) embed.addFields({ name: "​", value: `-# ${notes.join(" · ")}` });
  return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
