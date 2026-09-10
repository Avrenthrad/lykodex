// Overview "Right now" stock-style chart — multi-series mastery /
// hours view: a sky area for you, lime lines per friend, rose lines
// per guildmate. User picks the metric and range; data regrows on change.
// See DESIGN_TOKENS.md `stock-style` and lib/overviewChartData.js.
//
// "You" is the primary series and uses --sky, not gold: DESIGN_TOKENS
// reserves --accent (gold) for interactive UI only, never a plotted
// line. Gold stays on the active range chip and the plot glow's warm
// edge only.
//
// On top of the base stock-style pattern this adds, matching
// docs/design-drafts/lykodex-chart-system.md and PriceHistoryChart.jsx:
//  - a headline value + change for your own line over the selected
//    range, which tracks the crosshair while you scrub;
//  - a floating date/value pill on scrub (subscribeCrosshairMove);
//  - the range's real high/low as two dashed price lines
//    (series.createPriceLine), axis-labelled by the library itself.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createChart, AreaSeries, LineSeries, LineStyle, LineType } from "lightweight-charts";
import { CHART_RANGES, loadOverviewChartData, rangeToDays } from "../lib/overviewChartData";

// Mirror the DESIGN_TOKENS values; lightweight-charts paints to a
// canvas so it can't read the CSS custom properties directly.
const SKY = "#5AA9E6";
const SKY_FILL_TOP = "rgba(90, 169, 230, 0.30)";
const SKY_FILL_BOTTOM = "rgba(90, 169, 230, 0)";
const LIME = "#8FC33D";
const ROSE = "#E8637D";
const PLOT_BG = "#0C0B09"; // --bg, for the hollow crosshair marker
const REF_LINE = "rgba(255, 255, 255, 0.26)";
const GROW_MS = 1100;
const CHART_MIN_HEIGHT = 220;

const VIEWS = [
  {
    id: "mastery",
    title: "Mastery Score",
    subtitle: "You vs each friend & guildmate",
    empty: "No Mastery Score history in this range yet — check back after a few daily snapshots.",
    valueSuffix: "",
  },
  {
    id: "hours",
    title: "Active hours",
    subtitle: "Your Steam playtime vs friends (when timestamps are available)",
    empty: "No day-level Steam playtime in this range yet.",
    valueSuffix: "h",
  },
];

function getBlock(view, payload) {
  return view.id === "mastery" ? payload.mastery : payload.hours;
}

function peerPointCount(block) {
  if (!block?.peers) return 0;
  return block.peers.reduce((sum, peer) => sum + peer.points.length, 0);
}

function hasChartData(view, payload) {
  if (!payload) return false;
  const block = getBlock(view, payload);
  return block.you.length >= 2 || peerPointCount(block) >= 2 || block.you.length + peerPointCount(block) >= 2;
}

function firstValue(points) {
  return points.length ? points[0].value : null;
}

function latestValue(points) {
  return points.length ? points[points.length - 1].value : null;
}

function peerColor(kind) {
  return kind === "guild" ? ROSE : LIME;
}

