// Price Watch — real price trends across the whole MTG collection at
// once, like a stock-watch list, instead of one card at a time via
// MtgPriceHistoryModal. Reuses that same modal for the full-detail
// view when a row is clicked, and the same real data sources (Card
// Kingdom + Scryfall current prices, tcg_price_snapshots history) —
// nothing here is a second, parallel pricing system.
//
// Visiting this page also records a real snapshot for every owned
// card's current price (same fire-and-forget lib/tcgPricing.js
// recordPriceSnapshot the modal already uses) — that's what makes
// "any of your products" genuinely true over time. Without it, only
// cards someone had individually opened before would ever have real
// history; a first-ever visit here would otherwise show every row as
// "just starting to build" forever, even for cards owned for months.

import { useEffect, useMemo, useState } from "react";
import { fetchCollection, enrichCollectionEntry } from "../lib/mtg";
import {
  fetchCardKingdomPrices,
  normalizeMtgPrices,
  fetchPriceHistoryForCards,
  recordPriceSnapshot,
} from "../lib/tcgPricing";
import MtgPriceHistoryModal, { PriceChangeBadge } from "./MtgPriceHistoryModal";
import PriceHistoryChart from "./PriceHistoryChart";

const RANGES = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
];

// api/pricing.js's Card Kingdom mode caps at 75 ids per request
// (confirmed in that file) — chunk larger collections instead of
// silently truncating to the first 75.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The current price this row sorts/displays by — prefers a real Card
// Kingdom retail price, falls back to Scryfall's market price, same
// preference order MtgPriceHistoryModal's own badge list renders in.
function currentPrice(prices) {
  const ck = prices.find((p) => p.source === "cardkingdom" && !p.foil);
  const scry = prices.find((p) => p.source === "scryfall" && !p.foil);
  return (ck || scry || prices[0])?.low ?? null;
}

function percentChange(history) {
  const first = Number(history[0]?.price);
  const last = Number(history[history.length - 1]?.price);
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

export default function MtgPriceWatchPage({ onBack, userId, onGoToSearch }) {
  const [entries, setEntries] = useState([]);
  const [pricesByCard, setPricesByCard] = useState({});
  const [historyByCard, setHistoryByCard] = useState({});
  const [status, setStatus] = useState("loading");
  const [range, setRange] = useState(30);
  const [detailCard, setDetailCard] = useState(null);

  useEffect(() => {
    if (!userId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (entries.length === 0) return;
    fetchPriceHistoryForCards(entries.map((e) => e.card.id), range)
      .then(setHistoryByCard)
      .catch((err) => console.error("Failed to load price history for collection:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, range]);

  async function load() {
    setStatus("loading");
    try {
      const rows = await fetchCollection(userId);
      const enriched = await Promise.all(rows.map(enrichCollectionEntry));
      const owned = enriched.filter((e) => e.card);
      setEntries(owned);

      const ids = [...new Set(owned.map((e) => e.card.id))];
      const priceMap = {};
      for (const idGroup of chunk(ids, 75)) {
        const { results, asOf } = await fetchCardKingdomPrices(idGroup);
        for (const id of idGroup) {
          const entry = owned.find((e) => e.card.id === id);
          if (entry) priceMap[id] = normalizeMtgPrices(entry.card, results?.[id], asOf);
        }
      }
      setPricesByCard(priceMap);
      setStatus("ready");

      // Fire-and-forget — start real history for every owned card's
      // current price, exactly like opening the single-card modal
      // already does, just for the whole collection at once.
      for (const id of ids) {
        const prices = priceMap[id] || [];
        for (const p of prices) {
          recordPriceSnapshot({ scryfallId: id, source: p.source, market: p.market, price: p.low, foil: p.foil, currency: p.currency });
        }
      }
    } catch (err) {
      console.error("Failed to load Price Watch:", err);
      setStatus("error");
    }
  }

  const rows = useMemo(() => {
    return entries
      .map((entry) => {
        const prices = pricesByCard[entry.card.id] || [];
        const history = historyByCard[entry.card.id] || [];
        return {
          entry,
          price: currentPrice(prices),
          history,
          pct: percentChange(history),
        };
      })
      .sort((a, b) => {
        if (a.pct == null && b.pct == null) return 0;
        if (a.pct == null) return 1;
        if (b.pct == null) return -1;
        return Math.abs(b.pct) - Math.abs(a.pct);
      });
  }, [entries, pricesByCard, historyByCard]);

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to TCG</button>
        <h1 className="price-page__title">Price Watch</h1>
        <p className="price-page__subtitle">
          Real price trends across your whole collection — like a stock chart, built from real
          recorded prices, never backfilled.
        </p>
      </div>

      {status === "loading" && <p className="panel__status">Loading your collection's prices…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load Price Watch right now.</p>}

      {status === "ready" && entries.length === 0 && (
        <>
          <p className="panel__status">No cards in your collection yet — add some first.</p>
          <div className="backlog-add">
            <button type="button" className="quickdash-reset-btn" onClick={onGoToSearch}>+ Search &amp; add</button>
          </div>
        </>
      )}

      {status === "ready" && entries.length > 0 && (
        <>
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
          </div>

          <ul className="backlog-list">
            {rows.map(({ entry, price, history, pct }) => (
              <li
                key={entry.id}
                className="backlog-card price-watch-row"
                onClick={() => setDetailCard(entry.card)}
                role="button"
                tabIndex={0}
                aria-label={`Price history for ${entry.card.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetailCard(entry.card);
                  }
                }}
              >
                {entry.card.imageSmall ? (
                  <img src={entry.card.imageSmall} alt="" className="backlog-card__thumb" loading="lazy" decoding="async" />
                ) : (
                  <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
                )}
                <div className="backlog-card__info">
                  <span className="backlog-card__title">{entry.card.name}</span>
                  <span className="backlog-card__meta">
                    {entry.card.setName} · {entry.card.setCode?.toUpperCase()}
                    {entry.foil ? " · Foil" : ""} · Qty {entry.quantity}
                  </span>
                </div>

                <div className="price-watch-row__spark">
                  {history.length >= 2 ? (
                    <PriceHistoryChart snapshots={history} compact />
                  ) : (
                    <span className="panel__status" style={{ fontSize: "11px" }}>Not enough history yet</span>
                  )}
                </div>

                <div className="price-watch-row__value">
                  <span className="price-badge__value">{price != null ? `$${price.toFixed(2)}` : "—"}</span>
                  {history.length >= 2 && pct != null && <PriceChangeBadge history={history} />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {detailCard && <MtgPriceHistoryModal card={detailCard} onClose={() => setDetailCard(null)} />}

      <a href="https://www.cardkingdom.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Retail pricing via Card Kingdom · card data via Scryfall
      </a>
    </div>
  );
}
