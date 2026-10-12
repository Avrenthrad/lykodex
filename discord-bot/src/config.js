// Central place for env config, so every module reads the same parsed
// values rather than re-parsing process.env with slightly different
// defaults.
import "dotenv/config";

function flag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["false", "0", "no", "off"].includes(raw.toLowerCase());
}

export const config = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  devGuildId: process.env.DISCORD_GUILD_ID || null,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  siteBaseUrl: (process.env.SITE_BASE_URL || "https://lykodex.vercel.app").replace(/\/$/, ""),
  enablePresenceTracking: flag("ENABLE_PRESENCE_TRACKING", true),
  enableMasteryRefresh: flag("ENABLE_MASTERY_REFRESH", true),
  feedPollMs: Math.max(15, Number(process.env.FEED_POLL_SECONDS) || 60) * 1000,
};

export function assertConfig() {
  const missing = [
    ["DISCORD_BOT_TOKEN", config.discordToken],
    ["SUPABASE_URL", config.supabaseUrl],
    ["SUPABASE_SERVICE_ROLE_KEY", config.supabaseServiceRoleKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")} — see .env.example.`);
    process.exit(1);
  }
}
