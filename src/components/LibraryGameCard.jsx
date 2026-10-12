import { useState } from "react";
import SteamArt from "./SteamArt";

const PLATFORM_LABELS = { steam: "Steam", xbox: "Xbox", playstation: "PlayStation" };

export function PlatformTag({ platform }) {
  const label = PLATFORM_LABELS[platform] || platform;
  return <span className={`tag tag--platform tag--platform-${platform}`}>{label}</span>;
}

function LibraryDlcDropdown({ dlc }) {
  if (!dlc?.length) return null;

  return (
    <details className="library-dlc-dropdown">
      <summary className="library-dlc-dropdown__summary">
        {dlc.length} DLC owned
      </summary>
      <ul className="library-dlc-dropdown__list">
        {dlc.map((item) => (
          <li key={`${item.platform}-${item.title}`} className="library-dlc-dropdown__item">
            <PlatformTag platform={item.platform} />
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Completed / Run It Back / 100% / Backlog+ / Dropped — Completed,
// Run It Back, 100%, and Dropped are independent, non-exclusive
// toggles (game_library_tags — see lib/gameLibraryTags.js for why
// this is deliberately its own table, not backlog_items' status
// column). Backlog+ is not a tag at all: it's a real action that adds
// this title to the user's actual Backlog (lib/backlog.js), so it
// disables once already there rather than toggling.
export function LibraryRowActions({ tags, onToggleTag, inBacklog, onAddToBacklog }) {
  return (
    <div className="library-row-actions">
      <button
        type="button"
        className={`library-action-btn ${tags.has("completed") ? "library-action-btn--active" : ""}`}
        onClick={() => onToggleTag("completed")}
        title="Completed"
      >
        ✅
      </button>
      <button
        type="button"
        className={`library-action-btn ${tags.has("run_it_back") ? "library-action-btn--active" : ""}`}
        onClick={() => onToggleTag("run_it_back")}
        title="Run It Back"
      >
        🔁
      </button>
      <button
        type="button"
        className={`library-action-btn ${tags.has("hundred_percent") ? "library-action-btn--active" : ""}`}
        onClick={() => onToggleTag("hundred_percent")}
        title="100%"
      >
        💯
      </button>
      <button
        type="button"
        className={`library-action-btn ${inBacklog ? "library-action-btn--active" : ""}`}
        onClick={onAddToBacklog}
        disabled={inBacklog}
        title={inBacklog ? "Already in your Backlog" : "Add to Backlog"}
      >
        {inBacklog ? "✓" : "➕"}
      </button>
      <button
        type="button"
        className={`library-action-btn ${tags.has("dropped") ? "library-action-btn--active" : ""}`}
        onClick={() => onToggleTag("dropped")}
        title="Dropped"
      >
        🚫
      </button>
    </div>
  );
}

// The emblem shows a blank star until rated, then "yourRating /
// average" — clicking either opens a small popover to submit/change
// the rating. The 1-10 scale here is intentionally minimal; richer
// fields are a later pass (real, persisted rating either way — not a
// mockup: submitting sticks, and the average is a real cross-user
// aggregate, see lib/gameRatings.js).
export function LibraryRatingButton({ rating, avgRating, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(rating || 5);

  return (
    <div className="library-rating">
      <button
        type="button"
        className={`library-rating__trigger ${rating ? "library-rating__trigger--rated" : ""}`}
        onClick={() => {
          setDraft(rating || 5);
          setOpen((o) => !o);
        }}
        title={rating ? "Change your rating" : "Rate this game"}
      >
        {rating ? `${rating}${avgRating ? ` / ${avgRating.avg}` : ""}` : "⭐"}
      </button>
      {open && (
        <div className="library-rating__popover">
          <span className="library-rating__popover-label">Your rating</span>
          <div className="library-rating__scale">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`library-rating__pip ${draft >= n ? "library-rating__pip--filled" : ""}`}
                onClick={() => setDraft(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="library-rating__popover-actions">
            <button
              type="button"
              className="library-rating__save"
              onClick={() => {
                onSubmit(draft);
                setOpen(false);
              }}
            >
              Save
            </button>
            <button type="button" className="library-rating__cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {avgRating && (
            <span className="library-rating__avg-note">
              Lykodex average: {avgRating.avg} ({avgRating.count} rating{avgRating.count === 1 ? "" : "s"})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LibrarySteamIcon({ appid, iconHash }) {
  const [failed, setFailed] = useState(false);
  if (!appid || !iconHash || failed) {
    return <span className="library-table__icon library-table__icon--placeholder" aria-hidden="true" />;
  }
  return (
    <img
      src={`https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${iconHash}.jpg`}
      alt=""
      className="library-table__icon"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function LibraryGameCard({ game, formatPlaytime }) {
  return (
    <li className="backlog-card library-game-card">
      {game.steamAppid ? (
        <SteamArt appid={game.steamAppid} className="backlog-card__thumb" alt="" loading="lazy" />
      ) : (
        <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
      )}
      <div className="backlog-card__info">
        <span className="backlog-card__title">{game.title}</span>
        <span className="backlog-card__meta">
          {game.platforms.map((platform) => (
            <PlatformTag key={platform} platform={platform} />
          ))}
          {game.totalPlaytimeMinutes > 0 && (
            <span>{formatPlaytime(game.totalPlaytimeMinutes)} played</span>
          )}
        </span>
        <LibraryDlcDropdown dlc={game.dlc} />
      </div>
    </li>
  );
}

export function LibraryGameRow({
  game, formatPlaytime,
  tags, onToggleTag, inBacklog, onAddToBacklog,
  rating, avgRating, onSubmitRating,
}) {
  return (
    <tr>
      <td>
        <div className="library-table__game">
          {game.steamAppid && game.imgIconUrl && (
            <LibrarySteamIcon appid={game.steamAppid} iconHash={game.imgIconUrl} />
          )}
          <div className="library-table__game-copy">
            <span>{game.title}</span>
            <LibraryDlcDropdown dlc={game.dlc} />
          </div>
        </div>
      </td>
      <td>
        <div className="library-table__platforms">
          {game.platforms.map((platform) => (
            <PlatformTag key={platform} platform={platform} />
          ))}
        </div>
      </td>
      <td>
        {game.platforms.map((platform) => {
          const playtime = formatPlaytime(game.playtimeMinutes[platform]);
          if (!playtime) return null;
          return (
            <span key={platform} className="library-table__playtime-line">
              {PLATFORM_LABELS[platform]} {playtime}
            </span>
          );
        }).filter(Boolean)}
        {game.totalPlaytimeMinutes === 0 && "—"}
      </td>
      <td>
        <LibraryRowActions
          tags={tags}
          onToggleTag={onToggleTag}
          inBacklog={inBacklog}
          onAddToBacklog={onAddToBacklog}
        />
      </td>
      <td>
        <LibraryRatingButton rating={rating} avgRating={avgRating} onSubmit={onSubmitRating} />
      </td>
    </tr>
  );
}
