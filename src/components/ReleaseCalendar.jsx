// Full release calendar grid + day detail — used on the dedicated page.

import { useMemo, useState } from "react";
import SteamArt from "./SteamArt";
import { useReleaseCalendar } from "../hooks/useReleaseCalendar";
import {
  RELEASE_WINDOW_DAYS,
  RELEASE_WEEKDAYS,
  buildCalendarCells,
  buildStatusTags,
  countdownLabel,
  daysUntil,
  formatDayLabel,
  formatMonthLabel,
  platformShort,
  toDateKey,
} from "../lib/releaseCalendar";

export function ReleaseArt({ entry, className, title }) {
  if (entry.appid) {
    return (
      <SteamArt
        appid={entry.appid}
        fallbackImage={entry.imageUrl}
        className={className}
        alt=""
        loading="lazy"
        title={title}
      />
    );
  }
  return (
    <span
      className={className}
      title={title}
      style={entry.imageUrl ? { backgroundImage: `url(${entry.imageUrl})` } : undefined}
      aria-hidden={title ? undefined : true}
    />
  );
}

export default function ReleaseCalendar({ wishlist, linkedSteamId, className = "" }) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState(toDateKey(now));

  const { releases, releasesByDate, status, tagContext, showEmpty } = useReleaseCalendar(
    wishlist,
    linkedSteamId
  );

  const calendarCells = useMemo(
    () => buildCalendarCells(viewYear, viewMonth, releasesByDate),
    [viewYear, viewMonth, releasesByDate]
  );

  const selectedReleases = releasesByDate.get(selectedDateKey) || [];

  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  return (
    <div className={`release-cal ${className}`.trim()}>
      {status === "loading" && <p className="panel__status">Loading upcoming releases…</p>}
      {status === "error" && (
        <p className="panel__status panel__status--error">Couldn't load upcoming releases right now.</p>
      )}
      {status === "no_key" && showEmpty && (
        <p className="panel__status">Upcoming releases aren't configured yet.</p>
      )}
      {showEmpty && status !== "error" && status !== "loading" && (
        <p className="panel__status">Nothing releasing in the next {RELEASE_WINDOW_DAYS} days.</p>
      )}

      {releases.length > 0 && (
        <>
          <div className="release-cal__nav">
            <button type="button" className="release-cal__nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <span className="release-cal__month">{formatMonthLabel(viewYear, viewMonth)}</span>
            <button type="button" className="release-cal__nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>

          <div className="release-cal__weekdays" aria-hidden="true">
            {RELEASE_WEEKDAYS.map((label) => (
              <span key={label} className="release-cal__weekday">{label}</span>
            ))}
          </div>

          <div className="release-cal__grid" role="grid" aria-label="Release calendar">
            {calendarCells.map((cell) => {
              const hasReleases = cell.releases.length > 0;
              const isSelected = cell.key === selectedDateKey;
              const extra = cell.releases.length - 2;

              return (
                <button
                  key={cell.key}
                  type="button"
                  role="gridcell"
                  className={[
                    "release-cal__day",
                    !cell.isCurrentMonth && "release-cal__day--outside",
                    cell.isToday && "release-cal__day--today",
                    hasReleases && "release-cal__day--has-releases",
                    isSelected && "release-cal__day--selected",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setSelectedDateKey(cell.key)}
                  aria-pressed={isSelected}
                  aria-label={`${formatDayLabel(cell.key)}${hasReleases ? `, ${cell.releases.length} release${cell.releases.length === 1 ? "" : "s"}` : ""}`}
                >
                  <span className="release-cal__day-num">{cell.day}</span>
                  {hasReleases && (
                    <div className="release-cal__tiles">
                      {cell.releases.slice(0, 2).map((entry) => (
                        <ReleaseArt
                          key={entry.id}
                          entry={entry}
                          className={`release-cal__tile ${entry.isSteamWishlist ? "release-cal__tile--steam" : ""} ${entry.isLykodexWishlist ? "release-cal__tile--wishlist" : ""}`}
                          title={entry.name}
                        />
                      ))}
                      {extra > 0 && <span className="release-cal__more">+{extra}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="release-cal__detail">
            <div className="release-cal__detail-head">
              <span className="release-cal__detail-date">{formatDayLabel(selectedDateKey)}</span>
              {selectedReleases.length > 0 && (
                <span className="release-cal__detail-countdown">
                  {countdownLabel(daysUntil(selectedDateKey))}
                </span>
              )}
            </div>

            {selectedReleases.length === 0 ? (
              <p className="panel__status release-cal__detail-empty">No releases on this day.</p>
            ) : (
              <ul className="release-cal__detail-list">
                {selectedReleases.map((entry) => {
                  const days = daysUntil(entry.releaseDate);
                  const tags = buildStatusTags(entry, tagContext, days);
                  const platforms = (entry.platforms || []).map(platformShort).filter(Boolean);

                  return (
                    <li key={entry.id} className="release-cal__detail-row">
                      <ReleaseArt entry={entry} className="release-cal__detail-art" />
                      <div className="release-cal__detail-body">
                        <span className="release-cal__detail-name" title={entry.name}>{entry.name}</span>
                        <div className="release-cal__detail-meta">
                          {tags.map((tag) => (
                            <span key={tag.key} className={tag.className}>{tag.label}</span>
                          ))}
                          {platforms.map((p) => (
                            <span key={p} className="tag tag--platform">{p}</span>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
