import assert from "node:assert/strict";
import test from "node:test";
import { presentRawg, stripRawgSecrets } from "../api/rawg.js";

const SECRET = "super-secret-rawg-key";

test("strips the key from every URL in a RAWG payload", () => {
  const out = stripRawgSecrets({
    next: `https://api.rawg.io/api/games?key=${SECRET}&page=2&dates=2026-01-01,2026-06-01`,
    previous: null,
    results: [{ clip: `https://media.rawg.io/clip?key=${SECRET}&id=9` }],
    note: "the word key= appears in prose and must stay",
  });

  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(out.next.includes("key="), false);
  assert.equal(out.results[0].clip.includes("key="), false);
  assert.match(out.next, /page=2/);
  assert.match(out.results[0].clip, /id=9/);
  assert.equal(out.note, "the word key= appears in prose and must stay");
  assert.equal(out.previous, null);
});

test("rewrites next and previous onto the proxy with a page number", () => {
  const req = { url: "/api/rawg?mode=upcoming&dateFrom=2026-01-01&dateTo=2026-06-01&excludeAdditions=true" };
  const out = presentRawg({
    next: `https://api.rawg.io/api/games?key=${SECRET}&dates=2026-01-01,2026-06-01&page=2`,
    previous: `https://api.rawg.io/api/games?page=1&key=${SECRET}`,
    results: [],
  }, req);

  assert.equal(JSON.stringify(out).includes(SECRET), false);
  const next = new URL(out.next, "http://localhost");
  assert.equal(next.pathname, "/api/rawg");
  assert.equal(next.searchParams.get("mode"), "upcoming");
  assert.equal(next.searchParams.get("dateFrom"), "2026-01-01");
  assert.equal(next.searchParams.get("dateTo"), "2026-06-01");
  assert.equal(next.searchParams.get("excludeAdditions"), "true");
  assert.equal(next.searchParams.get("page"), "2");
  assert.equal(next.searchParams.get("key"), null);

  const previous = new URL(out.previous, "http://localhost");
  assert.equal(previous.searchParams.get("page"), "1");
  assert.equal(previous.searchParams.get("key"), null);
});
