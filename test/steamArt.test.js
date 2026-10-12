import assert from "node:assert/strict";
import test from "node:test";
import { steamArtCandidates } from "../src/lib/steamArt.js";

const CDN = "https://cdn.akamai.steamstatic.com/steam/apps/2075800";

test("header art tries the legacy header before library_hero", () => {
  const urls = steamArtCandidates(2075800);
  assert.deepEqual(urls.slice(0, 4), [
    `${CDN}/header.jpg`,
    `${CDN}/library_hero.jpg`,
    `${CDN}/capsule_616x353.jpg`,
    `${CDN}/library_600x900.jpg`,
  ]);
});

test("hero art leads with library_hero, which still exists when header.jpg does not", () => {
  const urls = steamArtCandidates("2075800", { variant: "hero" });
  assert.equal(urls[0], `${CDN}/library_hero.jpg`);
  assert.equal(urls[1], `${CDN}/header.jpg`);
});

test("a known header image is tried first and not duplicated", () => {
  const header = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2075800/hash/header.jpg";
  const urls = steamArtCandidates(2075800, { preferred: [header, header] });
  assert.equal(urls[0], header);
  assert.equal(urls.filter((url) => url === header).length, 1);
  assert.equal(urls[1], `${CDN}/header.jpg`);
});

test("ignores a missing appid and still keeps a preferred url", () => {
  assert.deepEqual(steamArtCandidates(null), []);
  assert.deepEqual(steamArtCandidates("", { preferred: ["https://cdn.example/a.jpg", ""] }), [
    "https://cdn.example/a.jpg",
  ]);
  assert.deepEqual(steamArtCandidates("nope"), []);
});
