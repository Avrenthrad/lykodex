// Dashboard + Market preview — next releases at a glance, links to full calendar.

import { useMemo } from "react";
import { ReleaseArt } from "./ReleaseCalendar";
import { useReleaseCalendar } from "../hooks/useReleaseCalendar";
import {
  RELEASE_WINDOW_DAYS,
  buildStatusTags,
  buildWeekStrip,
  countdownLabel,
  daysUntil,
  formatDayLabel,
  platformShort,
} from "../lib/releaseCalendar";

const PREVIEW_COUNT = 4;

export default function ReleaseCalendarCard({ wishlist, linkedSteamId, onOpenCalendar }) {
  const { releases, releasesByDate, status, tagContext, showEmpty } = useReleaseCalendar(
    wishlist,
    linkedSteamId
  );

  const previewReleases = useMemo(() => releases.slice(0, PREVIEW_COUNT), [releases]);
  const weekStrip = useMemo(() => buildWeekStrip(releasesByDate), [releasesByDate]);

  return (
    <div className="panel hero-card release-cal-preview">
      <div className="panel__head">
        <span className="panel__eyebrow">Release Calendar</span>
        <button type="button" className="linkish" onClick={onOpenCalendar}>Open calendar →</button>
      </div>

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
          <div className="release-cal-preview__weekstrip" aria-label="Next 7 days">
            {weekStrip.map((day) => (
              <div
                key={day.key}
                className={[
                  "release-cal-preview__weekday",
                  day.isToday && "release-cal-preview__weekday--today",
                  day.count > 0 && "release-cal-preview__weekday--has",
                ].filter(Boolean).join(" ")}
                title={day.count > 0 ? `${day.count} release${day.count === 1 ? "" : "s"}` : undefined}
              >
                <span className="release-cal-preview__weekday-label">{day.weekday}</span>
                <span className="release-cal-preview__weekday-num">{day.day}</span>
                {day.count > 0 && (
                  <span className="release-cal-preview__weekday-dot" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>

          <ul className="release-cal-preview__list">
            {previewReleases.map((entry) => {
              const days = daysUntil(entry.releaseDate);
              const tags = buildStatusTags(entry, tagContext, days);
              const platforms = (entry.platforms || []).map(platformShort).filter(Boolean).slice(0, 3);

              return (
                <li key={entry.id} className="release-cal-preview__row">
                  <ReleaseArt entry={entry} className="release-cal-preview__art" />
                  <div className="release-cal-preview__body">
                    <span className="release-cal-preview__name" title={entry.name}>{entry.name}</span>
                    <div className="release-cal-preview__meta">
                      <span className="release-cal-preview__when">{formatDayLabel(entry.releaseDate)}</span>
                      <span className="release-cal-preview__countdown">{countdownLabel(days)}</span>
                    </div>
                    <div className="release-cal-preview__tags">
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

          {releases.length > PREVIEW_COUNT && (
            <button type="button" className="release-cal-preview__more" onClick={onOpenCalendar}>
              +{releases.length - PREVIEW_COUNT} more in the next {RELEASE_WINDOW_DAYS} days
            </button>
          )}
        </>
      )}
    </div>
  );
}
