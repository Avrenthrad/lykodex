// Lykodex Discord Bot.
//
// One always-on process that:
//   • tracks presence: now playing, Xbox/PS/PC playtime,
//     Spotify listening, Watching (opt-in)                     presence.js
//   • tracks voice chat time → Social Mastery (opt-in)         voice.js
//   • runs the daily Gaming + Overall Mastery refresh          mastery/
//   • answers slash commands                                   commands/
//   • posts Lykodex activity into a Discord channel            feed.js
//
// Needs a long-running host (Railway etc.) — a Gateway connection
// can't live in a Vercel serverless function.
import { Client, GatewayIntentBits, Partials, Events, MessageFlags } from "discord.js";
import { config, assertConfig } from "./config.js";
import { supabase } from "./supabase.js";
import { commands, commandPayload } from "./commands/index.js";
import { registerPresenceTracking, flushSessions } from "./presence.js";
import { registerVoiceTracking, seedVoiceSessions, flushVoiceSessions } from "./voice.js";
import { pollFeeds, announceLevelUp, invalidateMemberCache } from "./feed.js";
import { runRefreshWithLevelUps } from "./mastery/levelUps.js";

assertConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Both privileged — toggle on in Developer Portal > Bot >
    // Privileged Gateway Intents ("Presence" AND "Server Members"),
    // or login fails with "Used disallowed intents".
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    // Not privileged — needed for voice chat time tracking.
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.User, Partials.GuildMember],
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    const reply = { content: "Something went wrong talking to Lykodex — try again in a moment.", flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

// Membership changes affect who the feed/leaderboards include.
client.on(Events.GuildMemberAdd, (m) => invalidateMemberCache(m.guild.id));
client.on(Events.GuildMemberRemove, (m) => invalidateMemberCache(m.guild.id));

if (config.enablePresenceTracking) {
  registerPresenceTracking(client);
  registerVoiceTracking(client);
}

async function registerCommands() {
  const body = commandPayload();
  if (config.devGuildId) {
    // Guild-scoped: shows up instantly — best while testing.
    const guild = await client.guilds.fetch(config.devGuildId);
    await guild.commands.set(body);
    console.log(`Registered ${body.length} slash commands to server ${guild.name}.`);
  } else {
    await client.application.commands.set(body);
    console.log(`Registered ${body.length} global slash commands (can take up to an hour to appear).`);
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
async function runMasteryRefresh() {
  console.log("Running daily Gaming + Overall Mastery refresh…");
  try {
    const { total, succeeded, failed, levelUps } = await runRefreshWithLevelUps(supabase);
    console.log(`Mastery refresh done: ${succeeded}/${total} updated${failed ? `, ${failed} failed` : ""}, ${levelUps.length} level-up(s).`);
    for (const up of levelUps) await announceLevelUp(client, up.userId, up.kind, up.from, up.to);
  } catch (err) {
    console.error("Mastery refresh run failed:", err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Lykodex bot online as ${client.user.tag} in ${client.guilds.cache.size} server(s).`);
  console.log(`Presence tracking: ${config.enablePresenceTracking ? "on" : "OFF"} · Mastery refresh: ${config.enableMasteryRefresh ? "on" : "OFF"}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Slash command registration failed:", err);
  }

  if (config.enablePresenceTracking) {
    seedVoiceSessions(client).catch((err) => console.error("Voice session seeding failed:", err));
  }

  setInterval(() => pollFeeds(client), config.feedPollMs);
  pollFeeds(client);

  if (config.enableMasteryRefresh) {
    // Once on startup (a redeploy counts as that day's run), then daily.
    runMasteryRefresh();
    setInterval(runMasteryRefresh, ONE_DAY_MS);
  }
});

client.on(Events.Error, (err) => console.error("Discord client error:", err));

async function shutdown() {
  console.log("Shutting down — closing open play, media and voice sessions…");
  try {
    await flushSessions();
    await flushVoiceSessions();
  } finally {
    client.destroy();
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(config.discordToken);
