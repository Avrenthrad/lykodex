import { useState } from "react";
import SteamArt from "../SteamArt";
import { formatPrice } from "../../lib/currency";
import WishlistToggle from "../WishlistToggle";
import hltbLogo from "../../assets/hltb-logo.png";
import { StoreChip } from "./StoreChip";
import {
  buildStoreRow,
  getCheapestInfo,
  hltbLinkFor,
  relativeTime,
  steamReviewStyle,
} from "./priceUtils";

/**
 * One wishlist entry — a compact, square-ish grid card (image on top,
 * everything else stacked below) so it fits well in Market's 4-column
 * layout. Store comparison is collapsed behind one toggle by default
 * since a narrow column can't comfortably show 7+ store chips at once.
 */
export default function WishlistCard({
  entry,
  deal,
  players,
  meta,
  rates,
  currency,
  onRemove,
  error,
  onRetry,
  isLoggedIn,
  onSignIn,
  onCreateAccount,
  platformOrder,
}) {
  const [showStores, setShowStores] = useState(false);
  const [showPhysical, setShowPhysical] = useState(false);

  if (error) {
    const isRateLimit = error.toLowerCase().includes("rate limit");
    return (
      <li className="wishlist-card wishlist-card--loading">
        {isRateLimit ? (
          <span className="panel__status panel__status--warning">
            {entry.title}: Pricing is temporarily rate-limited. This clears up on its own —
            avoid repeatedly retrying, as that can extend the wait.
          </span>
        ) : (
          <span className="panel__status panel__status--error">
            {entry.title}: {error}
          </span>
        )}
        <button type="button" className="store-row-toggle" onClick={() => onRetry(entry.title)}>
          Retry
        </button>
      </li>
    );
  }

  if (!deal) {
    return (
      <li className="wishlist-card wishlist-card--loading">
        <span className="panel__status">Loading {entry.title}…</span>
      </li>
    );
  }

  const {
    primary: primaryChips,
    physical: physicalChips,
    secondary: secondaryChips,
  } = buildStoreRow(deal, meta, platformOrder);
  const cheapest = getCheapestInfo(deal, meta, rates);
  const storeCount = [...primaryChips, ...secondaryChips].filter((s) => s.state === "price").length;

  return (
    <li className="wishlist-card">
      <div className="wishlist-card__thumb-wrap">
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
        <a
          href={hltbLinkFor(deal.game)}
          target="_blank"
          rel="noopener noreferrer"
          className="hltb-badge"
          title="How long to beat this — opens HowLongToBeat"
        >
          <img src={hltbLogo} alt="HowLongToBeat" className="hltb-badge__icon" decoding="async" />
        </a>
        <div className="wishlist-card__toggle-overlay">
          <WishlistToggle
            isWishlisted
            onRemove={() => onRemove(deal.game)}
            isLoggedIn={isLoggedIn}
            onSignIn={onSignIn}
            onCreateAccount={onCreateAccount}
          />
        </div>
        {meta?.comingSoon && <span className="score-badge score-badge--preorder wishlist-card__preorder-badge">Preorder</span>}
      </div>

      <div className="wishlist-card__body">
        <span className="wishlist-card__title">{deal.game}</span>
        <span className="wishlist-card__meta">
          Added {relativeTime(entry.addedAt)}
          {typeof players === "number" && ` · ${players.toLocaleString()} playing now`}
        </span>
        <span className="wishlist-card__lowest">
          Lowest ever {formatPrice(deal.lowest, "USD", rates, currency)} · {deal.lowestDate}
        </span>
        {meta?.releaseDate && (
          <span className="wishlist-card__release">
            {meta.comingSoon ? "Releases " : "Released "}{meta.releaseDate}
          </span>
        )}

        {(meta?.metacriticScore != null || meta?.scoreDesc) && (
          <div className="wishlist-card__scores">
            {meta.metacriticScore != null && (
              <a
                href={meta.metacriticUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`score-badge score-badge--metacritic ${
                  meta.metacriticScore >= 75
                    ? "score-badge--good"
                    : meta.metacriticScore >= 50
                      ? "score-badge--mid"
                      : "score-badge--low"
                }`}
              >
                Metacritic {meta.metacriticScore}
              </a>
            )}
            {meta.scoreDesc && (
              <span
                className="score-badge score-badge--steam"
                style={steamReviewStyle(meta)}
              >
                Steam: {meta.scoreDesc}
              </span>
            )}
          </div>
        )}

        <div className="wishlist-card__cheapest">
          {cheapest?.rrp > cheapest?.price && (
            <span className="wishlist-card__rrp">
              {formatPrice(cheapest.rrp, cheapest.nativeCurrency, rates, currency)}
            </span>
          )}
          <span className="wishlist-card__cheapest-price">
            {formatPrice(cheapest?.price, cheapest?.nativeCurrency, rates, currency)}
          </span>
          <span className="wishlist-card__cheapest-store">{cheapest?.store}</span>
        </div>

        <button
          type="button"
          className="store-row-toggle"
          onClick={() => setShowStores(!showStores)}
          aria-expanded={showStores}
        >
          {showStores ? "Hide store comparison ▲" : `Compare ${storeCount} stores ▾`}
        </button>

        {showStores && (
          <>
            <div className="store-row">
              {primaryChips.map((s) => (
                <StoreChip key={s.name} {...s} rates={rates} currency={currency} />
              ))}
            </div>

            <button
              type="button"
              className="store-row-toggle"
              onClick={() => setShowPhysical(!showPhysical)}
              aria-expanded={showPhysical}
            >
              {showPhysical
                ? "Hide physical retailers ▲"
                : `Physical retailers (${physicalChips.length}) ▾`}
            </button>

            {showPhysical && (
              <div className="store-row">
                {physicalChips.map((s) => (
                  <StoreChip key={s.name} {...s} rates={rates} currency={currency} />
                ))}
              </div>
            )}

            {secondaryChips.length > 0 && (
              <div className="store-row">
                {secondaryChips.map((s) => (
                  <StoreChip key={s.name} {...s} rates={rates} currency={currency} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
