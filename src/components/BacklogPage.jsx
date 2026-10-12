// Backlog / To Be Played — a dedicated page linked from Collections.
//
// Real data throughout except one explicitly self-reported field (see
// lib/backlog.js and schema.sql for why "length" can't come from a
// real API — HowLongToBeat has never published one, and this project
// doesn't use unofficial scrapers of it, the same line held for PSN
// trophies and Xbox achievements elsewhere in this app).
//
// Status tracking (Backlog/Playing/Completed/Dropped) and the
// "Surprise me" picker are both grounded in real research, not just
// assumed: every competitor backlog tracker uses the same 4-state
// model, and "choice paralysis" — not knowing what to play next — is
// one of the most consistently repeated complaints across gaming
// communities. Kept deliberately lightweight and dismissible rather
// than a demanding checklist — research also surfaced real pushback
// against backlog tracking that feels like pressure instead of fun.

import { useEffect, useState } from "react";
import { searchSteamGames } from "../lib/steam";
import SteamArt from "./SteamArt";
import { searchRawgGamesAndDlc } from "../lib/rawg";
import { logActivityForUser } from "../lib/guilds";
import {
  fetchBacklog,
  addToBacklog,
  removeFromBacklog,
  setHoursEstimate,
  setBacklogStatus,
  enrichBacklogItem,
  recordBacklogCompletionIfNew,
  STATUSES,
  STATUS_LABELS,
} from "../lib/backlog";

const SORT_OPTIONS = [
  { value: "rating", label: "Rating" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "releaseDate", label: "Release date" },
  { value: "length", label: "Length" },
];

const FILTER_OPTIONS = ["all", ...STATUSES];

