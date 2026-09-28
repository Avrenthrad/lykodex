// Top navigation bar.
// - Left: light/dark theme toggle.
// - Center: the "Lykodex" banner/logo — clicking it goes to Overview.
// - Right: search icon (opens the universal command palette — see
//   CommandPalette.jsx and App.jsx's Ctrl/Cmd+K handler; this icon and
//   that shortcut open the exact same overlay, not two competing
//   search UIs), the notifications bell (real Guild activity), the
//   unified GD Score, and — once signed in — the avatar, which opens
//   ONE consolidated account drawer (Social, Account Settings, Account
//   Linking, Dashfeed Settings, Log out). There used to be a second,
//   separate gear-icon menu here with an overlapping subset of the
//   same destinations — merged into the one avatar drawer below so
//   there's a single place to look, not two.
// - Below the header: the College tabs row (Overview + the 5 Colleges).

import { useEffect, useRef, useState } from "react";
import { isMobileApp } from "../lib/platform";
import { checkIsLykodexDelegate } from "../lib/auth";
import { GAMING_VIEWS, TCG_VIEWS } from "../lib/navSections";
import { tierFromScore } from "../lib/masteryTiers";
import { useApp } from "../hooks/useApp";
import LykodexLogo from "./LykodexLogo";
import CollegeIcon from "./CollegeIcon";
import { fetchRecentActivityForUser, describeActivity, displayName } from "../lib/guilds";
import { fetchMyCelebrations } from "../lib/celebrations";
import {
  fetchFriendRequests,
  fetchFriends,
  acceptFriendRequest,
  declineFriendRequest,
} from "../lib/friends";
import { fetchUnreadCount } from "../lib/messages";
import { relativeTime } from "./price/priceUtils";
import MiniAvatar from "./MiniAvatar";
import UpdateCheckMenuItem from "./UpdateCheckMenuItem";
import DownloadDesktopMenuItem from "./DownloadDesktopMenuItem";
import CommunityQuickLinks from "./CommunityQuickLinks";
import { accountXpFromMastery, levelFromXp } from "../lib/overallMastery";

// Top-level College tabs. Order matters — this is the fixed display
// order regardless of which ones a person actually selected during
// onboarding (filtering happens where this is rendered, not here).
// Overview always leads — it's not a College, but it's the one place
// that summarizes across all of them, so it belongs in the same row.
const COLLEGES = [
  { id: "overview", label: "Overview", view: "overview", alwaysShown: true },
  { id: "gaming", label: "Gaming", view: "dashboard" },
  { id: "tcg", label: "TCG", view: "tcg-home" },
  { id: "entertainment", label: "Library", view: "college-entertainment" },
  { id: "collectibles", label: "Loot", view: "college-collectibles" },
  { id: "tabletop", label: "Wartable", view: "college-tabletop" },
];

// The 5 real Colleges the Mastery Score dropdown breaks down by —
// same set as COLLEGES minus the "Overview" pseudo-entry. (Social, from
// Discord voice time, is rendered separately below — it has no tab.)
const MASTERY_COLLEGES = COLLEGES.filter((c) => c.id !== "overview");

function collegeMasteryMeta(entry) {
  if (!entry) return null;
  const xp = accountXpFromMastery(entry.normalized);
  const { level } = levelFromXp(xp);
  return { level, xp };
}

function DefaultAvatarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7v1H4v-1z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function ChevronIcon({ direction = "left" }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M3 6l9 7 9-7" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export default function Header({
  onNavigateView,
  onNavigateHome,
  isLoggedIn,
  avatarUrl,
  overallMasteryScore = 0,
  overallMasteryXp = 0,
  overallMasteryLevel = 0,
  overallMasteryBreakdown = [],
  overallMasteryComputedAt,
  onRecomputeOverallMastery,
  onLogout,
  mode,
  onToggleMode,
  currentView,
  selectedColleges = ["gaming"],
  userId,
  onOpenPalette,
}) {
  // "settings" | "login" | "avatar" | null — only one open at a time.
  // "logo" (the old Dashboards drawer trigger) is gone — the logo now
  // just navigates straight to Overview, and the College tabs replace
  // what that drawer used to list.
  const [openMenu, setOpenMenu] = useState(null);
  const [recomputingMastery, setRecomputingMastery] = useState(false);
  const masteryTier = tierFromScore(overallMasteryScore);
  // Tracks a broken/failed avatar image load so we fall back to the
  // default icon instead of showing a broken-image glyph. Reset
  // whenever the URL itself changes (new upload, re-hydrate) so a
  // fresh URL always gets a real chance to load.
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => {
    setAvatarBroken(false);
  }, [avatarUrl]);

  const { actingAsLykodex, actAsLykodex, returnToMyAccount, profileDetails } = useApp();
  const [isLykodexDelegate, setIsLykodexDelegate] = useState(false);
  const [lykodexToggleStatus, setLykodexToggleStatus] = useState("idle"); // idle | working | error

  useEffect(() => {
    if (!isLoggedIn) {
      setIsLykodexDelegate(false);
      return;
    }
    checkIsLykodexDelegate().then(setIsLykodexDelegate);
  }, [isLoggedIn, actingAsLykodex]);

  const showLykodexPersonaToggle = isLoggedIn && (isLykodexDelegate || actingAsLykodex);

  async function handleLykodexPersonaToggle() {
    setLykodexToggleStatus("working");
    try {
      if (actingAsLykodex) await returnToMyAccount();
      else await actAsLykodex();
      setLykodexToggleStatus("idle");
    } catch (err) {
      console.error("Failed to toggle Lykodex persona:", err);
      setLykodexToggleStatus("error");
    }
  }

  // ----- notifications bell -----
  // Two genuinely different feeds, never mixed into one list: your own
  // celebratory milestones (100% achievements, finishing a backlog
  // game — see CELEBRATORY_EVENT_TYPES), and real activity from
  // friends/guildmates (never your own routine actions — see
  // fetchRecentActivityForUser's own comment for why).
  const [activity, setActivity] = useState([]);
  const [activityStatus, setActivityStatus] = useState("idle"); // idle | loading | ready | error
  const [celebrations, setCelebrations] = useState([]);
  const [celebrationsStatus, setCelebrationsStatus] = useState("idle");
  // Incoming friend requests — the one notification that needs an
  // action right in the bell (Accept/Decline), not just something to
  // read, so it's tracked separately from the passive activity feed.
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendRequestsReloadKey, setFriendRequestsReloadKey] = useState(0);
  const [friends, setFriends] = useState([]);
  const lastSeenRef = useRef(
    typeof window !== "undefined" ? localStorage.getItem("gd-activity-last-seen") : null
  );

  const notificationsOpen = openMenu === "notifications";
  useEffect(() => {
    if (!isLoggedIn || !userId) {
      setActivity([]);
      setActivityStatus("idle");
      setCelebrations([]);
      setCelebrationsStatus("idle");
      setFriendRequests([]);
      setFriends([]);
      return;
    }
    let cancelled = false;
    setActivityStatus("loading");
    fetchRecentActivityForUser(userId, 8)
      .then((rows) => {
        if (cancelled) return;
        setActivity(rows);
        setActivityStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load activity for notifications bell:", err);
        if (!cancelled) setActivityStatus("error");
      });

    setCelebrationsStatus("loading");
    fetchMyCelebrations(userId, 5)
      .then((rows) => {
        if (cancelled) return;
        setCelebrations(rows);
        setCelebrationsStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load celebrations for notifications bell:", err);
        if (!cancelled) setCelebrationsStatus("error");
      });

    fetchFriendRequests(userId)
      .then((rows) => {
        if (cancelled) return;
        setFriendRequests(rows.filter((r) => r.receiver_id === userId));
      })
      .catch((err) => console.error("Failed to load friend requests for notifications bell:", err));

    fetchFriends(userId)
      .then((rows) => {
        if (!cancelled) setFriends(rows);
      })
      .catch((err) => console.error("Failed to load friends for account drawer:", err));

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userId, notificationsOpen, friendRequestsReloadKey]);

  function handleBellAcceptFriend(requestId) {
    acceptFriendRequest(requestId)
      .then(() => setFriendRequestsReloadKey((k) => k + 1))
      .catch((err) => console.error("Failed to accept friend request:", err));
  }

  function handleBellDeclineFriend(requestId) {
    declineFriendRequest(requestId)
      .then(() => setFriendRequestsReloadKey((k) => k + 1))
      .catch((err) => console.error("Failed to decline friend request:", err));
  }

  // ----- Inbox unread count — the one interval-polled query in this
  // app. Everything else here is poll-on-mount/on-demand, but DM
  // staleness is directly user-visible (a friend can message you while
  // you're elsewhere in the app with no natural "next visit" moment to
  // refetch on), so a light, cheap count-only poll is worth the
  // exception. Thread contents and the Inbox list itself stay
  // poll-on-mount only — see InboxPage.jsx.
  const [unreadDmCount, setUnreadDmCount] = useState(0);
  useEffect(() => {
    if (!isLoggedIn || !userId) {
      setUnreadDmCount(0);
      return;
    }
    let cancelled = false;
    function loadUnread() {
      fetchUnreadCount(userId)
        .then((count) => {
          if (!cancelled) setUnreadDmCount(count);
        })
        .catch((err) => console.error("Failed to load Inbox unread count:", err));
    }
    loadUnread();
    const interval = setInterval(loadUnread, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoggedIn, userId]);

  // Latest timestamp across BOTH feeds — celebrations use "completedAt",
  // guild/friend activity uses "created_at", so this normalizes before
  // comparing.
  const latestNotificationAt = [
    activity[0]?.created_at,
    celebrations[0]?.completedAt,
    friendRequests[0]?.created_at,
  ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];

  const hasUnseenActivity =
    Boolean(latestNotificationAt) &&
    (!lastSeenRef.current || new Date(latestNotificationAt) > new Date(lastSeenRef.current));

  function toggleMenu(name) {
    const next = openMenu === name ? null : name;
    setOpenMenu(next);
    if (name === "notifications" && next === "notifications" && latestNotificationAt) {
      lastSeenRef.current = latestNotificationAt;
      try {
        localStorage.setItem("gd-activity-last-seen", latestNotificationAt);
      } catch {
        /* ignore */
      }
    }
  }

  function closeMenu() {
    setOpenMenu(null);
  }

  function handleAccountClick(viewId, mode) {
    closeMenu();
    onNavigateView(viewId, mode);
  }

  async function handleRecomputeOverallMastery() {
    if (!onRecomputeOverallMastery) return;
    setRecomputingMastery(true);
    await onRecomputeOverallMastery();
    setRecomputingMastery(false);
  }

  const showBackdrop = openMenu === "settings";

  const activeCollegeId =
    currentView === "overview"
      ? "overview"
      : GAMING_VIEWS.includes(currentView)
      ? "gaming"
      : TCG_VIEWS.includes(currentView)
      ? "tcg"
      : currentView === "college-entertainment" || currentView === "books" || currentView === "comics"
      ? "entertainment"
      : currentView === "college-collectibles"
      ? "collectibles"
      : currentView === "college-tabletop"
      ? "tabletop"
      : null;

  return (
    <>
      <header className="dash-header">
        <div className="dash-header__inner">
        <div className="dash-header__left-group">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleMode}
            aria-label="Toggle light/dark mode"
            aria-pressed={mode === "light"}
            title={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            <span className="theme-toggle__track">
              <span className="theme-toggle__thumb">
                {mode === "light" ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v3M12 20v3M23 12h-3M4 12H1M20.5 3.5l-2 2M5.5 18.5l-2 2M20.5 20.5l-2-2M5.5 5.5l-2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                    <path d="M21 12.5A9 9 0 1 1 11.5 3a7 7 0 0 0 9.5 9.5z" />
                  </svg>
                )}
              </span>
            </span>
          </button>

          {showLykodexPersonaToggle && (
            <button
              type="button"
              className="lykodex-persona-toggle"
              onClick={handleLykodexPersonaToggle}
              disabled={lykodexToggleStatus === "working"}
              aria-pressed={actingAsLykodex}
              aria-label={actingAsLykodex ? "Return to my account" : "Act as Lykodex system account"}
              title={
                lykodexToggleStatus === "working"
                  ? "Switching account…"
                  : actingAsLykodex
                    ? "Return to my account"
                    : "Act as Lykodex"
              }
            >
              <span className="lykodex-persona-toggle__track">
                <span className="lykodex-persona-toggle__thumb">
                  <LykodexLogo className="lykodex-persona-toggle__mark" alt="" />
                </span>
              </span>
              <span className="lykodex-persona-toggle__label">
                {lykodexToggleStatus === "working" ? "…" : actingAsLykodex ? "Lykodex" : "Me"}
              </span>
            </button>
          )}

          </div>

          <div className="dash-header__center">
            <button type="button" className="dash-header__banner" onClick={onNavigateHome}>
              <LykodexLogo className="dash-header__banner-mark" />
              <span className="dash-header__banner-text">Lykodex</span>
            </button>

          <span className="alpha-badge">
            <span className="alpha-badge__title">Alpha</span>
            <span className="alpha-badge__subtitle">Early access use only</span>
          </span>
        </div>

        <div className="dash-header__right">
          <button
            type="button"
            className="dash-header__icon-btn"
            onClick={onOpenPalette}
            aria-label="Search Lykodex (Ctrl/Cmd+K)"
            title="Search (Ctrl/Cmd+K)"
          >
            <SearchIcon />
          </button>

          {isLoggedIn && (
            <button
              type="button"
              className="dash-header__icon-btn"
              onClick={() => handleAccountClick("inbox")}
              aria-label="Inbox"
              title="Inbox"
            >
              <InboxIcon />
              {unreadDmCount > 0 && <span className="dash-header__icon-dot" aria-hidden="true" />}
            </button>
          )}

          {isLoggedIn && (
            <div className="dash-header__menu-wrap">
              <button
                type="button"
                className="dash-header__icon-btn"
                onClick={() => toggleMenu("notifications")}
                aria-expanded={openMenu === "notifications"}
                aria-label="Notifications"
              >
                <BellIcon />
                {hasUnseenActivity && <span className="dash-header__icon-dot" aria-hidden="true" />}
              </button>

              {openMenu === "notifications" && (
                <div className="dash-header__popover dash-header__popover--right dash-header__notifications-popover">
                  {friendRequests.length > 0 && (
                    <>
                      <span className="dash-header__notifications-title">Friend requests</span>
                      {friendRequests.map((r) => (
                        <div key={r.id} className="dash-header__notification-row dash-header__friend-request-row">
                          <MiniAvatar profile={r.senderProfile} />
                          <div className="dash-header__friend-request-body">
                            <span className="dash-header__notification-text">
                              <strong>{displayName(r.senderProfile)}</strong>
                              <br />
                              Sent you a friend request.
                            </span>
                            <span className="dash-header__notification-actions" style={{ display: "flex", gap: "6px" }}>
                              <button type="button" className="linking-row__connect" onClick={() => handleBellAcceptFriend(r.id)}>
                                Accept
                              </button>
                              <button type="button" className="quickdash-reset-btn" onClick={() => handleBellDeclineFriend(r.id)}>
                                Decline
                              </button>
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {celebrationsStatus === "ready" && celebrations.length > 0 && (
                    <>
                      <span className="dash-header__notifications-title">Your celebrations</span>
                      {celebrations.map((entry) => (
                        <div key={entry.id} className="dash-header__notification-row">
                          <span className="dash-header__notification-text" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span aria-hidden="true">🏆</span>
                            {entry.type === "game_completed" ? `Hit 100% achievements in ${entry.title}` : `Finished ${entry.title}`}
                          </span>
                          <span className="dash-header__notification-meta">{relativeTime(entry.completedAt)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  <span className="dash-header__notifications-title">Friends &amp; Guilds</span>
                  {activityStatus === "loading" ? (
                    <p className="dash-header__search-empty">Loading…</p>
                  ) : activity.length > 0 ? (
                    activity.map((entry) => (
                      <div key={entry.id} className="dash-header__notification-row">
                        <span className="dash-header__notification-text" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <MiniAvatar profile={entry.profile} />
                          <strong>{displayName(entry.profile)}</strong> {describeActivity(entry)}
                        </span>
                        <span className="dash-header__notification-meta">
                          {entry.guilds?.name ? `${entry.guilds.name} · ` : ""}
                          {relativeTime(entry.created_at)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="dash-header__empty-state">
                      <span className="dash-header__empty-state-icon" aria-hidden="true">
                        <BellIcon />
                      </span>
                      <p>No activity yet — add a friend or join a Guild to see real updates from your crew here.</p>
                      <button
                        type="button"
                        className="dash-header__popover-item dash-header__empty-state-cta"
                        onClick={() => handleAccountClick("guilds")}
                      >
                        Explore Guilds
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isLoggedIn ? (
            <div className="dash-header__menu-wrap">
              <button
                type="button"
                className="dash-header__score dash-header__score--interactive"
                onClick={() => toggleMenu("mastery")}
                aria-expanded={openMenu === "mastery"}
                title="Mastery Score — combines a real score from each College"
              >
                <span className="dash-header__score-label">Mastery Score</span>
                <div className="dash-header__score-meta">
                  <span className="dash-header__score-level">Lvl {overallMasteryLevel || 0}</span>
                  <span className="dash-header__score-value">
                    {Math.round(overallMasteryScore).toLocaleString()}
                  </span>
                </div>
              </button>

              {openMenu === "mastery" && (
                <div className="dash-header__popover dash-header__popover--right dash-header__mastery-popover">
                  <div className="dash-header__mastery-total">
                    <span className="dash-header__mastery-total-value">
                      {Math.round(overallMasteryScore).toLocaleString()}
                    </span>
                    <div className="dash-header__mastery-total-meta">
                      <span>Level {overallMasteryLevel || 0}</span>
                      <span>{Math.round(overallMasteryXp || 0).toLocaleString()} XP</span>
                      <span
                        className="tag tag--platform"
                        style={{ color: masteryTier.color, borderColor: masteryTier.color }}
                      >
                        {masteryTier.label}
                      </span>
                    </div>
                  </div>

                  <div className="dash-header__mastery-breakdown">
                    {MASTERY_COLLEGES.map((c) => {
                      const entry = overallMasteryBreakdown.find((b) => b.college === c.id);
                      const meta = collegeMasteryMeta(entry);
                      return (
                        <div key={c.id} className="dash-header__mastery-row">
                          <CollegeIcon collegeId={c.id} size={16} />
                          <span className="dash-header__mastery-row-label">{c.label}</span>
                          <span className="dash-header__mastery-row-stats">
                            {meta ? (
                              <>
                                <span className="dash-header__mastery-row-level">Lvl {meta.level}</span>
                                <span className="dash-header__mastery-row-xp">{meta.xp.toLocaleString()} XP</span>
                              </>
                            ) : (
                              <span className="dash-header__mastery-row-empty">—</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {/* Social isn't a nav College — it only exists as
                        voice chat time from the Discord bot (opt-in), so
                        it's shown only once someone actually has some. */}
                    {(() => {
                      const meta = collegeMasteryMeta(overallMasteryBreakdown.find((b) => b.college === "social"));
                      if (!meta) return null;
                      return (
                        <div className="dash-header__mastery-row">
                          <span aria-hidden="true" style={{ width: 16, textAlign: "center", fontSize: 13 }}>🎙️</span>
                          <span className="dash-header__mastery-row-label">Social</span>
                          <span className="dash-header__mastery-row-stats">
                            <span className="dash-header__mastery-row-level">Lvl {meta.level}</span>
                            <span className="dash-header__mastery-row-xp">{meta.xp.toLocaleString()} XP</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {overallMasteryBreakdown.length === 0 && (
                    <p className="dash-header__search-empty">
                      Nothing tracked yet — add real progress in any College to start building this.
                    </p>
                  )}

                  {overallMasteryComputedAt && (
                    <p className="dash-header__search-empty">Last computed {relativeTime(overallMasteryComputedAt)}.</p>
                  )}

                  <button
                    type="button"
                    className="dash-header__popover-item"
                    onClick={handleRecomputeOverallMastery}
                    disabled={recomputingMastery}
                  >
                    {recomputingMastery ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="dash-header__score" title="Sign in to build your Mastery Score">
              <span className="dash-header__score-label">Mastery Score</span>
              <span className="dash-header__score-value">--</span>
            </div>
          )}

          {isLoggedIn ? (
            <div className="dash-header__menu-wrap dash-header__auth">
              <button
                type="button"
                className="dash-header__avatar-btn"
                onClick={() => toggleMenu("settings")}
                aria-expanded={openMenu === "settings"}
                aria-label="Account menu"
              >
                {avatarUrl && !avatarBroken ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="dash-header__avatar-img"
                    decoding="async"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <span className="dash-header__avatar-default">
                    <DefaultAvatarIcon />
                  </span>
                )}
              </button>
            </div>
          ) : (
            <div className="dash-header__menu-wrap dash-header__auth">
              <button
                type="button"
                className="dash-header__login-btn"
                onClick={() => toggleMenu("login")}
                aria-expanded={openMenu === "login"}
              >
                Login
              </button>

              {openMenu === "login" && (
                <div className="dash-header__popover dash-header__popover--right">
                  <button
                    type="button"
                    className="dash-header__popover-item"
                    onClick={() => handleAccountClick("login", "login")}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className="dash-header__popover-item"
                    onClick={() => handleAccountClick("login", "signup")}
                  >
                    New account
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
        </div>
      </header>

      {/* College tabs — filtered to what the person actually selected
          during onboarding (defaults to just Gaming). Guilds is
          deliberately not a tab here — it's a cross-cutting social
          feature, not a College, reachable from the avatar menu below
          instead. */}
      <nav className="college-tabs" aria-label="Colleges">
        {/* Guests haven't been through onboarding, so they never had
            a chance to pick which Colleges they care about — showing
            only their (default, single-College) preference would trap
            them on Gaming with no way out. Everyone gets all 5 tabs to
            browse until they're actually logged in and have a real
            preference to respect. */}
        {(isLoggedIn
          ? COLLEGES.filter((c) => c.alwaysShown || selectedColleges.includes(c.id))
          : COLLEGES
        ).map((c) => (
          <button
            key={c.id}
            type="button"
            className={`college-tabs__item ${activeCollegeId === c.id ? "college-tabs__item--active" : ""}`}
            onClick={() => onNavigateView(c.view)}
          >
            {c.id !== "overview" && (
              <CollegeIcon collegeId={c.id} size={16} active={activeCollegeId === c.id} />
            )}
            {c.label}
          </button>
        ))}
      </nav>

      {/* Packaged mobile only — desktop web and Tauri use the top College
          tabs row (or the account drawer on narrow viewports). */}
      {isMobileApp() && (
      <nav className="mobile-tab-bar" aria-label="Primary">
        <button
          type="button"
          className={`mobile-tab-bar__item ${activeCollegeId === "overview" ? "mobile-tab-bar__item--active" : ""}`}
          onClick={() => onNavigateView("overview")}
        >
          <HomeIcon />
          <span>Home</span>
        </button>
        <button
          type="button"
          className={`mobile-tab-bar__item ${openMenu === "settings" ? "mobile-tab-bar__item--active" : ""}`}
          onClick={() => toggleMenu("settings")}
        >
          <GridIcon />
          <span>Colleges</span>
        </button>
      </nav>
      )}

      {/* Rendered OUTSIDE <header> deliberately — the header has
          backdrop-filter for the floating/blurred sticky look, and
          filter/backdrop-filter on an ancestor creates a new
          containing block for position:fixed descendants. With the
          drawers nested inside <header>, "fixed" was resolving
          relative to the header's own (short) box instead of the
          viewport, squashing the drawer into a tiny scrollable box.
          Keeping them as siblings avoids that entirely. */}
      {showBackdrop && <div className="dash-drawer-backdrop" onClick={closeMenu} />}

      {isLoggedIn && openMenu !== "settings" && (
        <button
          type="button"
          className="dash-rail-toggle dash-rail-toggle--right"
          onClick={() => toggleMenu("settings")}
          aria-label="Open account menu"
          title="Account menu"
        >
          <ChevronIcon direction="left" />
        </button>
      )}

      {openMenu === "settings" && (
        <div className="dash-drawer dash-drawer--right">
          <button
            type="button"
            className="dash-drawer__edge-toggle"
            onClick={closeMenu}
            aria-label="Hide account menu"
            title="Hide menu"
          >
            <ChevronIcon direction="right" />
          </button>
          <div className="dash-drawer__head">
            <span className="dash-drawer__title">Account</span>
            <button type="button" className="dash-drawer__close" onClick={closeMenu} aria-label="Close menu">
              <CloseIcon />
            </button>
          </div>
          <div className="dash-drawer__list">
            <span className="dash-drawer__section-label drawer-mobile-only">Colleges</span>
            <div className="dash-drawer__college-grid drawer-mobile-only">
              {(isLoggedIn
                ? COLLEGES.filter((c) => c.alwaysShown || selectedColleges.includes(c.id))
                : COLLEGES
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`dash-drawer__college-item ${activeCollegeId === c.id ? "dash-drawer__college-item--active" : ""}`}
                  onClick={() => handleAccountClick(c.view)}
                >
                  {c.id !== "overview" && <CollegeIcon collegeId={c.id} size={18} active={activeCollegeId === c.id} />}
                  {c.label}
                </button>
              ))}
            </div>

            {isLoggedIn && (
              <>
                {friendRequests.length > 0 && (
                  <>
                    <span className="dash-drawer__section-label drawer-mobile-only">Friend requests</span>
                    <div className="dash-drawer__notifications-mobile drawer-mobile-only">
                      {friendRequests.map((r) => (
                        <div key={r.id} className="dash-header__notification-row dash-header__friend-request-row">
                          <MiniAvatar profile={r.senderProfile} />
                          <div className="dash-header__friend-request-body">
                            <span className="dash-header__notification-text">
                              <strong>{displayName(r.senderProfile)}</strong>
                              <br />
                              Sent you a friend request.
                            </span>
                            <span className="dash-header__notification-actions" style={{ display: "flex", gap: "6px" }}>
                              <button type="button" className="linking-row__connect" onClick={() => handleBellAcceptFriend(r.id)}>
                                Accept
                              </button>
                              <button type="button" className="quickdash-reset-btn" onClick={() => handleBellDeclineFriend(r.id)}>
                                Decline
                              </button>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {celebrations.length > 0 && (
                  <>
                    <span className="dash-drawer__section-label drawer-mobile-only">Your celebrations</span>
                    <div className="dash-drawer__notifications-mobile drawer-mobile-only">
                      {celebrations.slice(0, 4).map((entry) => (
                        <div key={entry.id} className="dash-header__notification-row">
                          <span className="dash-header__notification-text" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span aria-hidden="true">🏆</span>
                            {entry.type === "game_completed" ? `Hit 100% achievements in ${entry.title}` : `Finished ${entry.title}`}
                          </span>
                          <span className="dash-header__notification-meta">{relativeTime(entry.completedAt)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

              </>
            )}

            <span className="dash-drawer__section-label drawer-mobile-only">Friends</span>
            {isLoggedIn && friends.length > 0 && (
              <div className="dash-drawer__friend-avatars drawer-mobile-only">
                {friends.map((f) => (
                  <button
                    key={f.friend_id}
                    type="button"
                    className="dash-drawer__friend-avatar"
                    aria-label={displayName(f.profile)}
                    onClick={() => handleAccountClick("friends")}
                  >
                    <MiniAvatar profile={f.profile} />
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="dash-drawer__item"
              onClick={() => handleAccountClick("guilds")}
            >
              Guilds
            </button>
            <button
              type="button"
              className="dash-drawer__item"
              onClick={() => handleAccountClick("friends")}
            >
              Friends
            </button>

            {isLoggedIn ? (
              <>
                <span className="dash-drawer__section-label">Account</span>
                <button
                  type="button"
                  className="dash-drawer__item"
                  onClick={() => handleAccountClick("settings")}
                >
                  Account Settings
                </button>
                <button
                  type="button"
                  className="dash-drawer__item"
                  onClick={() => handleAccountClick("linking")}
                >
                  Account Linking
                </button>
                <button
                  type="button"
                  className="dash-drawer__item"
                  onClick={() => handleAccountClick("dashfeed")}
                >
                  Dashfeed Settings
                </button>

                <CommunityQuickLinks profileDetails={profileDetails} />

                <div className="dash-drawer__divider" />
                <button
                  type="button"
                  className="dash-drawer__item dash-drawer__item--danger"
                  onClick={() => {
                    closeMenu();
                    onLogout();
                  }}
                >
                  Log out
                </button>
                <DownloadDesktopMenuItem />
              </>
            ) : (
              <>
                <span className="dash-drawer__section-label">Account</span>
                <button
                  type="button"
                  className="dash-drawer__item"
                  onClick={() => handleAccountClick("login", "login")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className="dash-drawer__item"
                  onClick={() => handleAccountClick("login", "signup")}
                >
                  Create account
                </button>
              </>
            )}

            <UpdateCheckMenuItem />
          </div>
        </div>
      )}
    </>
  );
}
