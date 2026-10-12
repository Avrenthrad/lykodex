import { SlashCommandBuilder } from "discord.js";
import { resolveTarget, brandEmbed } from "./shared.js";
import { levelFromXp } from "../mastery/gameMastery.js";
import { formatNumber, progressBar } from "../format.js";

const COLLEGE_LABELS = {
  gaming: "🎮 Gaming",
  tcg: "🃏 TCG",
  entertainment: "🎬 Entertainment",
  collectibles: "🧸 Collectibles",
  tabletop: "🎲 Tabletop",
  social: "🎙️ Social",
};
const PLATFORM_LABELS = { xbox: "Xbox", playstation: "PlayStation", steam: "Steam" };

function levelLine(xp) {
  const { level, xpIntoLevel, xpForNextLevel, progress } = levelFromXp(xp);
  return `Level **${level}** ${progressBar(progress)} ${formatNumber(xpIntoLevel)}/${formatNumber(xpForNextLevel)} XP`;
}

export const data = new SlashCommandBuilder()
  .setName("mastery")
  .setDescription("Show Overall + Gaming Mastery breakdown")
  .addUserOption((o) => o.setName("user").setDescription("Whose mastery (default: you)"));

export async function execute(interaction) {
  const target = await resolveTarget(interaction);
  if (target.reply) return interaction.reply(target.reply);
  const { profile, name } = target;

  const overall = (profile.overall_mastery_breakdown || [])
    .map((b) => `${COLLEGE_LABELS[b.college] || b.college}: **${formatNumber(b.normalized, 1)}**`)
    .join("\n");
  const gaming = (profile.mastery_breakdown || [])
    .map((b) => {
      const note = b.source === "self_reported" ? " *(self-reported)*" : "";
      return `${PLATFORM_LABELS[b.platform] || b.platform}: **${formatNumber(b.normalized, 1)}**${note}`;
    })
    .join("\n");

  const updated = profile.overall_mastery_computed_at || profile.mastery_computed_at;
  const embed = brandEmbed()
    .setTitle(`${name}'s Mastery`)
    .addFields(
      {
        name: `Overall Mastery · ${formatNumber(profile.overall_mastery_score, 1)}`,
        value: `${levelLine(profile.overall_mastery_xp)}\n${overall || "*No College data yet*"}`,
      },
      {
        name: `Gaming Mastery · ${formatNumber(profile.mastery_score, 1)}`,
        value: `${levelLine(profile.mastery_xp)}\n${gaming || "*No platforms linked yet*"}`,
      },
    );
  if (updated) embed.setTimestamp(new Date(updated)).setFooter({ text: "Lykodex · last recomputed" });
  return interaction.reply({ embeds: [embed] });
}
