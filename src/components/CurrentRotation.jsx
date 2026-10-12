/**
 * Current Rotation — the games you're actually playing right now.
 * Pinned strip at the top of the dashboard. Max 4 pins.
 * Persisted in localStorage so it works logged-out too.
 *
 * Pin suggestions come from two real sources: Steam's own real
 * playtime_2weeks window (same recency signal ContinuePlayingCard/
 * fetchContinuePlayingSlides already uses — "recently played" isn't
 * a guessed proxy) offered first as the default, and the wishlist as
 * a fallback/supplement.
 *
 * Once there's both a real Rotation and real backlog data, the card
 * auto-cycles between the two every ROTATE_MS, same dot-indicator
 * pattern as ContinuePlayingCard — never cycles to an empty backlog.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOwnedGames } from "../lib/steam";
import { fetchBacklog, STATUS_LABELS } from "../lib/backlog";
import { fetchContinuePlayingSlides } from "../lib/friendsData";
import { searchRawgGamesAndDlc } from "../lib/rawg";
import SteamArt from "./SteamArt";

const STORAGE_KEY = "gd-current-rotation";
const MAX_PINS = 4;
const ROTATE_MS = 8000;
const FEATURED_ROTATE_MS = 7000;

function loadPins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
}

function savePins(pins) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins.slice(0, MAX_PINS)));
  } catch {
    /* ignore */
  }
}

