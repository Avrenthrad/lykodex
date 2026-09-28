// The bot uses the service_role key, so RLS isn't protecting anyone
// here — this is the one rule every command follows instead:
//
//   You can always see your own stuff. You can only see someone
//   else's if they've turned on "Share activity with guilds" in
//   Lykodex (profiles.share_activity_with_guilds).
//
// Same opt-in the app already uses for Guild Pulse, so nobody's data
// shows up in Discord that wouldn't already show up to their guild.
export function canView(viewerUserId, targetProfile) {
  if (!targetProfile) return false;
  if (viewerUserId && viewerUserId === targetProfile.id) return true;
  return targetProfile.share_activity_with_guilds === true;
}

export const PRIVATE_MESSAGE =
  "That person hasn't turned on **Share activity with guilds** in Lykodex, so their stats stay private.";
