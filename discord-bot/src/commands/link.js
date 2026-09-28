import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { lykodexUserIdFor, forgetDiscordUser } from "../links.js";
import { supabase } from "../supabase.js";
import { brandEmbed, siteButtonRow } from "./shared.js";
import { displayName } from "../format.js";

// Linking itself happens in the Lykodex app (Account Linking → Discord),
// which already writes discord_links via Discord OAuth. That's the
// secure path: Discord proves who you are, so nobody can claim someone
// else's Lykodex account from inside Discord. This command just checks
// status and points people there.
export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord to Lykodex, or check your link status");

export async function execute(interaction) {
  forgetDiscordUser(interaction.user.id);
  const userId = await lykodexUserIdFor(interaction.user.id, { fresh: true });

  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, first_name, share_activity_with_guilds, discord_tracking_enabled")
      .eq("id", userId)
      .maybeSingle();
    const sharing = profile?.share_activity_with_guilds;
    const tracking = profile?.discord_tracking_enabled;
    const embed = brandEmbed()
      .setTitle("✅ Linked to Lykodex")
      .setDescription(
        [
          `You're linked as **${displayName(profile, interaction.user.username)}**.`,
          "",
          sharing
            ? "🔓 **Share activity with guilds** is ON — your stats, leaderboard spot and feed posts are visible here."
            : "🔒 **Share activity with guilds** is OFF — only you can see your stats. Turn it on in Lykodex to show up on leaderboards and the activity feed.",
          tracking
            ? "📡 **Discord activity tracking** is ON — playtime, voice chat, Spotify and Watching time count toward your Mastery."
            : "📡 **Discord activity tracking** is OFF — turn it on in Lykodex (Account Settings → Privacy) to count playtime, voice chat, Spotify and Watching toward Mastery.",
        ].join("\n"),
      );
    return interaction.reply({ embeds: [embed], components: [siteButtonRow()], flags: MessageFlags.Ephemeral });
  }

  const embed = brandEmbed()
    .setTitle("🔗 Link your Lykodex account")
    .setDescription(
      [
        "1. Open Lykodex and sign in (or create an account).",
        "2. Go to **Account Linking** → **Discord** and connect this Discord account.",
        "3. Optional: turn on **Share activity with guilds** so friends here can see your stats.",
        "4. Optional: turn on **Discord activity tracking** so playtime, voice chat, Spotify and Watching count toward Mastery.",
        "5. Run `/link` again to confirm.",
      ].join("\n"),
    );
  return interaction.reply({ embeds: [embed], components: [siteButtonRow("Open Lykodex")], flags: MessageFlags.Ephemeral });
}
