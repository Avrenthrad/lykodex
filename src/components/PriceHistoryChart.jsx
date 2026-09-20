// Real price history chart via lightweight-charts (TradingView's own
// open-source lib) — renders whatever real snapshots this app has
// actually recorded for a card. No backfilled/fabricated data: a
// freshly-tracked card legitimately starts with 0-1 points, and this
// says so honestly instead of faking a curve.
//
// Stock-chart styling: a filled area (AreaSeries, not a bare line),
// colored by the REAL trend in the data passed in — green if the
// latest real snapshot is at or above the first one in range, red if
// it's below. This app has no other "gain/loss" concept anywhere else,
// so these two colors are introduced specifically for this purpose
// rather than reusing an unrelated existing token.
//
// compact=true renders a small axis-free sparkline (used by
// MtgPriceWatchPage's per-row trend at a glance) instead of the full
// chart with visible price/time scales (used by MtgPriceHistoryModal).
//
// Full (non-compact) mode also reads two things straight off the real
// plotted data, no extra fetch:
//  - a scrub read-out: dragging/hovering snaps the crosshair to the
//    nearest real point and shows its date + price in a floating pill
//    (see docs/design-drafts/lykodex-chart-system.md for the reference
//    this was scoped down from — no fabricated grade/pop tabs, this
//    app doesn't track those).
//  - the range's real high/low as two dashed price lines, labelled on
//    the axis via lightweight-charts' own createPriceLine — not a
//    second custom-drawn grid.
// Both are skipped in compact mode, same as the axes/legend already are.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createChart, AreaSeries, LineStyle } from "lightweight-charts";

const UP_COLOR = "#22c55e";
const DOWN_COLOR = "#E8283D";

function formatScrubDate(seconds) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PriceHistoryChart({ snapshots, compact = false }) {
  const containerRef = useRef(null);
  const pillRef = useRef(null);
  const apiRef = useRef(null);
  const height = compact ? 48 : 200;
  const [scrub, setScrub] = useState(null); // { x, label } while hovering/dragging, else null

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { color: "transparent" }, textColor: "#8C8B90", attributionLogo: false },
      grid: {
        vertLines: { color: compact ? "transparent" : "rgba(255,255,255,0.06)" },
        horzLines: { color: compact ? "transparent" : "rgba(255,255,255,0.06)" },
      },
      timeScale: { borderColor: "rgba(255,255,255,0.12)", visible: !compact },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)", visible: !compact },
      crosshair: { mode: 1 },
      handleScroll: !compact,
      handleScale: !compact,
    });
    const series = chart.addSeries(AreaSeries, { lineWidth: 2 });
    apiRef.current = { chart, series, priceLines: [] };

    let crosshairHandler = null;
    if (!compact) {
      crosshairHandler = (param) => {
        if (!param.time || !param.point) {
          setScrub(null);
          return;
        }
        const value = param.seriesData.get(series)?.value;
        if (value == null) {
          setScrub(null);
          return;
        }
        setScrub({ x: param.point.x, label: `${formatScrubDate(param.time)} · $${value.toFixed(2)}` });
      };
      chart.subscribeCrosshairMove(crosshairHandler);
    }

    function handleResize() {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (crosshairHandler) chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  useEffect(() => {
    if (!apiRef.current) return;
    const { series } = apiRef.current;
    // lightweight-charts requires strictly-increasing time values per
    // point. Real snapshots recorded moments apart (e.g. Scryfall's
    // usd/usd_foil and several Card Kingdom entries for one card, all
    // captured in the same batch) can land in the same whole second
    // once floored here — collapse those into one point (keeping the
    // last real value at that second) instead of crashing.
    const bySecond = new Map();
    for (const s of snapshots) {
      const time = Math.floor(new Date(s.captured_at).getTime() / 1000);
      bySecond.set(time, Number(s.price));
    }
    const data = [...bySecond.entries()]
      .sort(([a], [b]) => a - b)
      .map(([time, value]) => ({ time, value }));

    const first = data[0]?.value;
    const last = data[data.length - 1]?.value;
    const trendColor = first != null && last != null && last < first ? DOWN_COLOR : UP_COLOR;
    series.applyOptions({
      lineColor: trendColor,
      topColor: `${trendColor}33`,
      bottomColor: `${trendColor}00`,
    });

    series.setData(data);
    apiRef.current.chart.timeScale().fitContent();

    // Real high/low of what's actually plotted — two dashed price
    // lines, axis-labelled by the library itself. Rebuilt every time
    // the data changes; never left stacking up from a previous range.
    for (const line of apiRef.current.priceLines) series.removePriceLine(line);
    apiRef.current.priceLines = [];
    if (!compact && data.length >= 2) {
      const values = data.map((d) => d.value);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const lineOpts = (price) => ({
        price,
        color: "rgba(255,255,255,0.28)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
      });
      apiRef.current.priceLines.push(series.createPriceLine(lineOpts(max)));
      if (min !== max) apiRef.current.priceLines.push(series.createPriceLine(lineOpts(min)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, compact]);

  // Position the pill after it's measured, clamped so it never runs
  // past the chart's edges however close to the side you scrub.
  useLayoutEffect(() => {
    if (!scrub || !pillRef.current || !containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const pillWidth = pillRef.current.offsetWidth;
    const left = Math.max(4, Math.min(scrub.x - pillWidth / 2, containerWidth - pillWidth - 4));
    pillRef.current.style.transform = `translateX(${left}px)`;
  }, [scrub]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div ref={containerRef} style={{ width: "100%" }} />
      {scrub && (
        <div ref={pillRef} className="price-history-chart__pill">
          {scrub.label}
        </div>
      )}
    </div>
  );
}
