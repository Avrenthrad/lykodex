// Gaming Collection (file/route still named "Library" internally,
// see navSections.js — user-facing text only was the intended scope
// of the rename that gave this page its real heading) — the real,
// dedicated version of Collections. Applies the stat-card visual
// language from a recent design pass, but only with data Lykodex
// actually has.
//
// Deliberately does NOT include some things a mockup for this page
// showed: a whole-library completion split — our real Backlog system
// only tracks status for games someone explicitly added, not
// automatically for an entire library; and "last played X days ago"
// timestamps — confirmed via Steam's own community forums that the
// field this would need (rtime_last_played) only populates when
// querying with the account owner's own personal API key, not the
// shared server key this project uses for every account. "Most
// Played," sorted by real playtime, is the honest version of that
// same idea.
//
// Xbox/PlayStation DO get a real per-game playtime section now — not
// self-reported, and not a scrape (both were confirmed to have no
// public API for this at all, see AccountLinkingPage.jsx). It's real
// data the Discord presence bot has actually observed: whenever a
// linked friend's Discord Rich Presence shows them playing something
// on Xbox/PlayStation, the bot accumulates minutes per game into
// platform_playtime (see /discord-bot, lib/crossPlatformActivity.js).
// That means it's honestly partial — only covers time played since
// Discord was linked and while Rich Presence was visible, not a full
// historical library — and the UI says so, rather than presenting it
// as equivalent to Steam's complete server-side playtime record.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchOwnedGames, steamHeaderArt } from "../lib/steam";
import { fetchBacklog, addToBacklog } from "../lib/backlog";
import { fetchGameLibrary, mergeLibraryByTitle } from "../lib/gameLibrary";
import { fetchGameLibraryTags, toggleGameLibraryTag } from "../lib/gameLibraryTags";
import { fetchMyRatings, submitRating, fetchAverageRatings } from "../lib/gameRatings";
import { fetchPlatformPlaytime } from "../lib/crossPlatformActivity";
import { importSteamLibrary, importXboxLibrary, importPsnLibrary } from "../lib/libraryImport";
import { fetchLiveGamerscore } from "../lib/xboxOAuth";
import { fetchLiveTrophies } from "../lib/psnAuth";
import { AccountGatePanel } from "./AccountGate";
import { LibraryGameCard, LibraryGameRow, PlatformTag } from "./LibraryGameCard";

const PLATFORM_LABELS = { steam: "Steam", xbox: "Xbox", playstation: "PlayStation" };
const IMPORT_PLATFORMS = [
  { id: "steam", label: "Steam", icon: "/icons/platforms/steam.svg" },
  { id: "xbox", label: "Xbox", icon: "/icons/platforms/xbox.svg" },
  { id: "playstation", label: "PlayStation", icon: "/icons/platforms/playstation.png" },
];
// Nintendo isn't listed here — there's no real library-import source
// for it yet (see AccountLinkingPage.jsx), so a filter option for it
// would only ever show zero games right now.
const FILTER_PLATFORMS = ["steam", "xbox", "playstation"];
const EMPTY_TAG_SET = new Set();

function formatPlaytime(minutes) {
  if (!minutes) return null;
  const hours = Math.round(minutes / 60);
  return hours > 0 ? `${hours.toLocaleString()}h` : "<1h";
}

