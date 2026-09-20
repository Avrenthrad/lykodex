// Entertainment College — real movie/TV/anime/book search and
// tracking via TMDB, AniList, and Open Library. Comics and the real
// barcode-scan TBR book flow live on their own dedicated pages (see
// ComicsPage.jsx / BooksPage.jsx) since they need real multi-list/
// status models this simple search-and-track flow doesn't.
//
// NOTE: TMDB's terms require their logo specifically be displayed for
// attribution, not just a text link — the credit line at the bottom
// is a text-based placeholder for that until a real TMDB logo asset
// is added; worth treating as not fully compliant until then.

import { useEffect, useState } from "react";
import { searchMovies, searchTv } from "../lib/tmdb";
import { searchAnime } from "../lib/anilist";
import { searchBooks } from "../lib/openlibrary";
import {
  fetchEntertainmentEntries, addEntertainmentEntry,
  updateEntertainmentStatus, removeEntertainmentEntry,
} from "../lib/entertainment";

const STATUSES = ["want_to_watch", "watching", "completed", "dropped"];
const STATUS_LABELS = {
  want_to_watch: "Want to Watch",
  watching: "Watching",
  completed: "Completed",
  dropped: "Dropped",
};

export default function EntertainmentHomePage({ onBack, isLoggedIn, userId, onSignIn, onCreateAccount, onGoToBooks, onGoToComics }) {
  const [searchType, setSearchType] = useState("movie");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [addedIds, setAddedIds] = useState(new Set());

  const [entries, setEntries] = useState([]);
  const [entriesStatus, setEntriesStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, userId]);

  async function loadEntries() {
    setEntriesStatus("loading");
    try {
      const rows = await fetchEntertainmentEntries(userId);
      setEntries(rows);
      setEntriesStatus("ready");
    } catch (err) {
      console.error("Failed to load entertainment entries:", err);
      setEntriesStatus("error");
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchStatus("loading");
    try {
      let results;
      if (searchType === "movie") results = await searchMovies(query.trim());
      else if (searchType === "tv") results = await searchTv(query.trim());
      else if (searchType === "anime") results = await searchAnime(query.trim());
      else results = await searchBooks(query.trim());

      if (results === "no_key") {
        setSearchStatus("no_key");
        return;
      }
      setSearchResults(results.slice(0, 12));
      setSearchStatus("ready");
    } catch (err) {
      console.error("Entertainment search failed:", err);
      setSearchStatus("error");
    }
  }

  async function handleAdd(result) {
    try {
      await addEntertainmentEntry(userId, result);
      setAddedIds((prev) => new Set(prev).add(result.id));
      loadEntries();
    } catch (err) {
      console.error("Failed to add entertainment entry:", err);
    }
  }

  async function handleStatusChange(entryId, status) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status } : e)));
    try {
      await updateEntertainmentStatus(entryId, status);
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  }

  async function handleRemove(entryId) {
    try {
      await removeEntertainmentEntry(entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      console.error("Failed to remove entry:", err);
    }
  }

  const watchingCount = entries.filter((e) => e.status === "watching").length;

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Overview</button>
        <p className="price-page__subtitle">
          Real movies, TV, anime, and books — via TMDB, AniList, and Open Library.
        </p>
      </div>

      {isLoggedIn && (
        <div className="backlog-add">
          <button type="button" className="quickdash-reset-btn" onClick={onGoToBooks}>
            📷 Scan a book barcode / My TBR
          </button>
          <button type="button" className="quickdash-reset-btn" onClick={onGoToComics}>
            📖 My Comics
          </button>
        </div>
      )}

      {isLoggedIn && entries.length > 0 && (
        <div className="backlog-summary">
          <div className="panel__stat">
            <span className="panel__stat-value">{entries.length}</span>
            <span className="panel__stat-label">Tracked</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value">{watchingCount}</span>
            <span className="panel__stat-label">Watching</span>
          </div>
        </div>
      )}

      <div className="backlog-add">
        <div className="backlog-status-tabs">
          <button
            type="button"
            className={`quickdash-reset-btn ${searchType === "movie" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setSearchType("movie")}
          >
            Movies
          </button>
          <button
            type="button"
            className={`quickdash-reset-btn ${searchType === "tv" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setSearchType("tv")}
          >
            TV Shows
          </button>
          <button
            type="button"
            className={`quickdash-reset-btn ${searchType === "anime" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setSearchType("anime")}
          >
            Anime
          </button>
          <button
            type="button"
            className={`quickdash-reset-btn ${searchType === "book" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setSearchType("book")}
          >
            Books
          </button>
        </div>

        <form className="price-search" onSubmit={handleSearch}>
          <input
            className="price-search__input"
            type="text"
            placeholder={`Search ${searchType === "movie" ? "movies" : searchType === "tv" ? "TV shows" : searchType === "anime" ? "anime" : "books"}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="price-search__button" disabled={searchStatus === "loading"}>
            {searchStatus === "loading" ? "Searching…" : "Search"}
          </button>
        </form>
      </div>

      {searchStatus === "no_key" && (
        <p className="panel__status">Library isn't available right now.</p>
      )}
      {searchStatus === "error" && <p className="panel__status panel__status--error">Couldn't search right now.</p>}

      {searchResults.length > 0 && (
        <ul className="backlog-list">
          {searchResults.map((r) => (
            <li key={r.id} className="backlog-card">
              {r.posterUrl ? (
                <img src={r.posterUrl} alt="" className="backlog-card__thumb" loading="lazy" decoding="async" />
              ) : (
                <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
              )}
              <div className="backlog-card__info">
                <span className="backlog-card__title">{r.title}</span>
                <div className="backlog-card__meta">
                  {r.author && <span>{r.author}</span>}
                  {r.releaseDate && <span>{r.releaseDate.slice(0, 4)}</span>}
                  {r.voteAverage != null && r.voteAverage > 0 && <span className="score-badge">★ {r.voteAverage.toFixed(1)}</span>}
                </div>
              </div>
              {isLoggedIn ? (
                <button
                  type="button"
                  className="linking-row__connect"
                  onClick={() => handleAdd(r)}
                  disabled={addedIds.has(r.id)}
                >
                  {addedIds.has(r.id) ? "Added" : "Add"}
                </button>
              ) : (
                <div className="backlog-card__actions">
                  <button type="button" className="linking-row__connect" onClick={onSignIn}>Sign in</button>
                  <button type="button" className="linking-row__connect" onClick={onCreateAccount}>Create account</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isLoggedIn && (
        <>
          <span className="feed-col__label" style={{ marginTop: "24px", display: "block" }}>Your List</span>
          {entriesStatus === "loading" && <p className="panel__status">Loading…</p>}
          {entriesStatus === "ready" && entries.length === 0 && (
            <p className="panel__status">Nothing tracked yet — search above to add something.</p>
          )}
          {entriesStatus === "ready" && entries.length > 0 && (
            <ul className="backlog-list">
              {entries.map((entry) => (
                <li key={entry.id} className="backlog-card">
                  {entry.cover_url ? (
                    <img src={entry.cover_url} alt="" className="backlog-card__thumb" loading="lazy" decoding="async" />
                  ) : (
                    <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
                  )}
                  <div className="backlog-card__info">
                    <span className="backlog-card__title">{entry.title}</span>
                    <div className="backlog-card__meta">
                      <span style={{ textTransform: "capitalize" }}>{entry.media_kind}</span>
                    </div>
                    <select
                      className="backlog-card__status-select"
                      value={entry.status}
                      onChange={(e) => handleStatusChange(entry.id, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="game-popup__close" onClick={() => handleRemove(entry.id)} aria-label="Remove">✕</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Movie and TV data provided by TMDB
      </a>
      <a href="https://anilist.co" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Anime data provided by AniList
      </a>
      <a href="https://openlibrary.org" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Book data provided by Open Library
      </a>
    </div>
  );
}