function formatValue(value, suffix) {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString()}${suffix}`;
}

function formatScrubDate(seconds) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function priceFormatFor(isHours) {
  return isHours
    ? { type: "price", precision: 1, minMove: 0.1 }
    : { type: "price", precision: 0, minMove: 1 };
}

function allValues(block) {
  const values = [];
  for (const point of block.you || []) values.push(point.value);
  for (const peer of block.peers || []) {
    for (const point of peer.points) values.push(point.value);
  }
  return values;
}

function valueRangeForBlock(block) {
  const values = allValues(block);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.1, 1);
  return { minValue: min - pad, maxValue: max + pad };
}

function autoscaleProvider(range) {
  return () => ({
    priceRange: range,
  });
}

function interpolateGrowingPoints(points, progress) {
  if (!points.length) return [];
  const eased = easeInOutCubic(progress);

  if (points.length === 1) {
    return [{ time: points[0].time, value: points[0].value * eased }];
  }

  const firstTime = points[0].time;
  const lastTime = points[points.length - 1].time;
  const span = lastTime - firstTime;

  if (eased <= 0) {
    const base = points[0].value;
    return [
      { time: firstTime, value: base },
      { time: firstTime + Math.max(1, Math.floor(span / 120)), value: base },
    ];
  }

  const cursorTime = span === 0 ? lastTime : Math.floor(lerp(firstTime, lastTime, eased));
  const out = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.time < cursorTime) {
      out.push(point);
      continue;
    }

    const prev = points[Math.max(0, i - 1)];
    const next = point;
    const segmentSpan = next.time - prev.time;
    const segmentT = segmentSpan <= 0 ? 1 : (cursorTime - prev.time) / segmentSpan;
    const tipTime = Math.max(prev.time + 1, cursorTime);

    out.push({
      time: tipTime,
      value: lerp(prev.value, next.value, Math.max(0, Math.min(1, segmentT))),
    });
    break;
  }

  if (out.length < 2) {
    const anchor = out[0] ?? points[0];
    out.push({ time: anchor.time + Math.max(1, Math.floor(span / 120)), value: anchor.value });
  }

  return out;
}

function setStableScale(api, range) {
  if (!range) return;
  const provider = autoscaleProvider(range);
  api.seriesYou?.applyOptions({ autoscaleInfoProvider: provider });
  for (const series of api.peerSeries) {
    series.applyOptions({ autoscaleInfoProvider: provider });
  }
}

function clearStableScale(api) {
  api.seriesYou?.applyOptions({ autoscaleInfoProvider: undefined });
  for (const series of api.peerSeries) {
    series.applyOptions({ autoscaleInfoProvider: undefined });
  }
}

function cancelChartGrow(api) {
  if (api.animationId) {
    cancelAnimationFrame(api.animationId);
    api.animationId = null;
  }
  clearStableScale(api);
}

// Two dashed lines at the real high/low of everything plotted in this
// range — axis-labelled by lightweight-charts itself, rebuilt on every
// data apply so they never stack up from a previous range/metric.
function applyReferenceLines(api, block) {
  for (const line of api.priceLines) api.seriesYou?.removePriceLine(line);
  api.priceLines = [];
  if (!api.seriesYou) return;
  const values = allValues(block);
  if (values.length < 2) return;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const opts = (price) => ({
    price,
    color: REF_LINE,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "",
  });
  api.priceLines.push(api.seriesYou.createPriceLine(opts(max)));
  if (min !== max) api.priceLines.push(api.seriesYou.createPriceLine(opts(min)));
}

function ensureSeriesStructure(api, block, isHours) {
  const { chart } = api;
  const priceFormat = priceFormatFor(isHours);
  const peers = block.peers || [];

  for (const line of api.priceLines) api.seriesYou?.removePriceLine(line);
  api.priceLines = [];

  if (api.seriesYou) {
    chart.removeSeries(api.seriesYou);
    api.seriesYou = null;
  }
  for (const series of api.peerSeries) chart.removeSeries(series);
  api.peerSeries = [];
  api.peerMeta = [];

  for (const peer of peers) {
    const series = chart.addSeries(LineSeries, {
      color: peerColor(peer.kind),
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat,
      title: peer.label,
    });
    api.peerSeries.push(series);
    api.peerMeta.push({ label: peer.label, kind: peer.kind, color: peerColor(peer.kind) });
  }

  api.seriesYou = chart.addSeries(AreaSeries, {
    lineWidth: 3,
    lineType: LineType.Curved,
    lineColor: SKY,
    topColor: SKY_FILL_TOP,
    bottomColor: SKY_FILL_BOTTOM,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: SKY,
    crosshairMarkerBackgroundColor: PLOT_BG,
    crosshairMarkerBorderWidth: 2,
    priceFormat,
    title: "You",
  });
}

function applyChartData(api, block) {
  for (let i = 0; i < (block.peers || []).length; i++) {
    api.peerSeries[i]?.setData(block.peers[i].points);
  }
  api.seriesYou?.setData(block.you);
  api.chart.timeScale().fitContent();
  applyReferenceLines(api, block);
}

function animateChartGrow(api, block, { reducedMotion = false, onStart, onEnd } = {}) {
  cancelChartGrow(api);
  ensureSeriesStructure(api, block, block.isHours);

  if (reducedMotion || (!block.you.length && !peerPointCount(block))) {
    applyChartData(api, block);
    onEnd?.();
    return;
  }

  const stableRange = valueRangeForBlock(block);
  setStableScale(api, stableRange);

  onStart?.();
  const start = performance.now();
  let lastFrame = 0;

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / GROW_MS);

    if (now - lastFrame >= 16 || progress >= 1) {
      lastFrame = now;

      if (api.seriesYou) {
        api.seriesYou.setData(interpolateGrowingPoints(block.you, progress));
      }
      (block.peers || []).forEach((peer, i) => {
        api.peerSeries[i]?.setData(interpolateGrowingPoints(peer.points, progress));
      });
    }

    if (progress < 1) {
      api.animationId = requestAnimationFrame(tick);
      return;
    }

    clearStableScale(api);
    applyChartData(api, block);
    api.animationId = null;
    onEnd?.();
  }

  api.animationId = requestAnimationFrame(tick);
}

export default function OverviewStockChart({ userId, linkedSteamId }) {
  const [range, setRange] = useState("week");
  const [viewIndex, setViewIndex] = useState(0);
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("loading");
  const [growing, setGrowing] = useState(false);
  const [scrub, setScrub] = useState(null); // { x, date, youValue } while hovering the plot

  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const pillRef = useRef(null);
  const apiRef = useRef(null);
  const reducedMotionRef = useRef(false);

  const view = VIEWS[viewIndex];
  const sinceDays = rangeToDays(range);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const onChange = (e) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!userId) return;
    setStatus("loading");
    loadOverviewChartData({ userId, linkedSteamId, sinceDays })
      .then((data) => {
        setPayload(data);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Overview chart data failed:", err);
        setStatus("error");
      });
  }, [userId, linkedSteamId, sinceDays]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    function plotSize() {
      return {
        width: el.clientWidth,
        height: Math.max(el.clientHeight, CHART_MIN_HEIGHT),
      };
    }

    const { width, height } = plotSize();
    const chart = createChart(el, {
      width,
      height,
      layout: { background: { color: "transparent" }, textColor: "#8C8B90", attributionLogo: false },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255, 255, 255, 0.07)", style: 2 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        visible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        visible: true,
        scaleMargins: { top: 0.16, bottom: 0.08 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "rgba(90, 169, 230, 0.4)", width: 1, style: 2, labelVisible: false },
        horzLine: { color: "rgba(255, 255, 255, 0.14)", width: 1, style: 2, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    apiRef.current = { chart, seriesYou: null, peerSeries: [], peerMeta: [], priceLines: [], animationId: null };

    const onCrosshair = (param) => {
      const api = apiRef.current;
      if (!api?.seriesYou || !param.time || !param.point) {
        setScrub(null);
        return;
      }
      const youValue = param.seriesData.get(api.seriesYou)?.value ?? null;
      setScrub({ x: param.point.x, date: formatScrubDate(param.time), youValue });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions(plotSize());
    });
    resizeObserver.observe(el);

    return () => {
      cancelChartGrow(apiRef.current);
      chart.unsubscribeCrosshairMove(onCrosshair);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!apiRef.current?.chart || !payload) return;
    const activeView = VIEWS[viewIndex];
    const block = getBlock(activeView, payload);
    if (!hasChartData(activeView, payload)) return;

    setScrub(null);
    animateChartGrow(
      apiRef.current,
      { ...block, isHours: activeView.id === "hours" },
      {
        reducedMotion: reducedMotionRef.current,
        onStart: () => setGrowing(true),
        onEnd: () => setGrowing(false),
      },
    );
  }, [payload, viewIndex]);

  // Clamp the scrub pill within the plot once it's measured.
  useLayoutEffect(() => {
    if (!scrub || !pillRef.current || !stageRef.current) return;
    const stageWidth = stageRef.current.clientWidth;
    const pillWidth = pillRef.current.offsetWidth;
    const left = Math.max(4, Math.min(scrub.x - pillWidth / 2, stageWidth - pillWidth - 4));
    pillRef.current.style.transform = `translateX(${left}px)`;
  }, [scrub]);

  if (!userId) return null;

  const block = payload ? getBlock(view, payload) : null;
  const rangeStartYou = block ? firstValue(block.you) : null;
  const latestYou = block ? latestValue(block.you) : null;
  const shownYou = scrub?.youValue ?? latestYou;
  const delta =
    rangeStartYou != null && shownYou != null ? shownYou - rangeStartYou : null;
  const deltaPct =
    delta != null && rangeStartYou ? (delta / Math.abs(rangeStartYou)) * 100 : null;
  const deltaDir = delta == null ? null : delta >= 0 ? "up" : "down";

  const friendLineCount = block?.peers?.filter((p) => p.kind === "friend").length ?? 0;
  const guildLineCount = block?.peers?.filter((p) => p.kind === "guild").length ?? 0;
  const showChart = status === "ready" && payload && hasChartData(view, payload);
  const hoursNote = view.id === "hours" && payload?.hours?.note;

  return (
    <div className="stock-style-chart overview-stock-chart">
      <div className="overview-stock-chart__chrome">
        <div className="stock-style-chart__head">
          <div className="stock-style-chart__titles">
            <span className="stock-style-chart__title">{view.title}</span>
            <span className="stock-style-chart__subtitle">{view.subtitle}</span>
          </div>

          {showChart && shownYou != null && (
            <div className="stock-style-chart__headline">
              <span className="stock-style-chart__headline-value">
                {formatValue(shownYou, view.valueSuffix)}
              </span>
              {delta != null && deltaPct != null && (
                <span className={`stock-style-chart__delta stock-style-chart__delta--${deltaDir}`}>
                  {deltaDir === "up" ? "▲" : "▼"} {formatValue(Math.abs(delta), view.valueSuffix)}
                  {" "}({Math.abs(deltaPct).toFixed(1)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {showChart && (
          <div className="stock-style-chart__legend" aria-hidden="true">
            <span className="stock-style-chart__legend-item">
              <span className="stock-style-chart__legend-dot stock-style-chart__legend-dot--you" />
              You
            </span>
            {friendLineCount > 0 && (
              <span className="stock-style-chart__legend-item">
                <span className="stock-style-chart__legend-dot stock-style-chart__legend-dot--friends" />
                Friends ({friendLineCount})
              </span>
            )}
            {guildLineCount > 0 && (
              <span className="stock-style-chart__legend-item">
                <span className="stock-style-chart__legend-dot stock-style-chart__legend-dot--guild" />
                Guild ({guildLineCount})
              </span>
            )}
          </div>
        )}

        {status === "loading" && <p className="panel__status overview-stock-chart__status">Loading chart…</p>}
        {status === "error" && <p className="panel__status panel__status--error overview-stock-chart__status">Couldn't load chart data.</p>}
        {status === "ready" && !showChart && (
          <p className="panel__status overview-stock-chart__status">
            {hoursNote || view.empty}
          </p>
        )}
      </div>

      <div
        ref={stageRef}
        className={`overview-stock-chart__plot-stage ${showChart ? "overview-stock-chart__plot-stage--live" : "overview-stock-chart__plot-stage--idle"}${growing ? " overview-stock-chart__plot-stage--growing" : ""}`}
      >
        <div
          ref={containerRef}
          className={`stock-style-chart__plot overview-stock-chart__plot ${showChart ? "" : "overview-stock-chart__plot--hidden"}`}
          aria-hidden={!showChart}
        />
        {showChart && scrub && (
          <div ref={pillRef} className="stock-style-chart__pill">
            {scrub.date}
            {scrub.youValue != null && (
              <span className="stock-style-chart__pill-value"> · {formatValue(scrub.youValue, view.valueSuffix)}</span>
            )}
          </div>
        )}
      </div>

      <div className="overview-stock-chart__footer">
        <div className="overview-stock-chart__ranges" role="tablist" aria-label="Chart time range">
          {CHART_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={range === r.id}
              className={`overview-stock-chart__range ${range === r.id ? "overview-stock-chart__range--active" : ""}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="sliding-banner__dots" role="tablist" aria-label="Chart metric">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={i === viewIndex}
              aria-label={v.title}
              className={`sliding-banner__dot ${i === viewIndex ? "sliding-banner__dot--active" : ""}`}
              onClick={() => setViewIndex(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
