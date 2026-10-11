// Floating game card popup — used from Hype Charts so clicking a game
// shows a quick price card without leaving the page. Deliberately the
// same lightweight tier as search results (thumbnail, cheapest price,
// primary store row, wishlist toggle) rather than the full wishlist
// card's extra data (release date, Metacritic, reviews, Xbox
// platform/Game Pass badges) — those need extra API calls per game,
// which isn't worth it just for a quick popup preview.

import { useEffect, useState } from "react";
import { fetchGameDeal } from "../lib/gameData";
import { getExchangeRates, formatPrice } from "../lib/currency";
import { buildStoreRow, getCheapestInfo } from "./price/priceUtils";
import { StoreChip } from "./price/StoreChip";
import WishlistToggle from "./WishlistToggle";
import { useEscapeKey } from "../hooks/useEscapeKey";

export default function GameCardPopup({
  gameTitle,
  onClose,
  wishlist,
  onAddToWishlist,
  onRemoveFromWishlist,
  currency,
  isLoggedIn,
  onSignIn,
  onCreateAccount,
  platformOrder,
}) {
  useEscapeKey(onClose);
  const [deal, setDeal] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [rates, setRates] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getExchangeRates().then((r) => !cancelled && setRates(r));

    fetchGameDeal(gameTitle)
      .then((result) => {
        if (cancelled) return;
        setDeal(result);
        setStatus(result ? "ready" : "error");
      })
      .catch((err) => {
        console.error("Game card popup lookup failed:", err);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [gameTitle]);

  const isWishlisted = deal
    ? wishlist.some((e) => e.title.toLowerCase() === deal.game.toLowerCase())
    : false;

  const cheapest = deal && deal.stores.length > 0 ? getCheapestInfo(deal, undefined, rates) : null;
  // Hype Charts specifically shows just the top 3 preferred platforms
  // (Account Settings > Platform Preferences) rather than the full
  // row — this is a quick popup preview, not the full Store Tracker
  // page, so keeping it tight to what the person said they actually
  // care about most.
  const { primary: fullPrimary } = deal && deal.stores.length > 0 ? buildStoreRow(deal, undefined, platformOrder) : { primary: [] };
  const primary = fullPrimary.slice(0, 3);

  return (
    <div className="game-popup-backdrop" onClick={onClose}>
      <div
        className="game-popup"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={gameTitle}
      >
        <button type="button" className="game-popup__close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {status === "loading" && <p className="panel__status">Loading {gameTitle}…</p>}
        {status === "error" && (
          <p className="panel__status panel__status--error">Couldn't find pricing for {gameTitle}.</p>
        )}

        {status === "ready" && deal && (
          <>
            <div className="wishlist-card__main">
              {deal.thumb ? (
                <img src={deal.thumb} alt="" className="wishlist-card__thumb" decoding="async" />
              ) : (
                <div className="wishlist-card__thumb wishlist-card__thumb--placeholder" />
              )}

              <div className="wishlist-card__info">
                <span className="wishlist-card__title">{deal.game}</span>
              </div>

              {cheapest ? (
                <div className="wishlist-card__cheapest">
                  {cheapest.rrp > cheapest.price && (
                    <span className="wishlist-card__rrp">
                      {formatPrice(cheapest.rrp, cheapest.nativeCurrency, rates, currency)}
                    </span>
                  )}
                  <span className="wishlist-card__cheapest-price">
                    {formatPrice(cheapest.price, cheapest.nativeCurrency, rates, currency)}
                  </span>
                  <span className="wishlist-card__cheapest-store">{cheapest.store}</span>
                </div>
              ) : (
                <span className="panel__status">Add to wishlist for full pricing</span>
              )}

              <WishlistToggle
                isWishlisted={isWishlisted}
                onAdd={() => onAddToWishlist(deal.game)}
                onRemove={() => onRemoveFromWishlist(deal.game)}
                isLoggedIn={isLoggedIn}
                onSignIn={onSignIn}
                onCreateAccount={onCreateAccount}
              />
            </div>

            {primary.length > 0 && (
              <div className="store-row">
                {primary.map((s) => (
                  <StoreChip key={s.name} {...s} rates={rates} currency={currency} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
