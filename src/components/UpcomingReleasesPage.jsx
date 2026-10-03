// Upcoming Releases — new games and DLC/expansions, via RAWG's real
// game database API (see lib/rawg.js for what's confirmed vs. best-
// effort in their schema). Deliberately kept separate from Game
// Services' manually-researched "service changes" calendar for now.
//
// Logged out: browse everything, filter by platform/genre/release
// type, sorted earliest to latest.
// Logged in: defaults to "My Games" — DLC/expansions specifically for
// titles in your wishlist, library, and backlog — with the option to
// switch to the general browse too.
//
// RAWG's free tier requires attribution (an active link back to them
// on every page using their data) — see the credit line at the
// bottom. Don't remove it.

import { useEffect, useState } from "react";
import {
  fetchRawgPlatforms,
  fetchRawgGenres,
  fetchUpcomingReleases,
  fetchUpcomingDlcForTitles,
} from "../lib/rawg";
import { fetchOwnedGames } from "../lib/steam";
import { fetchBacklog } from "../lib/backlog";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthsFromNowIso(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function UpcomingReleasesPage({ onBack, isLoggedIn, userId, wishlist, linkedSteamId }) {
  const [mode, setMode] = useState(isLoggedIn ? "mine" : "everything");

  const [platforms, setPlatforms] = useState([]);
  const [genres, setGenres] = useState([]);
  const [platformId, setPlatformId] = useState("");
  const [genreId, setGenreId] = useState("");
  const [releaseType, setReleaseType] = useState("all"); // "all" | "new"

  const [releases, setReleases] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error | no_key

  useEffect(() => {
    // Best-effort — the platform/genre filters just stay empty (no
    // crash) if this fails, since loadEverything/loadMine below still
    // work fine without them and already own the page's real error UI.
    fetchRawgPlatforms()
      .then((list) => list !== "no_key" && setPlatforms(list))
      .catch((err) => console.error("Failed to load RAWG platforms:", err));
    fetchRawgGenres()
      .then((list) => list !== "no_key" && setGenres(list))
      .catch((err) => console.error("Failed to load RAWG genres:", err));
  }, []);

  useEffect(() => {
    if (mode === "everything") {
      loadEverything();
    } else if (mode === "mine" && userId) {
      loadMine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, platformId, genreId, releaseType, userId, page]);

  async function loadEverything() {
    setStatus("loading");
    try {
      const result = await fetchUpcomingReleases({
        dateFrom: todayIso(),
        dateTo: monthsFromNowIso(6),
        platformId: platformId || undefined,
        genreId: genreId || undefined,
        excludeAdditions: releaseType === "new",
        page,
      });
      if (result === "no_key") {
        setStatus("no_key");
        return;
      }
      const list = Array.isArray(result) ? result : result.results;
      setReleases(list);
      setHasNext(Boolean(result.hasNext));
      setStatus("ready");
    } catch (err) {
      console.error("Upcoming releases fetch failed:", err);
      setStatus("error");
    }
  }

  async function loadMine() {
    setStatus("loading");
    try {
      const titles = new Set(wishlist.map((w) => w.title));

      if (linkedSteamId) {
        const owned = await fetchOwnedGames(linkedSteamId);
        owned.forEach((g) => titles.add(g.name));
      }

      const backlog = await fetchBacklog(userId);
      backlog.forEach((b) => titles.add(b.title));

      if (titles.size === 0) {
        setReleases([]);
        setStatus("ready");
        return;
      }

      const dlc = await fetchUpcomingDlcForTitles([...titles]);
      setReleases(dlc);
      setStatus("ready");
    } catch (err) {
      console.error("Personalized upcoming DLC fetch failed:", err);
      setStatus("error");
    }
  }

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Market</button>
        <h1 className="price-page__title">Upcoming Releases</h1>
        <p className="price-page__subtitle">
          {mode === "mine"
            ? "DLC and expansions coming for games in your wishlist, library, and backlog."
            : "New releases and DLC across every platform, earliest first."}
        </p>
      </div>

      {status === "ready" && releases.length > 0 && (
        <div className="backlog-summary">
          <div className="panel__stat">
            <span className="panel__stat-value">{releases.length}</span>
            <span className="panel__stat-label">{mode === "mine" ? "DLC coming" : "Releases found"}</span>
          </div>
        </div>
      )}

      {isLoggedIn && (
        <div className="backlog-add">
          <button
            type="button"
            className={`quickdash-reset-btn ${mode === "mine" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setMode("mine")}
          >
            My Games
          </button>
          <button
            type="button"
            className={`quickdash-reset-btn ${mode === "everything" ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setMode("everything")}
          >
            Everything
          </button>
        </div>
      )}

      {mode === "everything" && (
        <div className="backlog-add">
          <label className="currency-picker">
            <span>Platform</span>
            <select value={platformId} onChange={(e) => { setPlatformId(e.target.value); setPage(1); setHasNext(false); }}>
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="currency-picker">
            <span>Genre</span>
            <select value={genreId} onChange={(e) => { setGenreId(e.target.value); setPage(1); setHasNext(false); }}>
              <option value="">All genres</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="currency-picker">
            <span>Release type</span>
            <select value={releaseType} onChange={(e) => { setReleaseType(e.target.value); setPage(1); setHasNext(false); }}>
              <option value="all">Everything</option>
              <option value="new">New games only</option>
            </select>
          </label>
        </div>
      )}

      {mode === "everything" && status !== "no_key" && status !== "error" && (page > 1 || hasNext) && (
        <div className="backlog-add backlog-add--row">
          <button
            type="button"
            className="quickdash-reset-btn"
            disabled={page <= 1 || status === "loading"}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="panel__status">Page {page}</span>
          <button
            type="button"
            className="quickdash-reset-btn"
            disabled={!hasNext || status === "loading"}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      )}

      {status === "loading" && <p className="panel__status">Loading…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load upcoming releases right now.</p>}
      {status === "no_key" && <p className="panel__status">Upcoming Releases isn't available right now.</p>}
      {status === "ready" && releases.length === 0 && (
        <p className="panel__status">
          {mode === "mine" ? "No upcoming DLC found for your games right now." : "Nothing found for these filters."}
        </p>
      )}

      {status === "ready" && releases.length > 0 && (
        <ul className="backlog-list">
          {releases.map((r) => (
            <li key={r.id} className="backlog-card">
              {r.backgroundImage ? (
                <img src={r.backgroundImage} alt="" className="backlog-card__thumb" loading="lazy" decoding="async" />
              ) : (
                <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
              )}
              <div className="backlog-card__info">
                <span className="backlog-card__title">{r.name}</span>
                <div className="backlog-card__meta">
                  <span>{r.tba || !r.released ? "TBA" : r.released}</span>
                  {mode === "mine" && r.parentTitle && <span>DLC for {r.parentTitle}</span>}
                  {mode === "everything" && r.metacritic != null && <span className="score-badge">Metacritic {r.metacritic}</span>}
                  {mode === "everything" && r.platforms?.length > 0 && <span>{r.platforms.join(", ")}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <a
        href="https://rawg.io"
        target="_blank"
        rel="noopener noreferrer"
        className="ps-trophy-attribution"
      >
        Release data powered by RAWG
      </a>
    </div>
  );
}
