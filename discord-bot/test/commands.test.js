import { test } from "node:test";
import assert from "node:assert/strict";

// Commands import config/supabase, which need these to construct.
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";

test("every slash command builds valid JSON Discord will accept", async () => {
  const { commandPayload } = await import("../src/commands/index.js");
  const payload = commandPayload();
  const names = payload.map((c) => c.name).sort();
  assert.deepEqual(names, ["collection", "leaderboard", "link", "lykodex-setup", "mastery", "nowplaying", "profile"]);
  for (const c of payload) {
    assert.match(c.name, /^[a-z0-9-]{1,32}$/);
    assert.ok(c.description.length > 0 && c.description.length <= 100, `${c.name} description length`);
  }
});
