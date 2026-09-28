import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";

const { isSocial, applyEligibility } = await import("../src/voice.js");
const { playtimePlatform, normalizePlatform, mediaFromPresence } = await import("../src/presence.js");
const { normalizeGameName } = await import("../src/tracking.js");
const { computeSocialRaw, computeEntertainmentRaw } = await import("../src/mastery/overallMastery.js");

test("voice: only social time counts", () => {
  const vs = { channelId: "c1", selfDeaf: false, serverDeaf: false };
  assert.equal(isSocial(vs, 2, "afk"), true);
  assert.equal(isSocial(vs, 1, "afk"), false, "alone");
  assert.equal(isSocial({ ...vs, selfDeaf: true }, 3, "afk"), false, "deafened");
  assert.equal(isSocial({ ...vs, channelId: "afk" }, 3, "afk"), false, "AFK channel");
  assert.equal(isSocial({ channelId: null }, 3, "afk"), false, "not in voice");
});

test("voice: active time accumulates only while eligible", () => {
  let s = { startedAt: 0, activeMs: 0, activeSince: null };
  s = applyEligibility(s, true, 1000); // someone joins
  s = applyEligibility(s, true, 5000); // still eligible — no double start
  s = applyEligibility(s, false, 11000); // left alone
  s = applyEligibility(s, false, 20000);
  s = applyEligibility(s, true, 30000);
  s = applyEligibility(s, false, 32000);
  assert.equal(s.activeMs, 12000);
  assert.equal(s.activeSince, null);
});

test("playtime platform: console, PC, and unknown", () => {
  assert.equal(playtimePlatform({ platform: "xbox" }), "xbox");
  assert.equal(playtimePlatform({ platform: "ps5" }), "playstation");
  assert.equal(playtimePlatform({ platform: "ps4" }), "playstation");
  assert.equal(playtimePlatform({}), "pc");
  assert.equal(playtimePlatform({ platform: "desktop" }), "pc");
  assert.equal(playtimePlatform({ platform: "android" }), "unknown");
  // live-status mapping stays compatible with current_activity's constraint
  assert.equal(normalizePlatform({ platform: "ps5" }), "playstation");
  assert.equal(normalizePlatform({}), "unknown");
});

test("media: Spotify and Watching are recognised, games are not", () => {
  const spotify = mediaFromPresence({ activities: [{ type: 2, name: "Spotify", details: "Song", state: "Artist" }] });
  assert.deepEqual(
    { kind: spotify.kind, source: spotify.source, title: spotify.title, subtitle: spotify.subtitle },
    { kind: "listening", source: "Spotify", title: "Song", subtitle: "Artist" },
  );
  const watching = mediaFromPresence({ activities: [{ type: 3, name: "Crunchyroll", details: "Frieren", state: "Episode 3" }] });
  assert.equal(watching.kind, "watching");
  assert.equal(mediaFromPresence({ activities: [{ type: 0, name: "Hades" }] }), null);
  assert.notEqual(spotify.key, mediaFromPresence({ activities: [{ type: 2, name: "Spotify", details: "Other", state: "Artist" }] }).key);
});

test("Steam title matching ignores symbols and case", () => {
  assert.equal(normalizeGameName("DOOM Eternal™"), normalizeGameName("Doom Eternal"));
  assert.equal(normalizeGameName("Baldur's Gate 3"), "baldur s gate 3");
});

test("mastery: Social and Entertainment include Discord time", () => {
  assert.equal(computeSocialRaw(3600 * 100), 1000);
  assert.equal(computeSocialRaw(0), 0);
  assert.equal(computeEntertainmentRaw([], { listeningSeconds: 3600 * 10, watchingSeconds: 3600 * 5 }), 30);
  // unchanged when there's no Discord data
  assert.equal(computeEntertainmentRaw([{ status: "completed" }]), 15);
});
