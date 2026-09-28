import { InteractionContextType } from "discord.js";
import * as link from "./link.js";
import * as profile from "./profile.js";
import * as mastery from "./mastery.js";
import * as collection from "./collection.js";
import * as nowplaying from "./nowplaying.js";
import * as leaderboard from "./leaderboard.js";
import * as setup from "./setup.js";

export const commands = new Map(
  [link, profile, mastery, collection, nowplaying, leaderboard, setup].map((c) => [c.data.name, c]),
);

// Every command except /link only makes sense inside a server.
for (const [name, c] of commands) {
  c.data.setContexts(
    name === "link"
      ? [InteractionContextType.Guild, InteractionContextType.BotDM]
      : [InteractionContextType.Guild],
  );
}

export function commandPayload() {
  return [...commands.values()].map((c) => c.data.toJSON());
}
