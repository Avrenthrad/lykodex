import assert from "node:assert/strict";
import test from "node:test";
import { parseSteamAppDetails } from "../src/lib/steamAppDetails.js";

const dotaUnderOtherKey = {
  "2120612": {
    success: true,
    data: {
      steam_appid: 570,
      name: "Dota 2",
      type: "game",
      header_image: "https://cdn.example/dota/header.jpg",
      genres: [{ description: "Action" }, { description: "Free to Play" }],
      is_free: true,
      release_date: { coming_soon: false, date: "9 Jul, 2013" },
    },
  },
};

test("reads appdetails when Steam keys the body by a different id", () => {
  const info = parseSteamAppDetails(dotaUnderOtherKey, "570");
  assert.equal(info.name, "Dota 2");
  assert.equal(info.thumb, "https://cdn.example/dota/header.jpg");
  assert.deepEqual(info.genres, ["Action", "Free to Play"]);
  assert.equal(info.appType, "game");
  assert.equal(info.steamAuPrice, 0);
  assert.equal(info.steamAuRrp, null);
  assert.equal(info.releaseDate, "9 Jul, 2013");
});

test("matches numeric steam_appid against a string appid", () => {
  assert.equal(parseSteamAppDetails(dotaUnderOtherKey, 570).name, "Dota 2");
});

test("falls back to the requested key when that is how the body is shaped", () => {
  const info = parseSteamAppDetails({
    "730": {
      success: true,
      data: {
        name: "Counter-Strike 2",
        type: "game",
        header_image: "https://cdn.example/cs/header.jpg",
        genres: [{ description: "Action" }],
        is_free: true,
      },
    },
  }, "730");
  assert.equal(info.name, "Counter-Strike 2");
  assert.equal(info.thumb, "https://cdn.example/cs/header.jpg");
});

test("prefers the steam_appid match over a failed entry on the requested key", () => {
  const info = parseSteamAppDetails({
    "570": { success: false },
    ...dotaUnderOtherKey,
  }, "570");
  assert.equal(info.name, "Dota 2");
});

test("keeps AU price, metacritic, and DLC parent from the matched entry", () => {
  const info = parseSteamAppDetails({
    "999": {
      success: true,
      data: {
        steam_appid: "1240440",
        name: "Halo Infinite Campaign",
        type: "dlc",
        header_image: "https://cdn.example/halo/header.jpg",
        fullgame: { appid: 1240440, name: "Halo Infinite" },
        metacritic: { score: 80, url: "https://metacritic.example/halo" },
        price_overview: { final: 4999, initial: 5999 },
        is_free: false,
        genres: [{ description: "Action" }],
        release_date: { coming_soon: false, date: "8 Nov, 2021" },
      },
    },
  }, "1240440");
  assert.equal(info.name, "Halo Infinite Campaign");
  assert.equal(info.appType, "dlc");
  assert.equal(info.parentTitle, "Halo Infinite");
  assert.equal(info.parentAppid, "1240440");
  assert.equal(info.metacriticScore, 80);
  assert.equal(info.metacriticUrl, "https://metacritic.example/halo");
  assert.equal(info.steamAuPrice, 49.99);
  assert.equal(info.steamAuRrp, 59.99);
});

test("returns a null name when nothing matches", () => {
  assert.deepEqual(parseSteamAppDetails({ "1": { success: false } }, "570"), { name: null });
  assert.deepEqual(parseSteamAppDetails(null, "570"), { name: null });
});
