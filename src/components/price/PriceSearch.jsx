import { useRef, useState } from "react";
import { formatPrice } from "../../lib/currency";
import { searchRawgGamesAndDlc } from "../../lib/rawg";
import { fetchGameDeal } from "../../lib/gameData";
import WishlistToggle from "../WishlistToggle";
import SteamArt from "../SteamArt";
import { StoreChip } from "./StoreChip";
import { buildStoreRow, getCheapestInfo } from "./priceUtils";

/**
 * Search bar, typeahead suggestions, and search-result cards.
 * Discovery uses RAWG (lib/rawg.js) — same cross-platform + DLC
 * search as Backlog — since Steam's own search only finds Steam
 * titles. Parent owns the heavier enrichment (Xbox/PS/Steam meta)
 * via onEnrich so search cards share the same metaByTitle cache.
 */
export default function PriceSearch({
  wishlist,
  onAddToWishlist,
  onRemoveFromWishlist,
  isLoggedIn,
  onSignIn,
  onCreateAccount,
  currency,
  rates,
  platformOrder,
  metaByTitle,
  onEnrich,
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchStatus, setSearchStatus] = useState("idle"); // idle | loading | done | error
  const [rawgResults, setRawgResults] = useState([]);
  const [dealsByTitle, setDealsByTitle] = useState({});
  const debounceRef = useRef(null);

  const wishlistTitles = wishlist.map((entry) => entry.title);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchRawgGamesAndDlc(value.trim(), wishlistTitles)
        .then((matches) => {
          if (matches === "no_key" || !Array.isArray(matches)) {
            setSuggestions([]);
            return;
          }
          setSuggestions(matches.slice(0, 6));
          setShowSuggestions(true);
        })
        .catch(() => {});
    }, 300);
  }

  async function runSearch(title) {
    setShowSuggestions(false);
    setSearchStatus("loading");
    setRawgResults([]);
    setDealsByTitle({});

    try {
      const results = await searchRawgGamesAndDlc(title, wishlistTitles);
      if (results === "no_key") {
        setSearchStatus("error");
        return;
      }
      if (results.length === 0) {
        setSearchStatus("error");
        return;
      }

      setRawgResults(results);

      const dealEntries = await Promise.all(
        results.map(async (result) => {
          try {
            const deal = await fetchGameDeal(result.name);
            return deal ? [result.name, deal] : null;
          } catch {
            return null;
          }
        })
      );
      const deals = Object.fromEntries(dealEntries.filter(Boolean));
      setDealsByTitle(deals);
      setSearchStatus("done");
      onEnrich?.(Object.values(deals));
    } catch (err) {
      console.error("Search failed:", err);
      setSearchStatus("error");
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    runSearch(query.trim());
  }

  function handleSuggestionClick(title) {
    setQuery(title);
    runSearch(title);
  }

  function handleClear() {
    setRawgResults([]);
    setDealsByTitle({});
    setSearchStatus("idle");
    setQuery("");
  }

  return (
    <>
      <form className="price-search" onSubmit={handleSearch}>
        <div className="price-search__input-wrap">
          <input
            className="price-search__input"
            type="text"
            placeholder="Search a game or DLC to add…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoComplete="off"
          />

          {showSuggestions && suggestions.length > 0 && (
            <ul className="search-suggestions">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="search-suggestions__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSuggestionClick(s.name)}
                  >
                    {s.backgroundImage ? (
                      <img
                        src={s.backgroundImage}
                        alt=""
                        className="search-suggestions__thumb"
                        decoding="async"
                      />
                    ) : (
                      <div className="search-suggestions__thumb search-suggestions__thumb--placeholder" />
                    )}
                    <span className="search-suggestions__title">
                      {s.name}
                      {s.isDlc && s.parentTitle && (
                        <span className="tag tag--muted backlog-search-results__dlc-tag">
                          DLC for {s.parentTitle}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="price-search__button">
          Search
        </button>
        {rawgResults.length > 0 && (
          <button type="button" className="price-search__clear" onClick={handleClear}>
            Clear
          </button>
        )}
      </form>

      {searchStatus === "loading" && <p className="panel__status">Searching…</p>}
      {searchStatus === "error" && (
        <p className="panel__status panel__status--error">
          No results found for &quot;{query}&quot;.
        </p>
      )}

      {searchStatus === "done" && rawgResults.length > 0 && (
        <ul className="search-results">
          {rawgResults.map((rawg) => {
            const result = dealsByTitle[rawg.name] || {
              game: rawg.name,
              thumb: rawg.backgroundImage || null,
              stores: [],
              steamAppID: null,
            };
            const isWishlisted = wishlist.some(
              (e) => e.title.toLowerCase() === result.game.toLowerCase()
            );
            const resultMeta = metaByTitle[result.game];
            const cheapest =
              result.stores.length > 0 || resultMeta
                ? getCheapestInfo(result, resultMeta, rates)
                : null;
            const { primary } =
              result.stores.length > 0 || resultMeta
                ? buildStoreRow(result, resultMeta, platformOrder)
                : { primary: [] };

            return (
              <li key={rawg.id} className="search-result-card">
                <div className="search-result-card__row">
                  {result.steamAppID || result.thumb ? (
                    <SteamArt
                      appid={result.steamAppID}
                      headerImage={result.thumb}
                      className="search-result-card__thumb"
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className="search-result-card__thumb search-result-card__thumb--placeholder" />
                  )}

                  <div className="search-result-card__info">
                    <span className="wishlist-card__title">{result.game}</span>
                    {rawg.isDlc && rawg.parentTitle && (
                      <span className="tag tag--muted backlog-search-results__dlc-tag">
                        DLC for {rawg.parentTitle}
                      </span>
                    )}
                    {rawg.platforms?.length > 0 && (
                      <span className="wishlist-card__meta">
                        {rawg.platforms.slice(0, 3).join(" · ")}
                      </span>
                    )}
                  </div>

                  {cheapest ? (
                    <div className="search-result-card__cheapest">
                      {cheapest.rrp > cheapest.price && (
                        <span className="wishlist-card__rrp">
                          {formatPrice(
                            cheapest.rrp,
                            cheapest.nativeCurrency,
                            rates,
                            currency
                          )}
                        </span>
                      )}
                      <span className="wishlist-card__cheapest-price">
                        {formatPrice(
                          cheapest.price,
                          cheapest.nativeCurrency,
                          rates,
                          currency
                        )}
                      </span>
                      <span className="wishlist-card__cheapest-store">
                        {cheapest.store}
                      </span>
                    </div>
                  ) : (
                    <span className="panel__status">Add to wishlist for full pricing</span>
                  )}

                  <WishlistToggle
                    isWishlisted={isWishlisted}
                    onAdd={() => onAddToWishlist(result.game)}
                    onRemove={() => onRemoveFromWishlist(result.game)}
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
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
