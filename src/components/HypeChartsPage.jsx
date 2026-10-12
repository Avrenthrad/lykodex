// Hype Charts — Steam's real top-played-games chart.
// Steam's chart endpoint only returns appid + rank + player counts,
// not names, so we resolve names/genres separately for the games
// shown — loaded in batches of 10 (polite to Steam's API) rather than
// firing 100 requests at once, and cached 24h per game (see
// resolveGameName in lib/steam.js) so reloading the page doesn't
// re-resolve the same 100 games every time.
//
// Genre filter: Steam's own genre tags per game (from the same
// appdetails call we already make). Since the chart is already
// ranked by player count, filtering to one genre naturally keeps
// "highest to lowest" order within that genre — no extra sorting
// logic needed. "All genres" is the top-overall view (default).

import { useEffect, useState } from "react";
import { fetchTopPlayedGames, resolveGameName } from "../lib/steam";
import SteamArt from "./SteamArt";
import GameCardPopup from "./GameCardPopup";

const TOTAL_COUNT = 100;
const BATCH_SIZE = 10;

export default function HypeChartsPage({
  onBack,
  wishlist,
  onAddToWishlist,
  onRemoveFromWishlist,
  currency,
  isLoggedIn,
  onSignIn,
  onCreateAccount,
  platformOrder,
}) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadedCount, setLoadedCount] = useState(0);
  const [genreFilter, setGenreFilter] = useState("all");
  const [selectedGame, setSelectedGame] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const ranks = await fetchTopPlayedGames();
        const top = ranks.slice(0, TOTAL_COUNT);
        if (cancelled) return;

        setRows(top.map((r, i) => ({ ...r, rank: r.rank ?? i + 1, name: null, thumb: null, genres: [] })));
        setStatus("ready");

        for (let i = 0; i < top.length; i += BATCH_SIZE) {
          const batch = top.slice(i, i + BATCH_SIZE);
          const infos = await Promise.all(
            batch.map((r) => resolveGameName(r.appid).catch(() => ({ name: null })))
          );
          if (cancelled) return;

          setRows((prev) => {
            const next = [...prev];
            batch.forEach((r, j) => {
              const idx = i + j;
              const info = infos[j];
              next[idx] = {
                ...next[idx],
                name: info.name || `App #${r.appid}`,
                thumb: info.thumb || null,
                genres: info.genres || [],
              };
            });
            return next;
          });
          setLoadedCount(Math.min(i + BATCH_SIZE, top.length));
        }
      } catch (err) {
        console.error("Hype Charts failed:", err);
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const genreOptions = Array.from(
    new Set(rows.flatMap((r) => r.genres || []))
  ).sort();

  const visibleRows = genreFilter === "all"
    ? rows
    : rows.filter((r) => r.genres?.includes(genreFilter));

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Market</button>
        <h1 className="price-page__title">Hype Charts</h1>
        <p className="price-page__subtitle">
          Steam's official top {TOTAL_COUNT} most-played games right now, ranked by concurrent players.
        </p>
      </div>

      {status === "ready" && (
        <label className="currency-picker">
          <span>Genre</span>
          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="all">All genres — top overall</option>
            {genreOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
      )}

      {status === "loading" && <p className="panel__status">Loading chart…</p>}
      {status === "error" && (
        <p className="panel__status panel__status--error">Couldn't load the charts right now.</p>
      )}
      {status === "ready" && loadedCount < rows.length && (
        <p className="panel__status">Resolving names/genres… {loadedCount} of {rows.length}</p>
      )}

      {status === "ready" && (
        <ol className="hype-list">
          {visibleRows.map((row) => (
            <li key={row.appid}>
              <button
                type="button"
                className="hype-row hype-row--clickable"
                onClick={() => row.name && setSelectedGame(row.name)}
                disabled={!row.name}
              >
                <span className="hype-row__rank">#{row.rank}</span>
                <SteamArt
                  appid={row.appid}
                  headerImage={row.thumb}
                  className="hype-row__thumb"
                  alt=""
                  loading="lazy"
                  resolveHeader={false}
                />
                <span className="hype-row__name">{row.name || "Loading…"}</span>
                <span className="hype-row__players">
                  {(row.concurrent_in_game ?? row.peak_in_game ?? row.players ?? null)?.toLocaleString() ?? "—"} playing
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {selectedGame && (
        <GameCardPopup
          gameTitle={selectedGame}
          onClose={() => setSelectedGame(null)}
          wishlist={wishlist}
          onAddToWishlist={onAddToWishlist}
          onRemoveFromWishlist={onRemoveFromWishlist}
          currency={currency}
          isLoggedIn={isLoggedIn}
          onSignIn={onSignIn}
          onCreateAccount={onCreateAccount}
          platformOrder={platformOrder}
        />
      )}
    </div>
  );
}
