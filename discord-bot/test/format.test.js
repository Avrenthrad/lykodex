import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeActivity,
  summarizeActivity,
  chunkLines,
  formatMinutes,
  progressBar,
  rankEntries,
  rankPrefix,
  isFeedableEvent,
} from "../src/format.js";
import { canView } from "../src/privacy.js";
import { diffLevels } from "../src/mastery/levelUps.js";

const row = (user_id, event_type, title, created_at = "2026-09-28T00:00:00Z") => ({
  user_id,
  event_type,
  event_data: title === undefined ? {} : { title },
  created_at,
});

test("dedupeActivity collapses Lykodex's one-row-per-guild fan-out", () => {
  const rows = [row("a", "wishlist_added", "Hades"), row("a", "wishlist_added", "Hades"), row("a", "wishlist_added", "Tunic")];
  assert.equal(dedupeActivity(rows).length, 2);
});

test("summarizeActivity batches bulk events into one line per person", () => {
  const rows = ["Hades", "Tunic", "Celeste", "Hollow Knight", "Outer Wilds"].map((t) => row("a", "wishlist_added", t));
  const lines = summarizeActivity(rows, () => "Josh");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\*\*Josh\*\* added 5 games to their wishlist/);
  assert.match(lines[0], /\+2 more$/);
});

test("summarizeActivity single event reads naturally", () => {
  const [line] = summarizeActivity([row("b", "game_completed", "Hades")], () => "Sam");
  assert.equal(line, "💯 **Sam** 100%'d a game: **Hades**");
});

test("guild-internal events are not posted to Discord", () => {
  assert.equal(isFeedableEvent("guild_post_commented"), false);
  assert.equal(isFeedableEvent("joined_guild"), false);
  assert.equal(summarizeActivity([row("a", "guild_post_commented", "hi")], () => "x").length, 0);
});

test("chunkLines keeps every message under Discord's limit", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(50)}`);
  const chunks = chunkLines(lines, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 500);
  assert.equal(chunks.join("\n").split("\n").length, 100);
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(0), "0m");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(125), "2h 5m");
});

test("progressBar clamps", () => {
  assert.equal(progressBar(0.5, 4), "▰▰▱▱");
  assert.equal(progressBar(5, 4), "▰▰▰▰");
  assert.equal(progressBar(-1, 4), "▱▱▱▱");
});

test("rankEntries sorts desc and drops zeros", () => {
  const out = rankEntries([{ userId: "a", value: 1 }, { userId: "b", value: 0 }, { userId: "c", value: 9 }]);
  assert.deepEqual(out.map((e) => e.userId), ["c", "a"]);
  assert.equal(rankPrefix(0), "🥇");
  assert.equal(rankPrefix(3), "`#4`");
});

test("privacy: self always visible, others only when sharing", () => {
  assert.equal(canView("me", { id: "me", share_activity_with_guilds: false }), true);
  assert.equal(canView("me", { id: "you", share_activity_with_guilds: false }), false);
  assert.equal(canView("me", { id: "you", share_activity_with_guilds: true }), true);
  assert.equal(canView(null, { id: "you", share_activity_with_guilds: false }), false);
  assert.equal(canView("me", null), false);
});

test("diffLevels reports only increases", () => {
  const before = new Map([["a", { mastery_level: 1, overall_mastery_level: 2 }], ["b", { mastery_level: 5, overall_mastery_level: 5 }]]);
  const after = new Map([["a", { mastery_level: 2, overall_mastery_level: 2 }], ["b", { mastery_level: 4, overall_mastery_level: 5 }], ["new", { mastery_level: 3 }]]);
  assert.deepEqual(diffLevels(before, after), [{ userId: "a", kind: "gaming", from: 1, to: 2 }]);
});
