// Price detail + history modal for a single MTG card — every price
// shown is real (Scryfall market price, Card Kingdom real retail
// price via api/pricing.js), each labeled with its own source and,
// for Card Kingdom, a real as-of timestamp from their own pricelist
// metadata. Opening this records a real snapshot (see
// lib/tcgPricing.js) so history genuinely accumulates over time
// instead of being backfilled or invented.

import { useEffect, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { fetchCardKingdomPrices, normalizeMtgPrices, recordPriceSnapshot, fetchPriceHistory } from "../lib/tcgPricing";
import PriceHistoryChart from "./PriceHistoryChart";

const RANGES = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
];

// Real % change over whatever real history exists in the current
// range — never shown for <2 points, since there's nothing real to
// compare. Exported so MtgPriceWatchPage's per-row summary uses the
// exact same math instead of a second, possibly-drifting copy.
export function PriceChangeBadge({ history }) {
  const first = Number(history[0]?.price);
  const last = Number(history[history.length - 1]?.price);
  if (!first || !last) return null;
  const pct = ((last - first) / first) * 100;
  const up = pct >= 0;
  return (
    <span
      className="price-badge__value"
      style={{ color: up ? "#22c55e" : "#E8283D", marginLeft: "auto" }}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function MtgPriceHistoryModal({ card, onClose }) {
  useEscapeKey(onClose);
  const [prices, setPrices] = useState([]);
  const [status, setStatus] = useState("loading");
  const [range, setRange] = useState(30);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchCardKingdomPrices([card.id])
      .then(async ({ results, asOf }) => {
        if (cancelled) return;
        const normalized = normalizeMtgPrices(card, results?.[card.id], asOf);
        setPrices(normalized);
        setStatus("ready");

        // Record a real observation for every real price this card
        // actually has right now — fire-and-forget, never blocks the UI.
        await Promise.all(
          normalized.map((p) =>
            recordPriceSnapshot({ scryfallId: card.id, source: p.source, market: p.market, price: p.low, foil: p.foil, currency: p.currency })
          )
        ).catch((err) => console.error("Failed to record price snapshots:", err));
      })
      .catch((err) => {
        console.error("Failed to load Card Kingdom price:", err);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Depending on card.id (a stable primitive) rather than the whole
    // card object on purpose — a new object reference from the parent
    // on every render would otherwise re-fetch/re-record needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    let cancelled = false;
    setHistoryStatus("loading");
    fetchPriceHistory(card.id, range)
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);
        setHistoryStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load price history:", err);
        if (!cancelled) setHistoryStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, range, status]);

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="price-history-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Price history for ${card.name}`}>
        <div className="price-history-modal__head">
          {card.imageSmall && <img src={card.imageSmall} alt="" className="price-history-modal__thumb" decoding="async" />}
          <div>
            <h2 className="price-history-modal__title">{card.name}</h2>
            <p className="price-history-modal__meta">{card.setName} · {card.setCode?.toUpperCase()}</p>
          </div>
          <button type="button" className="dash-header__icon-btn" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto" }}>✕</button>
        </div>

        {status === "loading" && <p className="panel__status">Loading real prices…</p>}
        {status === "error" && <p className="panel__status panel__status--error">Couldn't load Card Kingdom's price right now — Scryfall's price still shown below if available.</p>}

        {prices.length === 0 && status === "ready" && (
          <p className="panel__status">No real price data available for this printing right now.</p>
        )}

        <div className="price-history-modal__badges">
          {prices.map((p, i) => (
            <div key={i} className="price-badge">
              <span className="price-badge__value">${p.low.toFixed(2)} {p.currency}</span>
              <span className="price-badge__meta">
                {p.market}{p.foil ? " · Foil" : ""}{p.asOf ? ` · as of ${new Date(p.asOf).toLocaleDateString()}` : ""}
              </span>
            </div>
          ))}
        </div>

        <div className="price-history-modal__range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`quickdash-reset-btn ${range === r.id ? "quickdash-reset-btn--active" : ""}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
          {historyStatus === "ready" && history.length >= 2 && (
            <PriceChangeBadge history={history} />
          )}
        </div>

        {historyStatus === "loading" && <p className="panel__status">Loading history…</p>}
        {historyStatus === "ready" && history.length < 2 && (
          <p className="panel__status">
            Price history is just starting to build — this app doesn't backfill or invent past prices, so real history accumulates from here.
          </p>
        )}
        {historyStatus === "ready" && history.length >= 2 && <PriceHistoryChart snapshots={history} />}

        <a href="https://www.cardkingdom.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
          Retail pricing via Card Kingdom · card data via Scryfall
        </a>
      </div>
    </div>
  );
}
