// Friends tab centerpiece — a TradingView-style area chart (same
// lightweight-charts usage as PriceHistoryChart.jsx: AreaSeries,
// green/red colored by real trend) that rotates through your friends'
// Overall Mastery Score over time, one friend at a time.
//
// Real history only — overall_mastery_score itself has always been a
// live-computed, current-value-only column on profiles; the
// mastery_score_history table + daily snapshot cron (see the
// add_mastery_score_history migration) is what actually gives it a
// time series. A freshly-active friend legitimately has 1 data point,
// and this says so honestly rather than faking a curve.
//
// The chart instance itself is created ONCE and kept alive across
// rotations — only its data is swapped via series.setData() when the
// active friend changes, not torn down and recreated every few
// seconds (that would be wasteful and would visibly flash/reflow).
// The crossfade you see between friends is a CSS opacity transition
// on the wrapper, timed so the instant data-swap happens while it's
// invisible — same "swap while faded out" trick used elsewhere for
// rotating content (see SlidingBanner.jsx), just done manually here
// since a live chart can't be unmounted/remounted like plain markup.

import { useEffect, useRef, useState } from "react";
import { createChart, AreaSeries } from "lightweight-charts";
import { fetchFriends, fetchFriendsMasteryHistory } from "../lib/friends";
import { tierFromScore } from "../lib/masteryTiers";
import MiniAvatar from "./MiniAvatar";

const UP_COLOR = "#22c55e";
const DOWN_COLOR = "#E8283D";
const HOLD_MS = 4200;
const FADE_MS = 380;

function displayName(profile) {
  if (!profile) return "A friend";
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  return full || profile?.username || "A friend";
}

export default function FriendMasteryChart({ userId }) {
  const [series, setSeries] = useState([]); // [{ friendId, profile, points }]
  const [status, setStatus] = useState("loading");
  const [index, setIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [paused, setPaused] = useState(false);

  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let lastFetch = Date.now();

    function applyRows(friends, rows) {
      const byUser = new Map();
      for (const row of rows) {
        if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
        byUser.get(row.user_id).push(row);
      }

      return friends
        .filter((f) => byUser.has(f.friend_id))
        .map((f) => {
          // Collapse same-second duplicates — lightweight-charts
          // requires strictly-increasing time values per point (see
          // PriceHistoryChart.jsx for the same handling).
          const bySecond = new Map();
          for (const r of byUser.get(f.friend_id)) {
            const time = Math.floor(new Date(r.recorded_at).getTime() / 1000);
            bySecond.set(time, Number(r.overall_mastery_score));
          }
          const points = [...bySecond.entries()].sort(([a], [b]) => a - b).map(([time, value]) => ({ time, value }));
          return { friendId: f.friend_id, profile: f.profile, points };
        })
        .filter((s) => s.points.length > 0);
    }

    function load({ quiet }) {
      if (!quiet) setStatus("loading");
      fetchFriends(userId)
        .then(async (friends) => {
          const friendIds = friends.map((f) => f.friend_id);
          const rows = await fetchFriendsMasteryHistory(friendIds);
          if (cancelled) return;
          setSeries(applyRows(friends, rows));
          setStatus("ready");
          lastFetch = Date.now();
        })
        .catch((err) => {
          console.error("Failed to load friends' Mastery Score history:", err);
          if (!cancelled && !quiet) setStatus("error");
        });
    }

    load({ quiet: false });

    function refreshIfVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetch < 60000) return;
      load({ quiet: true });
    }
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [userId]);

  // Chart lifecycle — created once on mount (this container div is
  // always rendered below, regardless of status, precisely so this
  // never fires before containerRef.current exists).
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 160,
      layout: { background: { color: "transparent" }, textColor: "#8C8B90", attributionLogo: false },
      grid: { vertLines: { color: "rgba(255,255,255,0.06)" }, horzLines: { color: "rgba(255,255,255,0.06)" } },
      timeScale: { borderColor: "rgba(255,255,255,0.12)" },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
    });
    const areaSeries = chart.addSeries(AreaSeries, { lineWidth: 2 });
    apiRef.current = { chart, series: areaSeries };

    // ResizeObserver, not just a window resize listener — this card
    // sits in a plain page flow, so its width can also change from
    // sibling content loading in or the panel's own layout settling,
    // neither of which fires a window resize event.
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Clamp whenever the underlying list shrinks (e.g. a refetch after
  // userId changes returns fewer friends) so index never points past
  // the end — same safety net as SlidingBanner.jsx.
  useEffect(() => {
    if (index >= series.length) setIndex(0);
  }, [series.length, index]);

  const current = series[index] || null;

  useEffect(() => {
    if (!apiRef.current || !current) return;
    const { points } = current;
    const first = points[0]?.value;
    const last = points[points.length - 1]?.value;
    const trendColor = first != null && last != null && last < first ? DOWN_COLOR : UP_COLOR;
    apiRef.current.series.applyOptions({
      lineColor: trendColor,
      topColor: `${trendColor}33`,
      bottomColor: `${trendColor}00`,
    });
    apiRef.current.series.setData(points);
    apiRef.current.chart.timeScale().fitContent();
  }, [current]);

  // Hold -> fade out -> advance to next friend -> fade in, looping —
  // same shape as CollegeMorphHero/SlidingBanner.
  useEffect(() => {
    if (paused || series.length < 2) return;
    if (!fadeOut) {
      const t = setTimeout(() => setFadeOut(true), HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % series.length);
      setFadeOut(false);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [fadeOut, paused, series.length]);

  if (!userId) return null;

  const name = displayName(current?.profile);
  const points = current?.points ?? [];
  const first = points[0]?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  const delta = last - first;
  const up = delta >= 0;

  return (
    <div
      className="panel friend-mastery-chart"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="panel__head">
        <span className="panel__eyebrow">Mastery Score</span>
      </div>

      {status === "loading" && <p className="panel__status">Loading friends' Mastery Score history…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load Mastery Score history right now.</p>}
      {status === "ready" && series.length === 0 && (
        <p className="panel__status">No Mastery Score history yet — check back after your friends have been active for a day or two.</p>
      )}

      {status === "ready" && current && (
        <div className={`friend-mastery-chart__body ${fadeOut ? "friend-mastery-chart__body--out" : ""}`}>
          <div className="friend-mastery-chart__head">
            <MiniAvatar profile={current.profile} />
            <div className="friend-mastery-chart__info">
              <span className="friend-mastery-chart__name">
                {name}
                <span
                  className="tag tag--platform"
                  style={{ marginLeft: "8px", color: tierFromScore(last).color, borderColor: tierFromScore(last).color }}
                >
                  {tierFromScore(last).label}
                </span>
              </span>
              <span className={`friend-mastery-chart__delta ${up ? "friend-mastery-chart__delta--up" : "friend-mastery-chart__delta--down"}`}>
                {Math.round(last).toLocaleString()}
                <span aria-hidden="true">{up ? " ▲ " : " ▼ "}</span>
                {Math.abs(Math.round(delta)).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Always mounted (see the chart-lifecycle effect above) — never
          conditionally rendered based on status/series. */}
      <div ref={containerRef} className="friend-mastery-chart__canvas" />

      {status === "ready" && series.length > 1 && (
        <div className="sliding-banner__dots" role="tablist" aria-label="Friends">
          {series.map((s, i) => (
            <button
              key={s.friendId}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`sliding-banner__dot ${i === index ? "sliding-banner__dot--active" : ""}`}
              onClick={() => {
                setIndex(i);
                setFadeOut(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