export default function LibraryPage({
  onBack, isLoggedIn, onSignIn, onCreateAccount, userId,
  linkedSteamId, onGoToLinking, onGoToBacklog, gdScore,
}) {
  const [steamGames, setSteamGames] = useState([]);
  const [backlogCount, setBacklogCount] = useState(null);
  const [backlogTitles, setBacklogTitles] = useState(() => new Set());
  const [steamStatus, setSteamStatus] = useState("idle");
  const [otherPlatformGames, setOtherPlatformGames] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState(() => new Set(FILTER_PLATFORMS));
  const [sortMode, setSortMode] = useState("playtime"); // "playtime" | "recent"
  const [libraryTags, setLibraryTags] = useState(() => new Map());
  const [myRatings, setMyRatings] = useState(() => new Map());
  const [avgRatings, setAvgRatings] = useState(() => new Map());
  const [platformLinked, setPlatformLinked] = useState({
    steam: false,
    xbox: false,
    playstation: false,
  });
  const [importState, setImportState] = useState({});
  const [importMessage, setImportMessage] = useState("");

  const reloadLibraryItems = useCallback(() => {
    if (!userId) return Promise.resolve();
    return fetchGameLibrary(userId)
      .then(setLibraryItems)
      .catch((err) => console.error("Game library fetch failed:", err));
  }, [userId]);

  const reloadBacklog = useCallback(() => {
    if (!userId) return Promise.resolve();
    return fetchBacklog(userId)
      .then((rows) => {
        setBacklogCount(rows.length);
        setBacklogTitles(new Set(rows.map((r) => r.title)));
      })
      .catch((err) => {
        console.error("Backlog fetch failed:", err);
        setBacklogCount(null);
      });
  }, [userId]);

  const reloadLibraryTags = useCallback(() => {
    if (!userId) return Promise.resolve();
    return fetchGameLibraryTags(userId)
      .then(setLibraryTags)
      .catch((err) => console.error("Game library tags fetch failed:", err));
  }, [userId]);

  const reloadMyRatings = useCallback(() => {
    if (!userId) return Promise.resolve();
    return fetchMyRatings(userId)
      .then(setMyRatings)
      .catch((err) => console.error("Game ratings fetch failed:", err));
  }, [userId]);

  useEffect(() => {
    if (!linkedSteamId) {
      setSteamGames([]);
      setSteamStatus("idle");
      return;
    }
    setSteamStatus("loading");

    fetchOwnedGames(linkedSteamId)
      .then((list) => {
        const sorted = [...list].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
        setSteamGames(sorted);
        setSteamStatus("ready");
      })
      .catch((err) => {
        console.error("Library fetch failed:", err);
        setSteamStatus("error");
      });
  }, [linkedSteamId]);

  useEffect(() => {
    reloadBacklog();
  }, [reloadBacklog]);

  useEffect(() => {
    reloadLibraryTags();
  }, [reloadLibraryTags]);

  useEffect(() => {
    reloadMyRatings();
  }, [reloadMyRatings]);

  useEffect(() => {
    if (!userId) return;
    fetchPlatformPlaytime(userId)
      .then((rows) => {
        const sorted = [...rows]
          .filter((r) => r.platform === "xbox" || r.platform === "playstation")
          .sort((a, b) => (b.total_minutes || 0) - (a.total_minutes || 0));
        setOtherPlatformGames(sorted);
      })
      .catch((err) => console.error("Cross-platform playtime fetch failed:", err));
  }, [userId]);

  useEffect(() => {
    reloadLibraryItems();
  }, [reloadLibraryItems]);

  useEffect(() => {
    if (!isLoggedIn) return;
    setPlatformLinked((prev) => ({ ...prev, steam: Boolean(linkedSteamId) }));

    Promise.allSettled([fetchLiveGamerscore(), fetchLiveTrophies()])
      .then(([xboxResult, psnResult]) => {
        setPlatformLinked({
          steam: Boolean(linkedSteamId),
          xbox: xboxResult.status === "fulfilled",
          playstation: psnResult.status === "fulfilled",
        });
      });
  }, [isLoggedIn, linkedSteamId]);

  const unifiedLibrary = useMemo(
    () => mergeLibraryByTitle({
      steamGames,
      libraryItems,
      platformPlaytime: otherPlatformGames,
    }),
    [steamGames, libraryItems, otherPlatformGames]
  );

  // One batched call for every title currently in the collection,
  // rather than one round-trip per row (see lib/gameRatings.js).
  useEffect(() => {
    if (!unifiedLibrary.length) return;
    fetchAverageRatings(unifiedLibrary.map((g) => g.title))
      .then(setAvgRatings)
      .catch((err) => console.error("Average ratings fetch failed:", err));
  }, [unifiedLibrary]);

  const filteredLibrary = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = unifiedLibrary.filter((game) => {
      if (query && !game.title.toLowerCase().includes(query)) return false;
      if (!game.platforms.some((p) => platformFilter.has(p))) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortMode === "recent") {
      // Real: when each title was actually added to Gaming Collection
      // (game_library_items.added_at, via mergeLibraryByTitle). Steam
      // has no purchase-date field to draw on at all (see
      // gameLibrary.js), so undated Steam-only entries sort to the
      // bottom rather than being given a fabricated date.
      sorted.sort((a, b) => {
        const aTime = a.addedAt ? new Date(a.addedAt).getTime() : -Infinity;
        const bTime = b.addedAt ? new Date(b.addedAt).getTime() : -Infinity;
        return bTime - aTime;
      });
    } else {
      sorted.sort((a, b) => b.totalPlaytimeMinutes - a.totalPlaytimeMinutes);
    }
    return sorted;
  }, [searchTerm, unifiedLibrary, platformFilter, sortMode]);

  function togglePlatformFilter(platform) {
    setPlatformFilter((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  const totalGames = unifiedLibrary.length;
  const steamPlaytimeHours = Math.round(
    steamGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0) / 60
  );
  const xboxPlaytimeHours = Math.round(
    otherPlatformGames.filter((r) => r.platform === "xbox").reduce((sum, r) => sum + (r.total_minutes || 0), 0) / 60
  );
  const playstationPlaytimeHours = Math.round(
    otherPlatformGames.filter((r) => r.platform === "playstation").reduce((sum, r) => sum + (r.total_minutes || 0), 0) / 60
  );
  const totalPlaytimeHours = steamPlaytimeHours + xboxPlaytimeHours + playstationPlaytimeHours;

  async function handleImport(platformId) {
    if (!userId) return;
    setImportState((prev) => ({ ...prev, [platformId]: "importing" }));
    setImportMessage("");

    const onProgress = (current, total) => {
      setImportMessage(`Importing ${PLATFORM_LABELS[platformId]}… ${current} of ${total}`);
    };

    try {
      let result;
      if (platformId === "steam") {
        if (!linkedSteamId) throw new Error("Link Steam on Account Linking first.");
        result = await importSteamLibrary(userId, linkedSteamId, onProgress);
      } else if (platformId === "xbox") {
        result = await importXboxLibrary(userId, onProgress);
      } else {
        result = await importPsnLibrary(userId, onProgress);
      }

      await reloadLibraryItems();
      if (platformId === "steam" && linkedSteamId) {
        const list = await fetchOwnedGames(linkedSteamId);
        setSteamGames([...list].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)));
        setSteamStatus("ready");
      }

      setImportState((prev) => ({ ...prev, [platformId]: "done" }));
      setImportMessage(`Added ${result.added} of ${result.total} ${PLATFORM_LABELS[platformId]} games to your collection.`);
    } catch (err) {
      console.error(`${platformId} library import failed:`, err);
      setImportState((prev) => ({ ...prev, [platformId]: "error" }));
      setImportMessage(err.message || "Couldn't import your library right now.");
    }
  }

  async function handleToggleTag(title, tag) {
    if (!userId) return;
    const currentlySet = libraryTags.get(title)?.has(tag) || false;
    // Optimistic — the row toggles immediately rather than waiting on
    // a round-trip, then reconciles with reloadLibraryTags either way.
    setLibraryTags((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(title) || []);
      if (currentlySet) set.delete(tag); else set.add(tag);
      next.set(title, set);
      return next;
    });
    try {
      await toggleGameLibraryTag(userId, title, tag, currentlySet);
    } catch (err) {
      console.error("Failed to toggle game library tag:", err);
      reloadLibraryTags();
    }
  }

  async function handleAddToBacklog(game) {
    if (!userId || backlogTitles.has(game.title)) return;
    try {
      await addToBacklog(userId, game.title, game.steamAppid, game.platforms[0] || null);
      await reloadBacklog();
    } catch (err) {
      console.error("Failed to add to Backlog:", err);
    }
  }

  async function handleSubmitRating(title, value) {
    if (!userId) return;
    setMyRatings((prev) => new Map(prev).set(title, value));
    try {
      await submitRating(userId, title, value);
      const updated = await fetchAverageRatings([title]);
      setAvgRatings((prev) => {
        const next = new Map(prev);
        if (updated.has(title)) next.set(title, updated.get(title));
        return next;
      });
    } catch (err) {
      console.error("Failed to submit rating:", err);
      reloadMyRatings();
    }
  }

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back</button>
        <h1 className="price-page__title">Gaming Collection</h1>
        <p className="price-page__subtitle">Your owned games across Steam, Xbox, and PlayStation — tagged by platform.</p>
      </div>

      {!isLoggedIn && (
        <AccountGatePanel message="Sign in to see your game library." onSignIn={onSignIn} onCreateAccount={onCreateAccount} />
      )}

      {isLoggedIn && (
        <>
          <div className="backlog-summary">
            <div className="panel__stat">
              <span className="panel__stat-value">{totalGames}</span>
              <span className="panel__stat-label">Games</span>
            </div>
            <div className="panel__stat">
              <span className="panel__stat-value">{totalPlaytimeHours.toLocaleString()}h</span>
              <span className="panel__stat-label">Total playtime</span>
              {(xboxPlaytimeHours > 0 || playstationPlaytimeHours > 0 || steamPlaytimeHours > 0) && (
                <span className="panel__stat-sub">
                  {steamPlaytimeHours > 0 ? `${steamPlaytimeHours.toLocaleString()}h Steam` : ""}
                  {xboxPlaytimeHours > 0 ? `${steamPlaytimeHours > 0 ? " · " : ""}${xboxPlaytimeHours.toLocaleString()}h Xbox` : ""}
                  {playstationPlaytimeHours > 0 ? ` · ${playstationPlaytimeHours.toLocaleString()}h PlayStation` : ""}
                </span>
              )}
            </div>
            {backlogCount != null && (
              <div className="panel__stat">
                <span className="panel__stat-value">{backlogCount}</span>
                <span className="panel__stat-label">In Backlog</span>
              </div>
            )}
            <div className="panel__stat">
              <span className="panel__stat-value">{gdScore?.toLocaleString() ?? 0}</span>
              <span className="panel__stat-label">GD Score</span>
            </div>
          </div>

          <div className="backlog-add library-collection-tools">
            <form
              className="price-search"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                className="price-search__input"
                type="text"
                placeholder="Search your library…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button type="submit" className="price-search__button">Search</button>
            </form>

            <div className="library-import-row">
              {IMPORT_PLATFORMS.map((platform) => {
                const linked = platformLinked[platform.id];
                const importing = importState[platform.id] === "importing";
                return (
                  <button
                    key={platform.id}
                    type="button"
                    className="quickdash-reset-btn library-import-btn"
                    disabled={!linked || importing}
                    onClick={() => handleImport(platform.id)}
                    title={linked ? `Import your ${platform.label} library` : `Link ${platform.label} on Account Linking first`}
                  >
                    <img src={platform.icon} alt="" className="library-import-btn__icon" decoding="async" />
                    {importing ? `Importing ${platform.label}…` : `Import ${platform.label} library`}
                  </button>
                );
              })}
            </div>

            {!platformLinked.steam && !platformLinked.xbox && !platformLinked.playstation && (
              <p className="panel__status">
                No platforms linked yet —{" "}
                <button type="button" className="steam-sync-link" onClick={onGoToLinking}>link accounts on Account Linking</button>{" "}
                to import your libraries.
              </p>
            )}

            {importMessage && (
              <p className={`panel__status ${Object.values(importState).includes("error") ? "panel__status--error" : ""}`}>
                {importMessage}
              </p>
            )}
          </div>

          <button type="button" className="quickdash-reset-btn" onClick={onGoToBacklog} style={{ marginTop: "16px" }}>
            View your Backlog / To Be Played →
          </button>
        </>
      )}

      {isLoggedIn && linkedSteamId && steamStatus === "loading" && (
        <p className="panel__status">Loading your Steam library…</p>
      )}
      {isLoggedIn && linkedSteamId && steamStatus === "error" && (
        <p className="panel__status panel__status--error">Couldn't load your Steam library right now.</p>
      )}

      {isLoggedIn && filteredLibrary.length === 0 && unifiedLibrary.length > 0 && (
        <p className="panel__status">
          {searchTerm.trim()
            ? `No games match “${searchTerm.trim()}”.`
            : "No games match the selected platform filter."}
        </p>
      )}

      {isLoggedIn && unifiedLibrary.length === 0 && !searchTerm.trim() && steamStatus !== "loading" && (
        <p className="panel__status">
          Nothing in your collection yet — use the import buttons above, or{" "}
          <button type="button" className="steam-sync-link" onClick={onGoToLinking}>link a platform on Account Linking</button>.
        </p>
      )}

      {isLoggedIn && filteredLibrary.length > 0 && (
        <>
          {!searchTerm.trim() && (
            <div className="library-most-played">
              <span className="feed-col__label">Most Played</span>
              <ul className="backlog-list">
                {filteredLibrary.slice(0, 6).map((game) => (
                  <LibraryGameCard
                    key={game.title}
                    game={game}
                    formatPlaytime={formatPlaytime}
                    steamHeaderArt={steamHeaderArt}
                  />
                ))}
              </ul>
            </div>
          )}

          <div className="library-full-header">
            <span className="feed-col__label">
              {searchTerm.trim() ? `Search results (${filteredLibrary.length})` : `Full Library (${filteredLibrary.length})`}
            </span>
            <div className="library-full-header__controls">
              <div className="backlog-status-tabs">
                <button
                  type="button"
                  className={`quickdash-reset-btn ${sortMode === "playtime" ? "quickdash-reset-btn--active" : ""}`}
                  onClick={() => setSortMode("playtime")}
                >
                  Most Played
                </button>
                <button
                  type="button"
                  className={`quickdash-reset-btn ${sortMode === "recent" ? "quickdash-reset-btn--active" : ""}`}
                  onClick={() => setSortMode("recent")}
                  title="Sorted by when each title was added to Gaming Collection — Steam has no real purchase-date data to sort by, so undated Steam titles sort last."
                >
                  Recently Added
                </button>
              </div>
              <details className="library-platform-filter">
              <summary className="library-platform-filter__summary">
                Platforms{platformFilter.size < FILTER_PLATFORMS.length ? ` (${platformFilter.size})` : ""}
              </summary>
              <ul className="library-platform-filter__list">
                {FILTER_PLATFORMS.map((platform) => (
                  <li key={platform} className="library-platform-filter__option">
                    <label>
                      <input
                        type="checkbox"
                        checked={platformFilter.has(platform)}
                        onChange={() => togglePlatformFilter(platform)}
                      />
                      {PLATFORM_LABELS[platform]}
                    </label>
                  </li>
                ))}
              </ul>
              </details>
            </div>
          </div>
          <table className="library-table">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col">Platforms</th>
                <th scope="col">Playtime</th>
                <th scope="col">Status</th>
                <th scope="col">Rating</th>
              </tr>
            </thead>
            <tbody>
              {filteredLibrary.map((game) => (
                <LibraryGameRow
                  key={game.title}
                  game={game}
                  formatPlaytime={formatPlaytime}
                  tags={libraryTags.get(game.title) || EMPTY_TAG_SET}
                  onToggleTag={(tag) => handleToggleTag(game.title, tag)}
                  inBacklog={backlogTitles.has(game.title)}
                  onAddToBacklog={() => handleAddToBacklog(game)}
                  rating={myRatings.get(game.title) || null}
                  avgRating={avgRatings.get(game.title) || null}
                  onSubmitRating={(value) => handleSubmitRating(game.title, value)}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {isLoggedIn && otherPlatformGames.length > 0 && (
        <div className="library-most-played" style={{ marginTop: "24px" }}>
          <span className="feed-col__label">Recently Active (Xbox &amp; PlayStation)</span>
          <p className="panel__status" style={{ fontSize: "11px", marginBottom: "10px" }}>
            Real playtime observed since you linked Discord — not your full imported library above, just
            what&apos;s actually been played recently.
          </p>
          <ul className="backlog-list">
            {otherPlatformGames.map((g) => (
              <li key={`${g.platform}-${g.game_name}`} className="backlog-card">
                <div className="backlog-card__info">
                  <span className="backlog-card__title">{g.game_name}</span>
                  <span className="backlog-card__meta">
                    <PlatformTag platform={g.platform} /> {formatPlaytime(g.total_minutes)} played
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
