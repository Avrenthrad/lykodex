// Flesh and Blood — card search/catalog. Real data via goagain.dev's
// live, keyless API (see lib/fab.js). No pricing shown — deferred, see
// the FaB feature plan for why (no free keyless FaB pricing source
// confirmed at the time this was built).

import { useEffect, useRef, useState } from "react";
import { searchFabCards, getFabCardAutocomplete } from "../lib/fab";
import { addToCollection } from "../lib/fabCollection";
import CollectionAddNotice from "./CollectionAddNotice";

const ADD_ERROR = "Couldn't add that card to your collection. Try again.";

function firstPrintingImage(card) {
  return card.printings.find((p) => p.imageUrl)?.imageUrl || null;
}

export default function FabSearchPage({ onBack, userId, isLoggedIn, onSignIn, onCreateAccount, onViewCollection }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [addedIds, setAddedIds] = useState(new Set());
  const [addingIds, setAddingIds] = useState(new Set());
  const [addMessage, setAddMessage] = useState(null);
  // Guards against a real bug: the debounced autocomplete fetch below
  // can still be in flight when the user submits a real search (e.g.
  // click Search right after typing, before the 250ms debounce fires).
  // Without this, that stale fetch can resolve AFTER handleSearch
  // clears suggestions and re-populate the dropdown on top of the real
  // results. Each autocomplete request checks it's still the latest
  // before applying its result; handleSearch bumps it to invalidate
  // any request already in flight.
  const suggestionRequestId = useRef(0);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const requestId = ++suggestionRequestId.current;
      getFabCardAutocomplete(query)
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
      const { cards } = await searchFabCards({ name: q.trim() });
      setResults(cards);
      setStatus("ready");
    } catch (err) {
      console.error("Flesh and Blood search failed:", err);
      setStatus("error");
    }
  }

  async function handleAdd(card) {
    if (addingIds.has(card.id) || addedIds.has(card.id)) return;
    setAddingIds((prev) => new Set(prev).add(card.id));
    setAddMessage(null);
    const printing = card.printings[0];
    try {
      await addToCollection(userId, card, {
        printingUniqueId: printing?.printingId || null,
        setId: printing?.setId || null,
        edition: printing?.edition || null,
        foiling: printing?.foiling || null,
      });
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
        <h1 className="price-page__title">Flesh and Blood — Card Search</h1>
        <p className="price-page__subtitle">
          Real card data via goagain.dev's live Flesh and Blood API.
        </p>
      </div>

      <form className="price-search" onSubmit={handleSearch} style={{ position: "relative" }}>
        <input
          className="price-search__input"
          type="text"
          placeholder="Search by card name…"
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
          {results.slice(0, 30).map((card) => {
            const image = firstPrintingImage(card);
            const printing = card.printings[0];
            return (
              <li key={card.id} className="backlog-card">
                {image ? (
                  <img src={image} alt="" className="backlog-card__thumb" style={{ width: "56px", height: "78px" }} loading="lazy" decoding="async" />
                ) : (
                  <div className="backlog-card__thumb backlog-card__thumb--placeholder" style={{ width: "56px", height: "78px" }} />
                )}
                <div className="backlog-card__info">
                  <span className="backlog-card__title">{card.name}</span>
                  <div className="backlog-card__meta">
                    <span>{card.typeText}</span>
                    {card.pitch && <span>Pitch {card.pitch}</span>}
                    {printing?.rarity && <span style={{ textTransform: "uppercase" }}>{printing.rarity}</span>}
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
            );
          })}
        </ul>
      )}

      <a href="https://fabtcg.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Card data via goagain.dev · Flesh and Blood is a trademark of Legend Story Studios
      </a>
    </div>
  );
}
