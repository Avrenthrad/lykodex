/**
 * AppContext — central state for Lykodex
 *
 * This replaces the previous 25 useState + 17 useEffect god-component
 * pattern in App.jsx. All session, profile, wishlist, theme, layout,
 * and dashfeed state lives here. Components consume what they need
 * via the hooks in ../hooks/useApp.js instead of prop drilling.
 *
 * Design notes kept from the original:
 * - Hydration guard prevents write-back from overwriting DB values
 *   with local defaults during the login fetch.
 * - Debounced profile writes (500ms) so rapid theme/currency toggles
 *   don't spam Supabase.
 * - Layout + platform order still work offline via localStorage
 *   when logged out.
 * - Personal API keys (XBXprices / PlatPrices) still flow through
 *   the same setters so the rest of the lib layer doesn't change.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppContext } from "./appContextInstance";
import { initialWishlist } from "../data/wishlist";
import { DEFAULT_DASHBOARD_LAYOUT } from "../data/dashboardLayout";
import { isPackagedApp, isTauri } from "../lib/platform";
import { requestUpfrontPermissions } from "../lib/requestPermissions";
import { DEFAULT_PLATFORM_ORDER } from "../data/platformOrder";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import { signOut as supabaseSignOut, requestLykodexSession } from "../lib/auth";
import { subscribeToPresence } from "../lib/presence";
import { completeXboxLink, consumeXboxOAuthCallback, parseXboxOAuthRedirectUrl } from "../lib/xboxOAuth";
import { consumeSteamOpenIdCallback, verifySteamOpenIdCallback } from "../lib/steamAuth";
import { App as CapacitorApp } from "@capacitor/app";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  fetchProfile,
  upsertProfile,
  fetchWishlist,
  insertWishlistItem,
  deleteWishlistItem,
} from "../lib/userData";
import { setPersonalXbxPricesKey } from "../lib/xbxprices";
import { setPersonalPlatPricesKey } from "../lib/platprices";
import { computeGdScore } from "../lib/gdScore";
import { logActivityForUser } from "../lib/guilds";
import { recomputeMastery as recomputeMasteryData } from "../lib/gameMasteryData";
import { recomputeOverallMastery as recomputeOverallMasteryData } from "../lib/overallMasteryData";

// ---------- constants (same as before) ----------

const DASHFEED_GAMES = ["Destiny 2", "Fortnite", "League of Legends", "Valorant"];
const DASHFEED_STORES = [
  "Steam",
  "Xbox Store",
  "PlayStation Store",
  "GOG",
  "Epic Games Store",
  "Humble Store",
  "G2A",
];
const DASHFEED_PLATFORMS = [
  "Steam",
  "PlayStation",
  "Xbox",
  "Epic Games",
  "Riot Games",
  "Discord",
  "Nintendo",
];

const KNOWN_VIEWS = [
  // Dev-only visual gallery of the auth/onboarding screens — see
  // components/dev/PreviewGallery.jsx. Unknown in production, so a
  // built app falls through to Overview like any other bad hash.
  ...(import.meta.env.DEV ? ["preview"] : []),
  "dashboard",
  "linking",
  "settings",
  "dashfeed",
  "onboarding",
  "prices",
  "hype-charts",
  "market",
  "sales",
  "backlog",
  "achievements",
  "release-calendar",
  "upcoming-releases",
  "mtg-search",
  "mtg-collection",
  "mtg-decks",
  "mtg-price-watch",
  "mtg-scan",
  "mtg-import",
  "guilds",
  "friends",
  "inbox",
  "overview",
  "library",
  "tcg-home",
  "tcg-marketplace",
  "fab-search",
  "fab-collection",
  "fab-decks",
  "fab-scan",
  "pokemon-search",
  "pokemon-collection",
  "pokemon-decks",
  "pokemon-scan",
  "college-entertainment",
  "books",
  "comics",
  "college-collectibles",
  "college-tabletop",
  "yugioh-search",
  "yugioh-collection",
  "yugioh-decks",
  "onepiece-search",
  "onepiece-collection",
  "onepiece-decks",
  "riftbound-search",
  "riftbound-collection",
  "riftbound-decks",
  "assistant",
];

// The 5 College home pages only — not their subpages (backlog,
// achievements, collections, deck builders, etc.), which keep the
// app-wide gold default. "dashboard" is Gaming's home view id (never
// renamed — see the College display-label rename, IDs stayed stable).
const COLLEGE_HOME_VIEWS = [
  "dashboard",
  "tcg-home",
  "college-entertainment",
  "college-collectibles",
  "college-tabletop",
];

const EXPECTED_LAYOUT_KEYS = DEFAULT_DASHBOARD_LAYOUT.map((item) => item.i)
  .sort()
  .join(",");

function allOn(list) {
  const map = {};
  list.forEach((item) => {
    map[item] = true;
  });
  return map;
}

function isValidLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== DEFAULT_DASHBOARD_LAYOUT.length) {
    return false;
  }
  const keys = layout
    .map((item) => item?.i)
    .sort()
    .join(",");
  if (keys !== EXPECTED_LAYOUT_KEYS) return false;
  return layout.every(
    (item) =>
      ["x", "y", "w", "h"].every(
        (k) => typeof item[k] === "number" && Number.isFinite(item[k]) && item[k] >= 0
      ) &&
      item.w > 0 &&
      item.h > 0
  );
}

function parseHash(hash) {
  const path = hash.replace(/^#\/?/, "");
  const [view, sub] = path.split("/");
  if (view === "login") {
    return { view: "login", loginMode: sub === "signup" ? "signup" : "login" };
  }
  return {
    view: KNOWN_VIEWS.includes(view) ? view : "overview",
    loginMode: "login",
  };
}

function hashFor(view, mode) {
  if (view === "login") {
    return `#/login/${mode === "signup" ? "signup" : "login"}`;
  }
  return `#/${view}`;
}

// ---------- context ----------

export function AppProvider({ children }) {
  // ----- navigation -----
  const [view, setView] = useState("dashboard");
  const [loginMode, setLoginMode] = useState("login");

  // ----- auth -----
  const [session, setSession] = useState(null);
  const isLoggedIn = Boolean(session);
  const userId = session?.user?.id ?? null;

  // ----- "act as Lykodex" (exclusive to the one registered delegate
  // account, see lib/auth.js) — a genuine session swap, so this is
  // holding the real personal session's tokens in memory (never
  // persisted) purely so flipping back doesn't require a real
  // re-login. Cleared on a real sign-out either way.
  const [personalSessionCache, setPersonalSessionCache] = useState(null);
  const actingAsLykodex = Boolean(personalSessionCache);

  // ----- online presence (real in-app "who's here now", not Steam
  // status) — see lib/presence.js. Friends list + guild member roster
  // sort online-first off this; deliberately not used for friend
  // requests. -----
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());

  useEffect(() => {
    if (!supabaseConfigured || !userId) {
      setOnlineUserIds(new Set());
      return;
    }
    const unsubscribe = subscribeToPresence(userId, setOnlineUserIds);
    return unsubscribe;
  }, [userId]);

  // ----- profile -----
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [gdScore, setGdScore] = useState(0);
  const [linkedSteamId, setLinkedSteamId] = useState(null);

  // ----- Game Mastery Score (real Steam + self-reported Xbox/PS) -----
  // Cached on the profile, same pattern as gd_score — recomputed via
  // recomputeMastery() below right after a "new snapshot" event (Steam
  // link/unlink, or saving Xbox/PS self-reported numbers), not on
  // every render. See lib/gameMasteryData.js.
  const [masteryScore, setMasteryScore] = useState(0);
  const [masteryXp, setMasteryXp] = useState(0);
  const [masteryLevel, setMasteryLevel] = useState(0);
  const [masteryBreakdown, setMasteryBreakdown] = useState([]);
  const [masteryComputedAt, setMasteryComputedAt] = useState(null);

  // ----- Overall Mastery Score (all 5 Colleges combined) -----
  // Gaming Mastery above is one of its inputs, reused as-is. Same
  // cached-on-profile / recompute-on-key-events pattern, not the
  // header badge's live-on-every-render style. See
  // lib/overallMasteryData.js.
  const [overallMasteryScore, setOverallMasteryScore] = useState(0);
  const [overallMasteryXp, setOverallMasteryXp] = useState(0);
  const [overallMasteryLevel, setOverallMasteryLevel] = useState(0);
  const [overallMasteryBreakdown, setOverallMasteryBreakdown] = useState([]);
  const [overallMasteryComputedAt, setOverallMasteryComputedAt] = useState(null);

  const [themeMode, setThemeMode] = useState("dark");
  const [accentColor, setAccentColor] = useState("gold");
  // Whether the user has ever explicitly picked an accent (via the
  // swatch row in Account Settings) as opposed to just sitting on
  // whatever the default happens to be. This is a REAL flag, not
  // derived from accent_color being non-null — the write-back effect
  // below has always saved accent_color on every profile edit
  // regardless of whether the user ever opened the theme picker, so
  // null-ness alone can't tell "never touched it" apart from "saved
  // the default". Only setAccentColorExplicit (used by the picker)
  // sets this true. See effectiveAccent below for what this unlocks:
  // per-page accent defaults (gold on Overview, red on the 5 College
  // homes) for anyone who hasn't customized, logged-out visitors
  // included.
  const [accentCustomized, setAccentCustomized] = useState(false);
  const [wallpaperUrl, setWallpaperUrl] = useState(null);
  const [currency, setCurrency] = useState("AUD");
  const [shareActivityWithGuilds, setShareActivityWithGuilds] = useState(false);
  // Mutual: you only see a friend's read receipt if THEY also have
  // this on; disabling yours hides your own read status from them
  // too, the same "both sides opted in, or neither sees anything"
  // model most messaging apps use — see InboxPage.jsx.
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [xbxpricesKey, setXbxpricesKey] = useState("");
  const [platpricesKey, setPlatpricesKey] = useState("");

  // ----- wishlist -----
  const [wishlist, setWishlist] = useState(initialWishlist);

  // ----- dashfeed toggles -----
  // Bundles a handful of Account Settings fields (phone, timezone,
  // per-platform friend codes, streaming names, visibility toggles)
  // that were previously plain local useState in AccountSettingsPage
  // itself — never threaded up here, never written to Supabase, so
  // they silently reset to blank on every refresh. That was a real,
  // reported bug, not intentional scope — this is the actual fix,
  // one jsonb column instead of nine separate ones, matching how
  // Dashfeed's toggle groups are already bundled.
  const [profileDetails, setProfileDetailsState] = useState({});
  const updateProfileDetails = useCallback((patch) => {
    setProfileDetailsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const [gameToggles, setGameToggles] = useState(() => {
    try {
      const saved = localStorage.getItem("gd-dashfeed-games");
      return saved ? JSON.parse(saved) : allOn(DASHFEED_GAMES);
    } catch {
      return allOn(DASHFEED_GAMES);
    }
  });
  const [storeToggles, setStoreToggles] = useState(() => {
    try {
      const saved = localStorage.getItem("gd-dashfeed-stores");
      return saved ? JSON.parse(saved) : allOn(DASHFEED_STORES);
    } catch {
      return allOn(DASHFEED_STORES);
    }
  });
  const [platformToggles, setPlatformToggles] = useState(() => {
    try {
      const saved = localStorage.getItem("gd-dashfeed-platforms");
      return saved ? JSON.parse(saved) : allOn(DASHFEED_PLATFORMS);
    } catch {
      return allOn(DASHFEED_PLATFORMS);
    }
  });

  // ----- layout -----
  const [dashboardLayout, setDashboardLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("gd-dashboard-layout");
      if (!saved) return DEFAULT_DASHBOARD_LAYOUT;
      const parsed = JSON.parse(saved);
      return isValidLayout(parsed) ? parsed : DEFAULT_DASHBOARD_LAYOUT;
    } catch {
      return DEFAULT_DASHBOARD_LAYOUT;
    }
  });
  const [customizingLayout, setCustomizingLayout] = useState(false);

  // Post-signup onboarding: college-picker -> optional account
  // linking -> overview. Purely local, ephemeral state — this is a
  // one-time first-run flow, nothing here needs to survive a refresh
  // or be written to Supabase.
  const [onboardingStep, setOnboardingStep] = useState("college-picker");

  // Which of the 5 Colleges someone actually cares about — captured
  // during onboarding, used later to filter the top-level nav so
  // people aren't shown tabs for things they have no interest in.
  // Defaults to just Gaming, since that's the only College that's
  // fully real right now — everything else is explicitly opt-in.
  const [selectedColleges, setSelectedColleges] = useState(["gaming"]);
  const [platformOrder, setPlatformOrder] = useState(() => {
    try {
      const saved = localStorage.getItem("gd-platform-order");
      return saved ? JSON.parse(saved) : DEFAULT_PLATFORM_ORDER;
    } catch {
      return DEFAULT_PLATFORM_ORDER;
    }
  });

  // ----- splash -----
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

  // ----- refs for hydration / debounced writes -----
  const hydratedRef = useRef(false);
  const writeTimerRef = useRef(null);
  const wallpaperWriteTimerRef = useRef(null);
  // True only when the hash-routing init effect defaulted a packaged
  // app straight to "login" with no explicit hash — lets the
  // auth-session effect below bounce a person with an already-
  // persisted session on to the dashboard once that resolves, without
  // also hijacking a deliberate later navigation back to login.
  const bootRedirectPendingRef = useRef(false);
  const pendingXboxCallbackRef = useRef(null);
  // idle | linking | success | error
  const [xboxLinkStatus, setXboxLinkStatus] = useState("idle");
  const [xboxLinkResult, setXboxLinkResult] = useState(null);
  const pendingSteamCallbackRef = useRef(null);
  // idle | linking | success | error
  const [steamLinkStatus, setSteamLinkStatus] = useState("idle");
  const [steamLinkResult, setSteamLinkResult] = useState(null);

  // ---------- derived ----------
  const effectivePlatformOrder = useMemo(
    () => platformOrder.filter((name) => storeToggles[name] !== false),
    [platformOrder, storeToggles]
  );

  const enabledGames = useMemo(
    () => Object.keys(gameToggles).filter((g) => gameToggles[g]),
    [gameToggles]
  );

  // ---------- effects: personal API keys ----------
  useEffect(() => {
    setPersonalXbxPricesKey(xbxpricesKey);
  }, [xbxpricesKey]);

  useEffect(() => {
    setPersonalPlatPricesKey(platpricesKey);
  }, [platpricesKey]);

  // ---------- effects: localStorage persistence for offline prefs ----------
  useEffect(() => {
    try {
      localStorage.setItem("gd-dashfeed-games", JSON.stringify(gameToggles));
    } catch {
      /* ignore */
    }
  }, [gameToggles]);

  useEffect(() => {
    try {
      localStorage.setItem("gd-dashfeed-stores", JSON.stringify(storeToggles));
    } catch {
      /* ignore */
    }
  }, [storeToggles]);

  useEffect(() => {
    try {
      localStorage.setItem("gd-dashfeed-platforms", JSON.stringify(platformToggles));
    } catch {
      /* ignore */
    }
  }, [platformToggles]);

  useEffect(() => {
    try {
      localStorage.setItem("gd-dashboard-layout", JSON.stringify(dashboardLayout));
    } catch {
      /* ignore */
    }
  }, [dashboardLayout]);

  useEffect(() => {
    try {
      localStorage.setItem("gd-platform-order", JSON.stringify(platformOrder));
    } catch {
      /* ignore */
    }
  }, [platformOrder]);

  // ---------- effects: theme on <html> ----------
  useEffect(() => {
    document.documentElement.dataset.mode = themeMode;
  }, [themeMode]);

  useEffect(() => {
    // Default (never-customized) accent is page-dependent — gold on
    // Overview, red on the 5 College home pages, gold everywhere else
    // — per the user's explicit choice. Once someone actually picks a
    // swatch (setAccentColorExplicit → accentCustomized = true), that
    // choice wins everywhere, same as before this feature existed.
    const effectiveAccent = accentCustomized
      ? accentColor
      : COLLEGE_HOME_VIEWS.includes(view)
      ? "red"
      : "gold";
    document.documentElement.dataset.accent = effectiveAccent;
  }, [accentColor, accentCustomized, view]);

  useEffect(() => {
    if (wallpaperUrl) {
      document.documentElement.style.setProperty("--user-wallpaper", `url("${wallpaperUrl}")`);
      document.documentElement.dataset.wallpaper = "on";
    } else {
      document.documentElement.style.removeProperty("--user-wallpaper");
      document.documentElement.dataset.wallpaper = "off";
    }
  }, [wallpaperUrl]);

  // ---------- effects: GD Score ----------
  useEffect(() => {
    computeGdScore(linkedSteamId, wishlist.length).then(setGdScore);
  }, [linkedSteamId, wishlist.length]);

  // ---------- effects: auth session ----------
  useEffect(() => {
    if (!supabaseConfigured) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---------- effects: hydrate on login / reset on logout ----------
  useEffect(() => {
    if (!supabaseConfigured) return;

    if (!userId) {
      hydratedRef.current = false;
      setAvatarUrl(null);
      setFirstName("");
      setLastName("");
      setProfileDetailsState({});
      setUsername("");
      setGdScore(0);
      setWishlist([]);
      setLinkedSteamId(null);
      setMasteryScore(0);
      setMasteryXp(0);
      setMasteryLevel(0);
      setMasteryBreakdown([]);
      setMasteryComputedAt(null);
      setOverallMasteryScore(0);
      setOverallMasteryXp(0);
      setOverallMasteryLevel(0);
      setOverallMasteryBreakdown([]);
      setOverallMasteryComputedAt(null);
      setThemeMode("dark");
      setAccentColor("gold");
      setAccentCustomized(false);
      setWallpaperUrl(null);
      setCurrency("AUD");
      setXbxpricesKey("");
      setPlatpricesKey("");
      setShareActivityWithGuilds(false);
      // Layout deliberately kept — still useful offline
      return;
    }

    let cancelled = false;
    hydratedRef.current = false;

    Promise.all([fetchProfile(userId), fetchWishlist(userId)])
      .then(([profile, wishlistRows]) => {
        if (cancelled) return;
        // Fall back to the OAuth provider's own avatar (Google/Discord
        // expose this in user_metadata) when nothing has been uploaded
        // to our own storage yet — better than showing the default
        // icon for someone who signed in with a provider that already
        // has a photo.
        setAvatarUrl(
          profile.avatar_url || session?.user?.user_metadata?.avatar_url || null
        );
        setFirstName(profile.first_name || "");
        setLastName(profile.last_name || "");
        setUsername(profile.username || "");
        setGdScore(profile.gd_score || 0);
        setLinkedSteamId(profile.linked_steam_id || null);
        setMasteryScore(profile.mastery_score || 0);
        setMasteryXp(profile.mastery_xp || 0);
        setMasteryLevel(profile.mastery_level || 0);
        setMasteryBreakdown(profile.mastery_breakdown || []);
        setMasteryComputedAt(profile.mastery_computed_at || null);
        setOverallMasteryScore(profile.overall_mastery_score || 0);
        setOverallMasteryXp(profile.overall_mastery_xp || 0);
        setOverallMasteryLevel(profile.overall_mastery_level || 0);
        setOverallMasteryBreakdown(profile.overall_mastery_breakdown || []);
        setOverallMasteryComputedAt(profile.overall_mastery_computed_at || null);
        setThemeMode(profile.theme_mode || "dark");
        // "yellow" was retired as its own preset in the gold-default
        // redesign — gold replaces it, so treat old saved picks as gold
        // rather than leaving the theme picker with nothing selected.
        setAccentColor(profile.accent_color === "yellow" ? "gold" : profile.accent_color || "gold");
        setAccentCustomized(Boolean(profile.accent_customized));
        setWallpaperUrl(profile.wallpaper_url || null);
        setCurrency(profile.currency || "AUD");
        setShareActivityWithGuilds(profile.share_activity_with_guilds || false);
        setReadReceiptsEnabled(profile.read_receipts_enabled !== false);
        setXbxpricesKey(profile.xbxprices_key || "");
        setPlatpricesKey(profile.platprices_key || "");
        if (profile.dashfeed_games) setGameToggles(profile.dashfeed_games);
        if (profile.dashfeed_stores) setStoreToggles(profile.dashfeed_stores);
        if (profile.dashfeed_platforms) setPlatformToggles(profile.dashfeed_platforms);
        setWishlist(wishlistRows);
        if (isValidLayout(profile.dashboard_layout)) {
          setDashboardLayout(profile.dashboard_layout);
        }
        if (profile.platform_order) {
          setPlatformOrder(profile.platform_order);
        }
        if (profile.profile_details) {
          setProfileDetailsState(profile.profile_details);
        }
        if (profile.selected_colleges) {
          setSelectedColleges(profile.selected_colleges);
        }
        hydratedRef.current = true;

        // First-time real number for existing accounts, without
        // requiring a manual "Recompute" click — fires once, only when
        // this profile has genuinely never had an overall score
        // computed. Fire-and-forget: doesn't block hydration.
        if (!profile.overall_mastery_computed_at) {
          recomputeOverallMasteryData(userId, profile.mastery_score || 0)
            .then((result) => {
              if (cancelled) return;
              setOverallMasteryScore(result.overallScore);
              setOverallMasteryXp(result.accountXp);
              setOverallMasteryLevel(result.accountLevel);
              setOverallMasteryBreakdown(result.breakdown);
              setOverallMasteryComputedAt(result.computedAt);
            })
            .catch((err) => console.error("Initial Overall Mastery compute failed:", err));
        }
      })
      .catch((err) => {
        console.error("Failed to load profile/wishlist:", err);
        hydratedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
    // session is intentionally read but not a dep: it changes in the
    // same render as userId (userId is derived from it), so this only
    // needs to re-run on userId transitions, not every session update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ---------- effects: debounced profile write-back ----------
  useEffect(() => {
    if (!supabaseConfigured || !userId || !hydratedRef.current) return;

    clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      upsertProfile(userId, {
        avatar_url: avatarUrl,
        first_name: firstName,
        last_name: lastName,
        username,
        theme_mode: themeMode,
        accent_color: accentColor,
        accent_customized: accentCustomized,
        currency,
        share_activity_with_guilds: shareActivityWithGuilds,
        read_receipts_enabled: readReceiptsEnabled,
        linked_steam_id: linkedSteamId,
        dashboard_layout: dashboardLayout,
        platform_order: platformOrder,
        xbxprices_key: xbxpricesKey,
        platprices_key: platpricesKey,
        dashfeed_games: gameToggles,
        dashfeed_stores: storeToggles,
        dashfeed_platforms: platformToggles,
        profile_details: profileDetails,
        selected_colleges: selectedColleges,
        gd_score: gdScore,
      }).catch((err) => console.error("Failed to save profile:", err));
    }, 500);

    return () => clearTimeout(writeTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    avatarUrl,
    firstName,
    lastName,
    username,
    themeMode,
    accentColor,
    accentCustomized,
    currency,
    shareActivityWithGuilds,
    readReceiptsEnabled,
    linkedSteamId,
    dashboardLayout,
    platformOrder,
    xbxpricesKey,
    platpricesKey,
    gameToggles,
    storeToggles,
    platformToggles,
    profileDetails,
    selectedColleges,
    gdScore,
    userId,
  ]);

  // ---------- effects: debounced wallpaper write-back (isolated) ----------
  // Kept as its own write, deliberately separate from the big bundled
  // upsertProfile call above. profiles.wallpaper_url is a brand-new
  // column (see supabase/schema.sql) that may not exist yet on every
  // deployment until that migration is actually run — bundling it into
  // the single big .update() would mean one missing column fails that
  // *entire* update, silently breaking name/theme/avatar saves too.
  // Isolating it means a not-yet-migrated database only loses the new
  // wallpaper feature, not every other profile field.
  useEffect(() => {
    if (!supabaseConfigured || !userId || !hydratedRef.current) return;

    clearTimeout(wallpaperWriteTimerRef.current);
    wallpaperWriteTimerRef.current = setTimeout(() => {
      upsertProfile(userId, { wallpaper_url: wallpaperUrl }).catch((err) =>
        console.error("Failed to save wallpaper (has the wallpaper_url migration been run?):", err)
      );
    }, 500);

    return () => clearTimeout(wallpaperWriteTimerRef.current);
  }, [wallpaperUrl, userId]);

  // ---------- effects: hash routing ----------
  useEffect(() => {
    function syncFromHash() {
      const parsed = parseHash(window.location.hash);
      setView(parsed.view);
      setLoginMode(parsed.loginMode);
    }

    window.addEventListener("hashchange", syncFromHash);

    if (!window.location.hash) {
      // The website intentionally allows anonymous browsing (most
      // pages already show real content with inline "Sign in to see X
      // here" prompts rather than a hard wall) — but a packaged
      // desktop/mobile install is opened specifically to use an
      // account, so it boots straight to login instead. If a session
      // is actually already persisted, the auth-session effect below
      // bounces it on to Overview once that resolves. Overview (not
      // the Gaming dashboard) is the actual default home everywhere —
      // it's the one page that summarizes across every College instead
      // of just Gaming's.
      const defaultView = isPackagedApp() ? "login" : "overview";
      if (defaultView === "login") bootRedirectPendingRef.current = true;
      window.history.replaceState(null, "", hashFor(defaultView));
      setView(defaultView);
    } else {
      syncFromHash();
    }

    requestUpfrontPermissions();

    // Real Microsoft OAuth callback for Xbox Live sign-in (see
    // lib/xboxOAuth.js) — Microsoft redirects back to this app's own
    // root with ?code=...&state=xbox-link, which lands here before the
    // hash-based view has even resolved. consumeXboxOAuthCallback()
    // both reads and strips these query params immediately (so a
    // refresh never tries to redeem an already-used code) regardless
    // of login state; the actual exchange happens in the effect below
    // once a real session is confirmed, since it needs the caller's
    // access token.
    const xboxCallback = consumeXboxOAuthCallback();
    if (xboxCallback) pendingXboxCallbackRef.current = xboxCallback;

    // Real "Sign in through Steam" callback (see lib/steamAuth.js) —
    // same shape as the Xbox one just above: Steam redirects back
    // here with a batch of real ?openid.* params, captured and
    // stripped immediately regardless of login state, verified in the
    // effect below once a real session exists (setLinkedSteamId needs
    // somewhere to actually write the result).
    const steamCallback = consumeSteamOpenIdCallback();
    if (steamCallback) pendingSteamCallbackRef.current = steamCallback;

    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  // Captures the browser's own real IANA timezone (not a raw UTC
  // offset, so it stays correct across daylight saving) on every real
  // login — api/pricing.js's hourly mastery-cron uses this to know
  // when it's actually midnight for this specific person, rather than
  // firing at one fixed UTC time for everyone. A plain update, not an
  // upsert-only-if-changed check — cheap enough to just always keep
  // current, and self-heals if a person's system timezone changes.
  useEffect(() => {
    if (!isLoggedIn || !userId || !supabaseConfigured) return;
    let timezone;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (err) {
      console.error("Failed to detect timezone:", err);
      return;
    }
    if (!timezone) return;
    supabase
      .from("profiles")
      .update({ timezone })
      .eq("id", userId)
      .then(({ error }) => {
        if (error) console.error("Failed to save timezone:", error);
      });
  }, [isLoggedIn, userId]);

  // ---------- effects: boot splash ----------
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFading(true), 1300);
    const removeTimer = setTimeout(() => setSplashVisible(false), 1700);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  // ---------- actions ----------
  const goTo = useCallback((nextView, mode) => {
    window.location.hash = hashFor(nextView, mode);
  }, []);

  // Completes the packaged-app boot redirect above: if a session was
  // already persisted from a previous launch, skip past the login
  // screen it defaulted to and go straight to Overview.
  useEffect(() => {
    if (isLoggedIn && bootRedirectPendingRef.current) {
      bootRedirectPendingRef.current = false;
      goTo("overview");
    }
  }, [isLoggedIn, goTo]);

  // Shared by both ways a real Xbox OAuth callback reaches this app —
  // the web query-string path below and the packaged-app deep-link
  // effect further down — so completing the sign-in behaves
  // identically either way. Routes to Account Linking either way so
  // the result (a real Gamerscore, or a real error) is visible where
  // the person started the sign-in from.
  const completeXboxOAuth = useCallback((callback) => {
    if (callback.error) {
      setXboxLinkStatus("error");
      setXboxLinkResult({ error: callback.error });
      goTo("linking");
      return;
    }

    setXboxLinkStatus("linking");
    completeXboxLink(callback.code)
      .then((result) => {
        setXboxLinkStatus("success");
        setXboxLinkResult(result);
        goTo("linking");
      })
      .catch((err) => {
        console.error("Xbox Live sign-in failed:", err);
        setXboxLinkStatus("error");
        setXboxLinkResult({ error: err.message });
        goTo("linking");
      });
  }, [goTo]);

  // Completes the Xbox Live sign-in once a real session is confirmed —
  // see the boot effect above for why the code itself was captured
  // earlier (plain web only — Microsoft redirects back to this app's
  // own URL with ?code=...).
  useEffect(() => {
    if (!isLoggedIn || !pendingXboxCallbackRef.current) return;
    const callback = pendingXboxCallbackRef.current;
    pendingXboxCallbackRef.current = null;
    completeXboxOAuth(callback);
  }, [isLoggedIn, completeXboxOAuth]);

  // Packaged-app (Tauri/Capacitor) Xbox OAuth callback — Microsoft was
  // sent to this app's own lykodex://xbox-callback scheme instead of a
  // same-window redirect (see xboxOAuth.js's xboxRedirectUri/
  // startXboxSignIn), and the OS hands the resulting URL back here the
  // same way Discord/Twitch's does (see oauthRedirect.js) — handled
  // directly in this component instead of there since completing it
  // needs a real completeXboxLink() call and this component's own
  // goTo, not just a Supabase setSession. No boot-time race to worry
  // about here (unlike the web path above): Xbox sign-in only ever
  // starts from Account Linking, well after a real session exists.
  useEffect(() => {
    if (!isPackagedApp()) return;

    function handleUrl(url) {
      const callback = parseXboxOAuthRedirectUrl(url);
      if (callback) completeXboxOAuth(callback);
    }

    if (isTauri()) {
      let unlisten;
      let cancelled = false;
      onOpenUrl((urls) => urls.forEach(handleUrl)).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }

    let subscription;
    CapacitorApp.addListener("appUrlOpen", ({ url }) => handleUrl(url)).then((sub) => {
      subscription = sub;
    });
    return () => subscription?.remove();
  }, [completeXboxOAuth]);

  // Every goTo() push a new hash entry onto the browser's real history
  // stack, so "back" almost always means "wherever the hash was before
  // this one" — using the browser's own history instead of a hardcoded
  // destination (the old goTo("overview") pattern) is what lets Friends/
  // Inbox/Guilds/a sign-in gate return to whatever page actually opened
  // them, not always the same fixed spot.
  const goBack = useCallback((fallbackView = "overview") => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      goTo(fallbackView);
    }
  }, [goTo]);

  const navigateToSection = useCallback(
    (sectionId) => {
      goTo("dashboard");
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
      });
    },
    [goTo]
  );

  const navigateToView = useCallback(
    (viewId, mode) => {
      goTo(viewId, mode);
    },
    [goTo]
  );

  const navigateHome = useCallback(() => {
    goTo("overview");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, [goTo]);

  const handleLoginSuccess = useCallback(
    (mode) => {
      // Signup always continues into onboarding regardless of where the
      // signup form was opened from. A plain sign-in, though, is almost
      // always triggered by an AccountGate on the page the user actually
      // wanted — goBack() returns them there instead of dumping every
      // successful sign-in on Overview.
      if (mode === "signup") {
        goTo("onboarding");
      } else {
        goBack("overview");
      }
    },
    [goTo, goBack]
  );

  const handleLogout = useCallback(() => {
    if (supabaseConfigured) {
      supabaseSignOut().catch((err) => console.error("Sign out failed:", err));
    }
    setPersonalSessionCache(null); // a real sign-out ends any Lykodex swap too
    goTo("overview");
  }, [goTo]);

  // Swaps the live session to the Lykodex account — see
  // lib/auth.js's requestLykodexSession for why this has to be a real
  // session swap, not a client-side pretend toggle. Caches the current
  // (personal) session's tokens first so returnToMyAccount() can swap
  // straight back without a real re-login.
  const actAsLykodex = useCallback(async () => {
    const { data: current } = await supabase.auth.getSession();
    if (!current.session) throw new Error("Not signed in.");
    const lykodexSession = await requestLykodexSession();
    setPersonalSessionCache({
      access_token: current.session.access_token,
      refresh_token: current.session.refresh_token,
    });
    const { error } = await supabase.auth.setSession({
      access_token: lykodexSession.access_token,
      refresh_token: lykodexSession.refresh_token,
    });
    if (error) {
      setPersonalSessionCache(null);
      throw error;
    }
  }, []);

  const returnToMyAccount = useCallback(async () => {
    if (!personalSessionCache) return;
    const { error } = await supabase.auth.setSession(personalSessionCache);
    setPersonalSessionCache(null);
    if (error) throw error;
  }, [personalSessionCache]);

  const clearXboxLinkResult = useCallback(() => setXboxLinkResult(null), []);
  const clearSteamLinkResult = useCallback(() => setSteamLinkResult(null), []);

  // The only setter that should ever mark accent as customized — used
  // exclusively by the Account Settings swatch row. Everywhere else
  // that touches setAccentColor (hydration, logout reset) is loading
  // state, not a user choosing something, so it must NOT flip this.
  const setAccentColorExplicit = useCallback((color) => {
    setAccentColor(color);
    setAccentCustomized(true);
  }, []);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const addToWishlist = useCallback(
    (title) => {
      let wasNew = false;
      setWishlist((prev) => {
        if (prev.some((entry) => entry.title.toLowerCase() === title.toLowerCase())) {
          return prev;
        }
        wasNew = true;
        return [
          ...prev,
          {
            id: `w-${Date.now()}`,
            title,
            type: "game",
            addedAt: new Date().toISOString(),
          },
        ];
      });
      // Only reaches Supabase when it's genuinely new by the local
      // check above — insertWishlistItem is also a real upsert with a
      // DB-level unique(user_id, title) constraint as the actual
      // safety net (this local check alone can't catch every race,
      // e.g. two tabs, or a resync running before the wishlist finishes
      // loading) — see schema.sql for why that constraint exists.
      if (wasNew && supabaseConfigured && userId) {
        insertWishlistItem(userId, title).catch((err) =>
          console.error("Failed to save wishlist add:", err)
        );
        logActivityForUser(userId, "wishlist_added", { title });
      }
    },
    [userId]
  );

  const removeFromWishlist = useCallback(
    (title) => {
      setWishlist((prev) =>
        prev.filter((entry) => entry.title.toLowerCase() !== title.toLowerCase())
      );
      if (supabaseConfigured && userId) {
        deleteWishlistItem(userId, title).catch((err) =>
          console.error("Failed to save wishlist removal:", err)
        );
      }
    },
    [userId]
  );

  const resetLayout = useCallback(() => {
    setDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
  }, []);

  // Recomputes the Mastery Score from whatever real data is actually
  // available right now (self-reported Xbox/PS inputs + live Steam
  // data if linked) and persists it. Called explicitly after a "new
  // snapshot" event — Steam link/unlink, saving Xbox Gamerscore, or
  // saving PS trophy counts — not on every render.
  //
  // Accepts an optional steamId override: right after linking/
  // unlinking Steam, the caller passes the new value directly rather
  // than relying on the linkedSteamId this closure captured, since
  // setLinkedSteamId's update isn't visible here yet in the same tick.
  const recomputeMastery = useCallback(async (steamIdOverride) => {
    if (!supabaseConfigured || !userId) return;
    try {
      const steamId = steamIdOverride !== undefined ? steamIdOverride : linkedSteamId;
      const result = await recomputeMasteryData(userId, steamId);
      setMasteryScore(result.masteryScore);
      setMasteryXp(result.accountXp);
      setMasteryLevel(result.accountLevel);
      setMasteryBreakdown(result.breakdown);
      setMasteryComputedAt(result.computedAt);
    } catch (err) {
      console.error("Failed to recompute Game Mastery:", err);
    }
  }, [userId, linkedSteamId]);

  // Recomputes the Overall Mastery Score (all 5 Colleges combined).
  // Uses whatever Gaming Mastery score is currently in state — call
  // recomputeMastery() first if that also needs a fresh Steam pull;
  // this doesn't duplicate that fetch itself.
  const recomputeOverallMastery = useCallback(async () => {
    if (!supabaseConfigured || !userId) return;
    try {
      const result = await recomputeOverallMasteryData(userId, masteryScore);
      setOverallMasteryScore(result.overallScore);
      setOverallMasteryXp(result.accountXp);
      setOverallMasteryLevel(result.accountLevel);
      setOverallMasteryBreakdown(result.breakdown);
      setOverallMasteryComputedAt(result.computedAt);
    } catch (err) {
      console.error("Failed to recompute Overall Mastery:", err);
    }
  }, [userId, masteryScore]);

  // Completes the real "Sign in through Steam" link once a real
  // session is confirmed — same shape as the Xbox web-path effect
  // above, web-only for now (see steamAuth.js's file header for why).
  // Verification only returns a SteamID64 (or throws) — it doesn't
  // import the wishlist itself, same as Xbox/PSN's linking not
  // bundling their library import; AccountLinkingPage's own "Import
  // Steam Wishlist" button (or the existing "Resync Steam wishlist"
  // on the Prices page) is still the actual import step. Mirrors the
  // same recomputeMastery(steamId).then(recomputeOverallMastery) call
  // the old manual-entry onLinkSteam wrapper made in App.jsx, so
  // linking still triggers a fresh Mastery snapshot the same way.
  //
  // Must stay below recomputeMastery/recomputeOverallMastery's own
  // declarations above — referencing them any earlier in this
  // component's dependency array (evaluated eagerly during render,
  // unlike the effect body itself) is a genuine temporal-dead-zone
  // ReferenceError on every single render, not just when this effect
  // actually fires. Confirmed live: crashed the whole app immediately
  // on both web and desktop the one time this got placed too early.
  useEffect(() => {
    if (!isLoggedIn || !pendingSteamCallbackRef.current) return;
    const params = pendingSteamCallbackRef.current;
    pendingSteamCallbackRef.current = null;

    setSteamLinkStatus("linking");
    verifySteamOpenIdCallback(params)
      .then((steamId) => {
        setLinkedSteamId(steamId);
        setSteamLinkStatus("success");
        setSteamLinkResult({ steamId });
        recomputeMastery(steamId).then(recomputeOverallMastery);
        goTo("linking");
      })
      .catch((err) => {
        console.error("Steam sign-in failed:", err);
        setSteamLinkStatus("error");
        setSteamLinkResult({ error: err.message });
        goTo("linking");
      });
  }, [isLoggedIn, goTo, recomputeMastery, recomputeOverallMastery]);

  // ---------- value (memoized so consumers don't re-render for nothing) ----------
  const value = useMemo(
    () => ({
      // navigation
      view,
      loginMode,
      goTo,
      goBack,
      navigateToSection,
      navigateToView,
      navigateHome,
      handleLoginSuccess,
      handleLogout,

      // auth
      session,
      isLoggedIn,
      userId,
      actingAsLykodex,
      actAsLykodex,
      returnToMyAccount,
      onlineUserIds,
      xboxLinkStatus,
      xboxLinkResult,
      clearXboxLinkResult,
      steamLinkStatus,
      steamLinkResult,
      clearSteamLinkResult,

      // profile
      avatarUrl,
      setAvatarUrl,
      firstName,
      setFirstName,
      lastName,
      setLastName,
      username,
      setUsername,
      gdScore,
      linkedSteamId,
      setLinkedSteamId,
      masteryScore,
      masteryXp,
      masteryLevel,
      masteryBreakdown,
      masteryComputedAt,
      recomputeMastery,
      overallMasteryScore,
      overallMasteryXp,
      overallMasteryLevel,
      overallMasteryBreakdown,
      overallMasteryComputedAt,
      recomputeOverallMastery,
      themeMode,
      setThemeMode,
      accentColor,
      setAccentColor,
      accentCustomized,
      setAccentColorExplicit,
      wallpaperUrl,
      setWallpaperUrl,
      currency,
      setCurrency,
      shareActivityWithGuilds,
      setShareActivityWithGuilds,
      readReceiptsEnabled,
      setReadReceiptsEnabled,
      xbxpricesKey,
      setXbxpricesKey,
      platpricesKey,
      setPlatpricesKey,
      toggleThemeMode,

      // wishlist
      wishlist,
      addToWishlist,
      removeFromWishlist,

      // dashfeed
      gameToggles,
      setGameToggles,
      storeToggles,
      setStoreToggles,
      platformToggles,
      setPlatformToggles,
      enabledGames,
      effectivePlatformOrder,
      profileDetails,
      selectedColleges,
      setSelectedColleges,
      updateProfileDetails,

      // layout
      dashboardLayout,
      setDashboardLayout,
      customizingLayout,
      onboardingStep,
      setOnboardingStep,
      setCustomizingLayout,
      platformOrder,
      setPlatformOrder,
      resetLayout,

      // splash
      splashVisible,
      splashFading,
    }),
    [
      view,
      loginMode,
      goTo,
      goBack,
      navigateToSection,
      navigateToView,
      navigateHome,
      handleLoginSuccess,
      handleLogout,
      session,
      isLoggedIn,
      userId,
      actingAsLykodex,
      actAsLykodex,
      returnToMyAccount,
      onlineUserIds,
      xboxLinkStatus,
      xboxLinkResult,
      clearXboxLinkResult,
      steamLinkStatus,
      steamLinkResult,
      clearSteamLinkResult,
      avatarUrl,
      firstName,
      lastName,
      username,
      gdScore,
      linkedSteamId,
      masteryScore,
      masteryXp,
      masteryLevel,
      masteryBreakdown,
      masteryComputedAt,
      recomputeMastery,
      overallMasteryScore,
      overallMasteryXp,
      overallMasteryLevel,
      overallMasteryBreakdown,
      overallMasteryComputedAt,
      recomputeOverallMastery,
      themeMode,
      accentColor,
      accentCustomized,
      setAccentColorExplicit,
      wallpaperUrl,
      currency,
      shareActivityWithGuilds,
      readReceiptsEnabled,
      xbxpricesKey,
      platpricesKey,
      toggleThemeMode,
      wishlist,
      addToWishlist,
      removeFromWishlist,
      gameToggles,
      storeToggles,
      platformToggles,
      enabledGames,
      effectivePlatformOrder,
      profileDetails,
      selectedColleges,
      setSelectedColleges,
      updateProfileDetails,
      dashboardLayout,
      customizingLayout,
      onboardingStep,
      setOnboardingStep,
      platformOrder,
      resetLayout,
      splashVisible,
      splashFading,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
