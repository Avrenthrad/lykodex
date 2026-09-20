// Nav section data — Gaming's sidebar items, and which views belong
// to the Gaming/TCG Colleges. Moved out of Header.jsx (which still
// uses all three internally, alongside GamingSidebar.jsx and App.jsx)
// purely so Vite's Fast Refresh can treat Header.jsx as a
// component-only file again — a file that exports both a component
// and plain constants forces a full-page reload on every edit instead
// of a hot swap.

// Gaming's own sub-pages — shown as a left sidebar only while inside
// the Gaming College specifically (see App.jsx's GamingSidebar usage).
export const GAMING_SIDEBAR_ITEMS = [
  // Labeled "Dashboard" rather than "Overview" — the top College tabs
  // already have an "Overview" (the cross-College summary page), and
  // both render at once on every Gaming page, so the two need visibly
  // different names even though this one still maps to the "dashboard" view.
  { id: "dashboard", label: "Dashboard" },
  { id: "backlog", label: "Backlog" },
  { id: "release-calendar", label: "Release Calendar" },
  { id: "prices", label: "Market" },
  { id: "achievements", label: "Achievement Tracker" },
  { id: "library", label: "Gaming Collection" },
];

// Views that belong to the Gaming College — used to decide whether
// the Gaming tab should show as active and whether the sidebar shows.
export const GAMING_VIEWS = [
  "dashboard", "library", "prices", "hype-charts", "market", "sales",
  "backlog", "release-calendar", "achievements", "upcoming-releases", "linking", "settings", "dashfeed",
];

// Account/settings screens inside Gaming — no left sidebar here.
export const GAMING_SETTINGS_VIEWS = ["linking", "settings", "dashfeed"];

export const GAMING_SIDEBAR_VIEWS = GAMING_VIEWS.filter(
  (v) => !GAMING_SETTINGS_VIEWS.includes(v)
);

// TCG College — sidebar shell; page labels TBD as features land.
export const TCG_SIDEBAR_ITEMS = [
  { id: "tcg-home", label: "Home" },
];

export const TCG_VIEWS = [
  "tcg-home",
  "mtg-search", "mtg-collection", "mtg-decks", "mtg-price-watch", "mtg-scan", "mtg-import",
  "tcg-marketplace",
  "fab-search", "fab-collection", "fab-decks", "fab-scan",
  "pokemon-search", "pokemon-collection", "pokemon-decks", "pokemon-scan",
  "yugioh-search", "yugioh-collection", "yugioh-decks",
  "onepiece-search", "onepiece-collection", "onepiece-decks",
  "riftbound-search", "riftbound-collection", "riftbound-decks",
];

export const TCG_SIDEBAR_VIEWS = [...TCG_VIEWS];

// Library (Entertainment) College — sidebar shell; page labels TBD.
export const ENTERTAINMENT_SIDEBAR_ITEMS = [
  { id: "college-entertainment", label: "Home" },
];

export const ENTERTAINMENT_VIEWS = ["college-entertainment", "books", "comics"];

export const ENTERTAINMENT_SIDEBAR_VIEWS = [...ENTERTAINMENT_VIEWS];

// Loot (Collectibles) College — sidebar shell; page labels TBD.
export const COLLECTIBLES_SIDEBAR_ITEMS = [
  { id: "college-collectibles", label: "Home" },
];

export const COLLECTIBLES_VIEWS = ["college-collectibles"];

export const COLLECTIBLES_SIDEBAR_VIEWS = [...COLLECTIBLES_VIEWS];

// Wartable (Tabletop) College — sidebar shell; page labels TBD.
export const TABLETOP_SIDEBAR_ITEMS = [
  { id: "college-tabletop", label: "Home" },
];

export const TABLETOP_VIEWS = ["college-tabletop"];

export const TABLETOP_SIDEBAR_VIEWS = [...TABLETOP_VIEWS];

const COLLEGE_SIDEBAR_BY_ID = {
  gaming: { collegeId: "gaming", label: "Gaming", items: GAMING_SIDEBAR_ITEMS, views: GAMING_SIDEBAR_VIEWS },
  tcg: { collegeId: "tcg", label: "TCG", items: TCG_SIDEBAR_ITEMS, views: TCG_SIDEBAR_VIEWS },
  entertainment: { collegeId: "entertainment", label: "Library", items: ENTERTAINMENT_SIDEBAR_ITEMS, views: ENTERTAINMENT_SIDEBAR_VIEWS },
  collectibles: { collegeId: "collectibles", label: "Loot", items: COLLECTIBLES_SIDEBAR_ITEMS, views: COLLECTIBLES_SIDEBAR_VIEWS },
  tabletop: { collegeId: "tabletop", label: "Wartable", items: TABLETOP_SIDEBAR_ITEMS, views: TABLETOP_SIDEBAR_VIEWS },
};

/** Which college left-rail to show for the current view, if any. */
export function getCollegeSidebarForView(view) {
  for (const config of Object.values(COLLEGE_SIDEBAR_BY_ID)) {
    if (config.views.includes(view)) return config;
  }
  return null;
}

/** College home views only — full-width hero banner, not sub-pages. */
const COLLEGE_HERO_BY_VIEW = {
  dashboard: "gaming",
  "tcg-home": "tcg",
  "college-entertainment": "entertainment",
  "college-collectibles": "collectibles",
  "college-tabletop": "tabletop",
};

export function getCollegeHeroForView(view) {
  return COLLEGE_HERO_BY_VIEW[view] ?? null;
}