export default function CurrentRotation({
  wishlist = [],
  linkedSteamId,
  userId,
  onOpenBacklog,
  onOpenPrices,
  onOpenLibrary,
}) {
  const [pins, setPins] = useState(loadPins);
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchError, setSearchError] = useState(null);
  const pickerSearchRef = useRef(null);
  const [recentGames, setRecentGames] = useState([]);
  const [backlogItems, setBacklogItems] = useState([]);
  const [previewMode, setPreviewMode] = useState(0); // 0 = Rotation, 1 = Backlog preview
  const [featuredSlides, setFeaturedSlides] = useState([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredStatus, setFeaturedStatus] = useState("idle");

  useEffect(() => {
    savePins(pins);
  }, [pins]);

  useEffect(() => {
    if (!picking) return;
    pickerSearchRef.current?.focus();
  }, [picking]);

  useEffect(() => {
    if (!picking) {
      setPickerQuery("");
      setSearchResults([]);
      setSearchStatus("idle");
      setSearchError(null);
      return;
    }

    const query = pickerQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchStatus("idle");
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearchStatus("loading");
    setSearchError(null);

    const timer = setTimeout(() => {
      searchRawgGamesAndDlc(query, wishlist.map((w) => w.title))
        .then((results) => {
          if (cancelled) return;
          if (results === "no_key") {
            setSearchResults([]);
            setSearchStatus("ready");
            setSearchError("Platform search isn't configured yet.");
            return;
          }
          setSearchResults(results);
          setSearchStatus("ready");
        })
        .catch((err) => {
          console.error("Rotation pin search failed:", err);
          if (!cancelled) {
            setSearchResults([]);
            setSearchStatus("error");
            setSearchError("Couldn't search right now.");
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picking, pickerQuery, wishlist]);

  useEffect(() => {
    if (!linkedSteamId) {
      setFeaturedSlides([]);
      setFeaturedStatus("idle");
      return;
    }
    setFeaturedStatus("loading");
    fetchContinuePlayingSlides(linkedSteamId)
      .then((result) => {
        setFeaturedSlides(result);
        setFeaturedIndex(0);
        setFeaturedStatus("ready");
      })
      .catch((err) => {
        console.error("Continue Playing fetch failed:", err);
        setFeaturedStatus("error");
      });
  }, [linkedSteamId]);

  useEffect(() => {
    if (featuredSlides.length < 2) return;
    const interval = setInterval(() => {
      setFeaturedIndex((i) => (i + 1) % featuredSlides.length);
    }, FEATURED_ROTATE_MS);
    return () => clearInterval(interval);
  }, [featuredSlides.length]);

  useEffect(() => {
    if (!linkedSteamId) return;
    fetchOwnedGames(linkedSteamId)
      .then((games) => {
        const recent = games
          .filter((g) => (g.playtime_2weeks || 0) > 0)
          .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
          .slice(0, 8)
          .map((g) => g.name);
        setRecentGames(recent);
      })
      .catch((err) => console.error("Failed to load recently played games:", err));
  }, [linkedSteamId]);

  useEffect(() => {
    if (!userId) return;
    fetchBacklog(userId)
      .then((items) => {
        const active = items.filter((i) => {
          const s = i.status || "backlog";
          return s !== "completed" && s !== "dropped";
        });
        setBacklogItems(active.slice(0, 5));
      })
      .catch((err) => console.error("Failed to load backlog preview:", err));
  }, [userId]);

  useEffect(() => {
    if (pins.length === 0 || backlogItems.length === 0) return;
    const interval = setInterval(() => setPreviewMode((m) => (m + 1) % 2), ROTATE_MS);
    return () => clearInterval(interval);
  }, [pins.length, backlogItems.length]);

  function pinTitle(title) {
    setPins((prev) => {
      if (prev.includes(title)) return prev;
      if (prev.length >= MAX_PINS) return prev;
      return [...prev, title];
    });
    setPicking(false);
  }

  function unpinTitle(title) {
    setPins((prev) => prev.filter((t) => t !== title));
  }

  const recentCandidates = recentGames.filter((t) => !pins.includes(t));
  const wishlistTitles = wishlist
    .map((w) => w.title)
    .filter((t) => !pins.includes(t) && !recentCandidates.includes(t));

  const normalizedQuery = pickerQuery.trim().toLowerCase();
  const matchesQuery = (title) => !normalizedQuery || title.toLowerCase().includes(normalizedQuery);

  const filteredRecent = recentCandidates.filter(matchesQuery);
  const filteredWishlist = wishlistTitles.filter(matchesQuery);
  const displayedWishlist = normalizedQuery ? filteredWishlist : filteredWishlist.slice(0, 12);

  const localTitleSet = useMemo(() => {
    const titles = new Set([...filteredRecent, ...displayedWishlist]);
    for (const title of recentCandidates) titles.add(title);
    for (const title of wishlistTitles) titles.add(title);
    return titles;
  }, [filteredRecent, displayedWishlist, recentCandidates, wishlistTitles]);

  const filteredSearchResults = searchResults.filter(
    (result) => !pins.includes(result.name) && !localTitleSet.has(result.name)
  );

  const hasPickerMatches =
    filteredRecent.length > 0
    || displayedWishlist.length > 0
    || filteredSearchResults.length > 0;


  const showBacklogPreview = pins.length > 0 && backlogItems.length > 0 && previewMode === 1;
  const featuredSlide = featuredSlides[featuredIndex];

  return (
    <section className="current-rotation">
      <div className="current-rotation__head">
        <div>
          <span className="current-rotation__eyebrow">Right now</span>
          <h2 className="current-rotation__title">Current Rotation</h2>
        </div>
        <div className="current-rotation__actions">
          {pins.length > 0 && backlogItems.length > 0 && (
            <div className="hero-card__dots">
              {["Rotation", "Backlog"].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`hero-card__dot ${previewMode === i ? "hero-card__dot--active" : ""}`}
                  onClick={() => setPreviewMode(i)}
                  aria-label={`Show ${label}`}
                />
              ))}
            </div>
          )}
          {pins.length < MAX_PINS && (
            <button
              type="button"
              className="current-rotation__btn"
              onClick={() => setPicking((v) => !v)}
            >
              {picking ? "Cancel" : "Pin a game"}
            </button>
          )}
          {onOpenBacklog && (
            <button
              type="button"
              className="current-rotation__btn current-rotation__btn--ghost"
              onClick={onOpenBacklog}
            >
              Backlog
            </button>
          )}
        </div>
      </div>

      {picking && (
        <div className="current-rotation__picker">
          <label className="current-rotation__picker-search-label" htmlFor="rotation-picker-search">
            Search games to pin
          </label>
          <input
            id="rotation-picker-search"
            ref={pickerSearchRef}
            type="search"
            className="price-search__input current-rotation__picker-search"
            placeholder="Filter recent & wishlist, or search any game…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoComplete="off"
          />

          {searchError && (
            <p className="panel__status panel__status--error current-rotation__picker-hint">{searchError}</p>
          )}

          {!hasPickerMatches && searchStatus !== "loading" ? (
            <p className="current-rotation__empty-hint">
              {normalizedQuery
                ? "No matches — try a different search."
                : (
                  <>
                    Nothing left to pin — link Steam or add to your wishlist first.{" "}
                    {onOpenPrices && (
                      <button type="button" className="linkish" onClick={onOpenPrices}>
                        Add games →
                      </button>
                    )}
                  </>
                )}
            </p>
          ) : (
            <>
              {filteredRecent.length > 0 && (
                <>
                  <span className="feed-col__label">Recently played</span>
                  <ul className="current-rotation__picker-list">
                    {filteredRecent.map((title) => (
                      <li key={title}>
                        <button
                          type="button"
                          className="current-rotation__picker-item"
                          onClick={() => pinTitle(title)}
                        >
                          {title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {displayedWishlist.length > 0 && (
                <>
                  <span className="feed-col__label">From your wishlist</span>
                  <ul className="current-rotation__picker-list">
                    {displayedWishlist.map((title) => (
                      <li key={title}>
                        <button
                          type="button"
                          className="current-rotation__picker-item"
                          onClick={() => pinTitle(title)}
                        >
                          {title}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!normalizedQuery && filteredWishlist.length > displayedWishlist.length && (
                    <p className="current-rotation__picker-hint">
                      {filteredWishlist.length - displayedWishlist.length} more on your wishlist — search to find them.
                    </p>
                  )}
                </>
              )}
              {searchStatus === "loading" && normalizedQuery.length >= 2 && (
                <p className="current-rotation__picker-hint">Searching…</p>
              )}
              {filteredSearchResults.length > 0 && (
                <>
                  <span className="feed-col__label">Search results</span>
                  <ul className="current-rotation__picker-list">
                    {filteredSearchResults.map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          className="current-rotation__picker-item"
                          onClick={() => pinTitle(result.name)}
                        >
                          {result.name}
                          {result.isDlc && result.parentTitle && (
                            <span className="current-rotation__picker-dlc">DLC · {result.parentTitle}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {linkedSteamId && featuredStatus === "loading" && (
        <p className="panel__status current-rotation__featured-status">Loading your recent play…</p>
      )}
      {linkedSteamId && featuredStatus === "error" && (
        <p className="panel__status panel__status--error current-rotation__featured-status">
          Couldn&apos;t load your progress right now.
        </p>
      )}
      {linkedSteamId && featuredStatus === "ready" && featuredSlides.length === 0 && (
        <p className="panel__status current-rotation__featured-status">
          No owned games visible on this Steam profile.
        </p>
      )}

      {linkedSteamId && featuredStatus === "ready" && featuredSlide && (
        <div className="current-rotation__featured">
          <div className="current-rotation__featured-head">
            <span className="current-rotation__featured-label">{featuredSlide.label}</span>
            {featuredSlides.length > 1 && (
              <div className="hero-card__dots">
                {featuredSlides.map((s, i) => (
                  <button
                    key={s.label}
                    type="button"
                    className={`hero-card__dot ${i === featuredIndex ? "hero-card__dot--active" : ""}`}
                    onClick={() => setFeaturedIndex(i)}
                    aria-label={`Show ${s.label}`}
                  />
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="current-rotation__featured-art"
            onClick={onOpenLibrary}
            key={featuredSlide.label}
          >
            <SteamArt appid={featuredSlide.appid} variant="hero" fill alt="" />
            <div className="current-rotation__featured-overlay">
              <span className="current-rotation__featured-title">{featuredSlide.gameName}</span>
              {featuredSlide.isCurrentlyPlaying && (
                <span className="own-progress-row__live">● Playing now</span>
              )}
            </div>
          </button>

          <div className="current-rotation__featured-stats">
            {featuredSlide.completionPct != null && (
              <>
                <div className="friend-row__progress-bar current-rotation__featured-bar">
                  <div
                    className="friend-row__progress-fill"
                    style={{ width: `${featuredSlide.completionPct}%` }}
                  />
                </div>
                <div className="panel__stat-row">
                  <div className="panel__stat">
                    <span className="panel__stat-value">{featuredSlide.completionPct}%</span>
                    <span className="panel__stat-label">Achievements</span>
                  </div>
                  {!featuredSlide.isCurrentlyPlaying && (
                    <div className="panel__stat">
                      <span className="panel__stat-value">{featuredSlide.statHours}h</span>
                      <span className="panel__stat-label">{featuredSlide.statLabel}</span>
                    </div>
                  )}
                </div>
              </>
            )}
            {featuredSlide.completionPct == null && !featuredSlide.isCurrentlyPlaying && (
              <div className="panel__stat-row">
                <div className="panel__stat">
                  <span className="panel__stat-value">{featuredSlide.statHours}h</span>
                  <span className="panel__stat-label">{featuredSlide.statLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!linkedSteamId && (
        <p className="panel__status current-rotation__featured-status">
          Link Steam to see what you&apos;re playing here.
        </p>
      )}

      <div className="current-rotation__section-label">
        <span>{showBacklogPreview ? "From Your Backlog" : "Pinned Rotation"}</span>
      </div>

      {pins.length === 0 ? (
        <div className="current-rotation__empty">
          <p>
            Your rotation is empty. Pin up to {MAX_PINS} games you&apos;re actually playing
            so the dashboard stops pretending your entire library is &quot;active.&quot;
          </p>
          <button
            type="button"
            className="current-rotation__btn"
            onClick={() => setPicking(true)}
          >
            Pin a game
          </button>
        </div>
      ) : showBacklogPreview ? (
        <ul className="current-rotation__grid">
          {backlogItems.map((item) => (
            <li key={item.id} className="current-rotation__card">
              <span className="current-rotation__card-title">{item.title}</span>
              <span className="label-chip">{STATUS_LABELS[item.status || "backlog"]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="current-rotation__grid">
          {pins.map((title) => (
            <li key={title} className="current-rotation__card">
              <span className="current-rotation__card-title">{title}</span>
              <button
                type="button"
                className="current-rotation__unpin"
                onClick={() => unpinTitle(title)}
                title="Remove from rotation"
                aria-label={`Unpin ${title}`}
              >
                ×
              </button>
            </li>
          ))}
          {Array.from({ length: MAX_PINS - pins.length }).map((_, i) => (
            <li key={`slot-${i}`} className="current-rotation__card current-rotation__card--empty">
              <button
                type="button"
                className="current-rotation__slot"
                onClick={() => setPicking(true)}
                disabled={pins.length >= MAX_PINS}
              >
                + Pin
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