export default function BacklogPage({ onBack, userId, linkedSteamId }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading"); // page load state: loading | ready | error
  const [sortBy, setSortBy] = useState("rating");
  const [statusFilter, setStatusFilter] = useState("backlog");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [platformByResult, setPlatformByResult] = useState({}); // rawgId -> chosen platform
  const [addingId, setAddingId] = useState(null);

  const [surpriseItem, setSurpriseItem] = useState(null);

  async function loadBacklog() {
    setStatus("loading");
    try {
      const rows = await fetchBacklog(userId);
      const enriched = await Promise.all(rows.map((r) => enrichBacklogItem(r, linkedSteamId)));
      setItems(enriched);
      setStatus("ready");
    } catch (err) {
      console.error("Backlog load failed:", err);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (userId) loadBacklog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Real per-game platform list via RAWG (lib/rawg.js) — Steam's own
  // search only ever finds Steam titles and misses anything console-
  // exclusive, which is exactly what "add from any platform" needs.
  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchRawgGamesAndDlc(
        searchTerm.trim(),
        items.map((item) => item.title)
      );
      if (results === "no_key") {
        setSearchError("Platform search isn't configured yet.");
        setSearchResults([]);
        return;
      }
      setSearchResults(results);
      setPlatformByResult(
        Object.fromEntries(results.map((r) => [r.id, r.platforms[0] || ""]))
      );
    } catch (err) {
      console.error("Backlog search failed:", err);
      setSearchError("Couldn't search right now.");
    } finally {
      setSearching(false);
    }
  }

  // Real appid only attempted for a PC add — RAWG doesn't carry a
  // Steam appid itself, and resolving one for a console platform would
  // be meaningless (achievement enrichment below is Steam-only). Best-
  // effort name match against Steam's own search, same trust level
  // already used for CheapShark's title-search fallback elsewhere.
  async function handleAdd(result) {
    const platform = platformByResult[result.id] || null;
    setAddingId(result.id);
    try {
      let steamAppid = null;
      if (platform?.toLowerCase().includes("pc")) {
        try {
          const matches = await searchSteamGames(result.name);
          steamAppid = matches[0]?.id || null;
        } catch {
          // No Steam match found — still add with the real platform, just no enrichment.
        }
      }
      await addToBacklog(userId, result.name, steamAppid, platform, result.parentTitle || null);
      setSearchResults((prev) => prev.filter((r) => r.id !== result.id));
      loadBacklog();
    } catch (err) {
      console.error("Failed to add to backlog:", err);
    } finally {
      setAddingId(null);
    }
  }

  async function handleRemove(itemId) {
    try {
      await removeFromBacklog(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err) {
      console.error("Failed to remove backlog item:", err);
    }
  }

  async function handleHoursChange(itemId, value) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, hours_estimate: value } : i)));
    try {
      await setHoursEstimate(itemId, value);
    } catch (err) {
      console.error("Failed to save hours estimate:", err);
    }
  }

  async function handleStatusChange(itemId, newStatus) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: newStatus } : i)));
    try {
      await setBacklogStatus(itemId, newStatus);
      const item = items.find((i) => i.id === itemId);
      if (item) {
        logActivityForUser(userId, "backlog_status_change", {
          title: `${item.title} → ${STATUS_LABELS[newStatus]}`,
        });
        // Separate from the ordinary status-change log above — this is
        // the celebratory "finished a game" event (see
        // recordBacklogCompletionIfNew), only fired the first time this
        // item ever reaches "completed", not on every status change.
        if (newStatus === "completed") {
          recordBacklogCompletionIfNew(userId, { backlogItemId: itemId, title: item.title });
        }
      }
    } catch (err) {
      console.error("Failed to save status:", err);
    }
  }

  function handleSurpriseMe() {
    const candidates = items.filter((i) => (i.status || "backlog") === "backlog");
    if (candidates.length === 0) {
      setSurpriseItem(null);
      return;
    }
    setSurpriseItem(candidates[Math.floor(Math.random() * candidates.length)]);
  }

  const filteredItems = statusFilter === "all"
    ? items
    : items.filter((i) => (i.status || "backlog") === statusFilter);

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortBy === "alphabetical") return a.title.localeCompare(b.title);
    if (sortBy === "rating") return (b.metacriticScore ?? -1) - (a.metacriticScore ?? -1);
    if (sortBy === "releaseDate") return (b.releaseDate ? new Date(b.releaseDate) : 0) - (a.releaseDate ? new Date(a.releaseDate) : 0);
    if (sortBy === "length") return (b.hours_estimate ?? -1) - (a.hours_estimate ?? -1);
    return 0;
  });

  const totalAchievements = items.reduce((sum, i) => sum + (i.totalAchievements || 0), 0);
  const totalEstimatedHours = items.reduce((sum, i) => sum + (Number(i.hours_estimate) || 0), 0);
  const itemsWithEstimate = items.filter((i) => i.hours_estimate != null).length;
  const backlogCount = items.filter((i) => (i.status || "backlog") === "backlog").length;

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Gaming</button>
        <h1 className="price-page__title">Backlog / To Be Played</h1>
        <p className="price-page__subtitle">
          Ratings, release dates, and achievements — plus your own estimate for how long each game takes.
        </p>
      </div>

      {status === "ready" && (
        <div className="backlog-summary">
          <div className="panel__stat">
            <span className="panel__stat-value">{items.length}</span>
            <span className="panel__stat-label">Games</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value">{totalAchievements.toLocaleString()}</span>
            <span className="panel__stat-label">Achievements available</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value">{totalEstimatedHours.toLocaleString()}h</span>
            <span className="panel__stat-label">
              Est. hours {itemsWithEstimate < items.length && itemsWithEstimate > 0 ? `(${itemsWithEstimate} of ${items.length} reported)` : ""}
            </span>
          </div>
        </div>
      )}

      {status === "ready" && backlogCount > 0 && (
        <div className="surprise-me">
          <button type="button" className="price-search__button" onClick={handleSurpriseMe}>
            🎲 What should I play next?
          </button>
          {surpriseItem && (
            <div className="surprise-me__result">
              {(surpriseItem.steam_appid || surpriseItem.thumb) && (
                <SteamArt
                  appid={surpriseItem.steam_appid}
                  headerImage={surpriseItem.thumb}
                  className="surprise-me__art"
                  alt=""
                />
              )}
              <span className="surprise-me__title">{surpriseItem.title}</span>
              <button
                type="button"
                className="quickdash-reset-btn"
                onClick={() => handleStatusChange(surpriseItem.id, "playing")}
              >
                Start playing
              </button>
              <button type="button" className="quickdash-reset-btn" onClick={handleSurpriseMe}>
                Pick again
              </button>
              <button type="button" className="game-popup__close" onClick={() => setSurpriseItem(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
        </div>
      )}

      <div className="backlog-add">
        <form className="price-search" onSubmit={handleSearch}>
          <input
            className="price-search__input"
            type="text"
            placeholder="Search a game or DLC to add…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button type="submit" className="price-search__button" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {searchError && <p className="panel__status panel__status--error">{searchError}</p>}

        {searchResults.length > 0 && (
          <ul className="backlog-search-results">
            {searchResults.map((r) => (
              <li key={r.id} className="backlog-search-results__row">
                {r.backgroundImage && <img src={r.backgroundImage} alt="" loading="lazy" decoding="async" />}
                <span className="backlog-search-results__name">
                  {r.name}
                  {r.isDlc && r.parentTitle && (
                    <span className="tag tag--muted backlog-search-results__dlc-tag">DLC for {r.parentTitle}</span>
                  )}
                </span>
                {r.platforms.length > 0 ? (
                  <label className="currency-picker" style={{ flexShrink: 0 }}>
                    <span>Platform</span>
                    <select
                      value={platformByResult[r.id] || ""}
                      onChange={(e) => setPlatformByResult((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    >
                      {r.platforms.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="panel__status" style={{ margin: 0 }}>No platform data</span>
                )}
                <button
                  type="button"
                  className="linking-row__connect"
                  onClick={() => handleAdd(r)}
                  disabled={addingId === r.id}
                >
                  {addingId === r.id ? "Adding…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}

      </div>

      {status === "ready" && items.length > 0 && (
        <div className="backlog-add">
          <div className="backlog-status-tabs">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                className={`quickdash-reset-btn ${statusFilter === f ? "quickdash-reset-btn--active" : ""}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === "all" ? "All" : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
          <label className="currency-picker">
            <span>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {status === "loading" && <p className="panel__status">Loading your backlog…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your backlog right now.</p>}
      {status === "ready" && items.length === 0 && (
        <p className="panel__status">Nothing in your backlog yet — search or import above.</p>
      )}
      {status === "ready" && items.length > 0 && filteredItems.length === 0 && (
        <p className="panel__status">Nothing with this status yet.</p>
      )}

      {status === "ready" && filteredItems.length > 0 && (
        <ul className="backlog-list">
          {sortedItems.map((item) => (
            <li key={item.id} className="backlog-card">
              {item.steam_appid || item.thumb ? (
                <SteamArt
                  appid={item.steam_appid}
                  headerImage={item.thumb}
                  className="backlog-card__thumb"
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
              )}
              <div className="backlog-card__info">
                <span className="backlog-card__title">{item.title}</span>
                <div className="backlog-card__meta">
                  {item.parent_title && (
                    <span className="tag tag--muted">DLC for {item.parent_title}</span>
                  )}
                  {item.platform && <span className="tag tag--muted">{item.platform}</span>}
                  {item.metacriticScore != null && <span className="score-badge">Metacritic {item.metacriticScore}</span>}
                  {item.releaseDate && <span>{item.releaseDate}</span>}
                  {item.totalAchievements != null && item.totalAchievements > 0 && (
                    <span>
                      {item.unlockedAchievements != null ? `${item.unlockedAchievements}/` : ""}
                      {item.totalAchievements} achievements
                    </span>
                  )}
                </div>
                <div className="backlog-card__actions">
                  <select
                    className="backlog-card__status-select"
                    value={item.status || "backlog"}
                    onChange={(e) => handleStatusChange(item.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <label className="backlog-card__hours">
                    Your estimate:
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="hours"
                      value={item.hours_estimate ?? ""}
                      onChange={(e) => handleHoursChange(item.id, e.target.value)}
                    />
                    h
                  </label>
                  <a
                    href={`https://howlongtobeat.com/?q=${encodeURIComponent(item.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="backlog-card__hltb-link"
                  >
                    Check on HowLongToBeat ↗
                  </a>
                </div>
              </div>
              <button type="button" className="game-popup__close" onClick={() => handleRemove(item.id)} aria-label="Remove from backlog">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
