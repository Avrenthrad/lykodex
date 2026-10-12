// Steam's store appdetails response is documented as an object keyed
// by the appid you asked for. Live responses often aren't: requesting
// 570 comes back under some other id (e.g. "2120612") whose
// data.steam_appid is still 570. Indexing only payload[appid] turned
// those hits into { name: null } with HTTP 200, which the client then
// cached for a day — Hype Charts, wishlist art, AU price, genres, and
// DLC parent detection all read this shape.

export function parseSteamAppDetails(payload, appid) {
  const entry = selectSteamAppEntry(payload, appid);
  if (!entry?.success || !entry.data) return { name: null };

  const data = entry.data;
  return {
    name: data.name,
    thumb: data.header_image,
    releaseDate: data.release_date?.date || null,
    comingSoon: data.release_date?.coming_soon || false,
    appType: data.type || null,
    parentTitle: data.fullgame?.name || null,
    parentAppid: data.fullgame?.appid ? String(data.fullgame.appid) : null,
    metacriticScore: data.metacritic?.score ?? null,
    metacriticUrl: data.metacritic?.url ?? null,
    genres: (data.genres || []).map((g) => g.description),
    // Steam's own AU prices, in cents (4999 = $49.99) — not a conversion.
    steamAuPrice: data.price_overview
      ? data.price_overview.final / 100
      : data.is_free
        ? 0
        : null,
    steamAuRrp: data.price_overview
      ? data.price_overview.initial / 100
      : null,
  };
}

function selectSteamAppEntry(payload, appid) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const requested = String(appid);

  const matched = Object.values(payload).find(
    (entry) => entry && typeof entry === "object" && entry.data && String(entry.data.steam_appid) === requested
  );
  if (matched?.success) return matched;

  const direct = payload[requested];
  if (direct && typeof direct === "object" && direct.success && direct.data) return direct;

  return matched || (direct && typeof direct === "object" ? direct : null);
}
