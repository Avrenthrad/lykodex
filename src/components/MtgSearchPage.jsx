// Magic: The Gathering — card search/catalog. Real data throughout
// via Scryfall's genuine free public API.

import { useEffect, useRef, useState } from "react";
import { searchCards, getCardAutocomplete } from "../lib/scryfall";
import { addToCollection } from "../lib/mtg";
import CollectionAddNotice from "./CollectionAddNotice";

const ADD_ERROR = "Couldn't add that card to your collection. Try again.";

export default function MtgSearchPage({ onBack, userId, isLoggedIn, onSignIn, onCreateAccount, onViewCollection }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [addedIds, setAddedIds] = useState(new Set());
  const [addingIds, setAddingIds] = useState(new Set());
  const [addMessage, setAddMessage] = useState(null);
  // Guards a real bug: the debounced autocomplete fetch below can
  // still be in flight when the user submits a real search (e.g.
  // click Search right after typing, before the 250ms debounce
  // fires). Without this, that stale fetch can resolve AFTER
  // handleSearch clears suggestions and re-populate the dropdown on
  // top of the real results. Each autocomplete request checks it's
  // still the latest before applying its result; handleSearch bumps
  // it to invalidate any request already in flight.
  const suggestionRequestId = useRef(0);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const requestId = ++suggestionRequestId.current;
      getCardAutocomplete(query)
        .then((names) => {
          if (requestId === suggestionRequestId.current) setSuggestions(names);
        })
        .catch((err) => console.error("Autocomplete failed:", err));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleSearch(e, overrideQuery) {
    e?.preventDefault();
    const q = overrideQuery ?? query;
    if (!q.trim()) return;
    suggestionRequestId.current += 1; // invalidate any in-flight autocomplete
    setSuggestions([]);
    setAddMessage(null);
    setStatus("loading");
    try {
      const { cards } = await searchCards(q.trim());
      setResults(cards);
      setStatus("ready");
    } catch (err) {
      console.error("MTG search failed:", err);
      setStatus("error");
    }
  }

  async function handleAdd(card) {
    if (addingIds.has(card.id) || addedIds.has(card.id)) return;
    setAddingIds((prev) => new Set(prev).add(card.id));
    setAddMessage(null);
    try {
      await addToCollection(userId, card);
      setAddedIds((prev) => new Set(prev).add(card.id));
      setAddMessage({ type: "ok", name: card.name });
    } catch (err) {
      console.error("Failed to add card to collection:", err);
      setAddMessage({ type: "error", text: ADD_ERROR });
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    }
  }

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back</button>
        <h1 className="price-page__title">Magic: The Gathering — Card Search</h1>
        <p className="price-page__subtitle">
          Real card data and pricing via Scryfall, including every printing back to Alpha.
        </p>
      </div>

      <form className="price-search" onSubmit={handleSearch} style={{ position: "relative" }}>
        <input
          className="price-search__input"
          type="text"
          placeholder='Search by name, or try Scryfall syntax like "c:red type:creature"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="price-search__button">Search</button>

        {suggestions.length > 0 && (
          <ul className="backlog-search-results" style={{ position: "absolute", top: "48px", zIndex: 10, background: "var(--surface)", width: "100%", maxWidth: "480px" }}>
            {suggestions.map((name) => (
              <li key={name} className="backlog-search-results__row">
                <button
                  type="button"
                  className="linking-row__connect"
                  onClick={() => { setQuery(name); setSuggestions([]); handleSearch(undefined, name); }}
                  style={{ width: "100%", textAlign: "left" }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <CollectionAddNotice message={addMessage} onViewCollection={onViewCollection} />

      {status === "loading" && <p className="panel__status">Searching…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't search right now.</p>}
      {status === "ready" && results.length === 0 && <p className="panel__status">No cards found for that search.</p>}

      {status === "ready" && results.length > 0 && (
        <ul className="backlog-list">
          {results.slice(0, 30).map((card) => (
            <li key={card.id} className="backlog-card">
              {card.imageSmall ? (
                <img src={card.imageSmall} alt="" className="backlog-card__thumb" style={{ width: "56px", height: "78px" }} loading="lazy" decoding="async" />
              ) : (
                <div className="backlog-card__thumb backlog-card__thumb--placeholder" style={{ width: "56px", height: "78px" }} />
              )}
              <div className="backlog-card__info">
                <span className="backlog-card__title">{card.name}</span>
                <div className="backlog-card__meta">
                  <span>{card.setName}</span>
                  {card.rarity && <span style={{ textTransform: "capitalize" }}>{card.rarity}</span>}
                  {card.prices.usd && <span className="score-badge">${card.prices.usd}</span>}
                  {card.prices.usd_foil && <span className="score-badge score-badge--preorder">Foil ${card.prices.usd_foil}</span>}
                </div>
              </div>
              {isLoggedIn ? (
                <button
                  type="button"
                  className="linking-row__connect"
                  onClick={() => handleAdd(card)}
                  disabled={addedIds.has(card.id) || addingIds.has(card.id)}
                >
                  {addedIds.has(card.id) ? "Added" : addingIds.has(card.id) ? "Adding…" : "Add to Collection"}
                </button>
              ) : (
                <div className="backlog-card__actions">
                  <button type="button" className="linking-row__connect" onClick={onSignIn}>Sign in to add</button>
                  <button type="button" className="linking-row__connect" onClick={onCreateAccount}>Create account</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Card data and images powered by Scryfall
      </a>
    </div>
  );
}
