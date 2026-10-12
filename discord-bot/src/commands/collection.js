import { SlashCommandBuilder } from "discord.js";
import { supabase } from "../supabase.js";
import { resolveTarget, brandEmbed } from "./shared.js";
import { formatNumber } from "../format.js";

// [label, table, extra filter?] — counts are row counts (distinct
// entries), not summed quantities, to match what the app lists.
const SECTIONS = [
  ["🎮 Gaming", [
    ["Library games", "game_library_items"],
    ["Backlog", "backlog_items"],
    ["Wishlist", "wishlist_items"],
    ["100% completions", "game_completions"],
  ]],
  ["🃏 TCG", [
    ["Magic", "mtg_collection"],
    ["Flesh and Blood", "fab_collection"],
    ["Pokémon", "pokemon_collection"],
    ["Yu-Gi-Oh!", "yugioh_collection"],
    ["One Piece", "onepiece_collection"],
    ["Riftbound", "riftbound_collection"],
  ]],
  ["🎬 Entertainment", [
    ["Movies & TV", "entertainment_entries"],
    ["Media library", "media_library_items"],
    ["Books", "user_books"],
    ["Comics", "comic_issues"],
  ]],
  ["🧸 Collectibles", [
    ["Owned", "collectible_entries", (q) => q.eq("is_wishlist", false)],
  ]],
];

async function countRows(table, userId, filter) {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) {
    console.error(`count ${table} failed:`, error.message);
    return null;
  }
  return count ?? 0;
}

export const data = new SlashCommandBuilder()
  .setName("collection")
  .setDescription("Show what's in a Lykodex collection")
  .addUserOption((o) => o.setName("user").setDescription("Whose collection (default: you)"));

export async function execute(interaction) {
  const target = await resolveTarget(interaction);
  if (target.reply) return interaction.reply(target.reply);
  const { profile, name } = target;
  await interaction.deferReply();

  const embed = brandEmbed().setTitle(`${name}'s Collection`);
  for (const [section, items] of SECTIONS) {
    const counts = await Promise.all(items.map(([, table, filter]) => countRows(table, profile.id, filter)));
    const lines = items
      .map(([label], i) => [label, counts[i]])
      .filter(([, c]) => c) // hide empty/erroring rows — nothing to brag about
      .map(([label, c]) => `${label}: **${formatNumber(c)}**`);
    if (lines.length) embed.addFields({ name: section, value: lines.join("\n"), inline: true });
  }
  if (!embed.data.fields?.length) embed.setDescription("Nothing added yet.");
  return interaction.editReply({ embeds: [embed] });
}
