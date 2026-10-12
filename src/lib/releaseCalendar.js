// Shared release-calendar helpers — used by the full page and the
// dashboard/Market preview cards. Real RAWG + Steam wishlist data only.

// Steam art is resolved at render time (see SteamArt). The legacy
// header.jpg URL 404s for newer apps, so it isn't baked in here.

export const RELEASE_WINDOW_DAYS = 120;
export const RELEASE_MAX_ITEMS = 48;
export const RELEASE_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86_400_000);
}

export function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatDayLabel(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function countdownLabel(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function platformShort(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("playstation")) return "PS";
  if (n.includes("xbox")) return "XB";
  if (n.includes("nintendo") || n.includes("switch")) return "NSW";
  if (n.includes("pc") || n.includes("windows")) return "PC";
  if (n.includes("mac")) return "Mac";
  if (n.includes("linux")) return "Linux";
  if (n.includes("ios") || n.includes("android")) return "Mobile";
  return name?.slice(0, 4) || "";
}

export function buildStatusTags(entry, { ownedAppids, ownedNames }, daysUntilRelease) {
  const owned = entry.appid
    ? ownedAppids.has(entry.appid)
    : ownedNames.has(entry.name.toLowerCase());

  if (owned) {
    if (daysUntilRelease > 0) {
      return [{ key: "preordered", label: "Preordered", className: "tag tag--preorder" }];
    }
    return [{ key: "owned", label: "Owned", className: "tag tag--steam-purchased" }];
  }

  const tags = [];
  if (entry.isSteamWishlist) {
    tags.push({ key: "steam-wishlist", label: "Steam Wishlist", className: "tag tag--amber-outline" });
  } else if (entry.isLykodexWishlist) {
    tags.push({ key: "wishlisted", label: "Wishlisted", className: "tag tag--rose-outline" });
  }

  return tags;
}

export function mergeReleases(steamUpcoming, rawgReleases, wishlistTitles) {
  const byName = new Map();

  for (const game of steamUpcoming) {
    const key = game.name.toLowerCase();
    byName.set(key, {
      id: `steam-${game.appid}`,
      appid: game.appid,
      name: game.name,
      releaseDate: game.releaseDate,
      imageUrl: null,
      isSteamWishlist: true,
      isLykodexWishlist: wishlistTitles.has(key),
      platforms: ["Steam"],
    });
  }

  for (const game of rawgReleases) {
    const key = game.name.toLowerCase();
    if (byName.has(key)) {
      const existing = byName.get(key);
      if (!existing.imageUrl && game.backgroundImage) existing.imageUrl = game.backgroundImage;
      if (game.platforms?.length) {
        existing.platforms = [...new Set([...(existing.platforms || []), ...game.platforms])];
      }
      continue;
    }
    byName.set(key, {
      id: `rawg-${game.id}`,
      name: game.name,
      releaseDate: game.released,
      imageUrl: game.backgroundImage || null,
      isSteamWishlist: false,
      isLykodexWishlist: wishlistTitles.has(key),
      platforms: game.platforms || [],
    });
  }

  return [...byName.values()]
    .filter((entry) => entry.releaseDate && daysUntil(entry.releaseDate) >= 0)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate))
    .slice(0, RELEASE_MAX_ITEMS);
}

export function buildCalendarCells(viewYear, viewMonth, releasesByDate) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const todayKey = toDateKey(new Date());
  const cells = [];

  const startPad = firstOfMonth.getDay();
  for (let i = startPad - 1; i >= 0; i -= 1) {
    const date = new Date(viewYear, viewMonth, -i);
    const key = toDateKey(date);
    cells.push({
      key,
      day: date.getDate(),
      isCurrentMonth: false,
      isToday: key === todayKey,
      releases: releasesByDate.get(key) || [],
    });
  }

  for (let day = 1; day <= lastOfMonth.getDate(); day += 1) {
    const date = new Date(viewYear, viewMonth, day);
    const key = toDateKey(date);
    cells.push({
      key,
      day,
      isCurrentMonth: true,
      isToday: key === todayKey,
      releases: releasesByDate.get(key) || [],
    });
  }

  while (cells.length % 7 !== 0) {
    const offset = cells.length - (startPad + lastOfMonth.getDate());
    const date = new Date(viewYear, viewMonth + 1, offset + 1);
    const key = toDateKey(date);
    cells.push({
      key,
      day: date.getDate(),
      isCurrentMonth: false,
      isToday: key === todayKey,
      releases: releasesByDate.get(key) || [],
    });
  }

  let nextPadDay = cells.length - (startPad + lastOfMonth.getDate());
  while (cells.length < 42) {
    const date = new Date(viewYear, viewMonth + 1, nextPadDay + 1);
    const key = toDateKey(date);
    cells.push({
      key,
      day: date.getDate(),
      isCurrentMonth: false,
      isToday: key === todayKey,
      releases: releasesByDate.get(key) || [],
    });
    nextPadDay += 1;
  }

  return cells.slice(0, 42);
}

export function buildReleasesByDate(releases) {
  const map = new Map();
  for (const entry of releases) {
    const key = toDateKey(entry.releaseDate);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

export function buildWeekStrip(releasesByDate, startDate = new Date(), days = 7) {
  const strip = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i += 1) {
    const key = toDateKey(cursor);
    strip.push({
      key,
      weekday: RELEASE_WEEKDAYS[cursor.getDay()],
      day: cursor.getDate(),
      isToday: key === toDateKey(new Date()),
      count: (releasesByDate.get(key) || []).length,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return strip;
}
