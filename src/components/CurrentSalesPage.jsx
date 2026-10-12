// Current Sales — real current discounts across every CheapShark-
// tracked store (the same data that used to sit in a sidebar on the
// Price Comparison page, now with its own dedicated spot).
// All deals here are USD-native (CheapShark), converted to whatever
// currency is currently selected (lifted to App.jsx).

import { useEffect, useState } from "react";
import { fetchTopDeals } from "../lib/cheapshark";
import SteamArt from "./SteamArt";
import { getExchangeRates, formatPrice } from "../lib/currency";
import { saleEvents, describeEventStatus } from "../data/saleEvents";

export default function CurrentSalesPage({ onBack, currency }) {
  const [deals, setDeals] = useState([]);
  const [status, setStatus] = useState("loading");
  const [rates, setRates] = useState(null);

  useEffect(() => {
    getExchangeRates().then(setRates);
    fetchTopDeals(20)
      .then((results) => {
        setDeals(results);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Current Sales failed:", err);
        setStatus("error");
      });
  }, []);

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Market</button>
        <h1 className="price-page__title">Current Sales</h1>
        <p className="price-page__subtitle">Biggest current discounts across every store you compare.</p>
      </div>

      {status === "loading" && <p className="panel__status">Loading current sales…</p>}
      {status === "error" && (
        <p className="panel__status panel__status--error">Couldn't load current sales right now.</p>
      )}

      <div className="settings-card">
        <h2 className="settings-card__title">Store-wide events</h2>
        <ul className="sale-event-list">
          {saleEvents.map((event) => {
            const { label, state } = describeEventStatus(event);
            return (
              <li key={event.name} className={`sale-event sale-event--${state}`}>
                <div className="sale-event__info">
                  <span className="sale-event__name">{event.name}</span>
                  <span className="sale-event__store">{event.store}</span>
                </div>
                <span className="sale-event__status">{label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {status === "ready" && (
        <>
          <span className="feed-col__label">Per-game discounts</span>
          <ul className="wishlist-list">
            {deals.map((deal, i) => (
              <li key={`${deal.title}-${i}`} className="wishlist-card">
                <div className="wishlist-card__main">
                  {deal.steamAppID || deal.thumb ? (
                    <SteamArt
                      appid={deal.steamAppID}
                      headerImage={deal.thumb}
                      className="wishlist-card__thumb"
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className="wishlist-card__thumb wishlist-card__thumb--placeholder" />
                  )}
                  <div className="wishlist-card__info">
                    <span className="wishlist-card__title">{deal.title}</span>
                    <span className="wishlist-card__meta">{deal.store}</span>
                  </div>
                  <div className="wishlist-card__cheapest">
                    <span className="wishlist-card__cheapest-price">{formatPrice(deal.price, "USD", rates, currency)}</span>
                    <span className="wishlist-card__cheapest-store">-{deal.savings}% off {formatPrice(deal.normalPrice, "USD", rates, currency)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
