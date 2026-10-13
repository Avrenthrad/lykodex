// Yu-Gi-Oh! — My Collection hub. Cards + Decks (no binders/set-lists —
// not surfaced for this game, matching Pokémon's own home-page feature
// scope). Real card data via YGOPRODeck.

import { useEffect, useState } from "react";
import { fetchCollection, enrichCollectionEntry, updateCollectionEntry, removeFromCollection, fetchDecks } from "../lib/yugiohCollection";
import { useCollectionEntries } from "../hooks/useCollectionEntries";
import { currentYugiohPrice } from "../lib/yugioh";

const TABS = [
  { id: "cards", label: "Cards" },
  { id: "decks", label: "Decks" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Name" },
  { value: "price", label: "Price" },
];

function cardPrice(entry) {
  return entry.card ? currentYugiohPrice(entry.card)?.price || 0 : 0;
}

export default function YugiohCollectionPage({ onBack, userId, onGoToSearch, onGoToDecks }) {
  const [tab, setTab] = useState("cards");

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back</button>
        <h1 className="price-page__title">My Collection</h1>
        <p className="price-page__subtitle">Real owned cards and decks — via YGOPRODeck.</p>
      </div>

      <div className="backlog-status-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`quickdash-reset-btn ${tab === t.id ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cards" && <CardsTab userId={userId} onGoToSearch={onGoToSearch} />}
      {tab === "decks" && <DecksTab userId={userId} onGoToDecks={onGoToDecks} />}
    </div>
  );
}

function CardsTab({ userId, onGoToSearch }) {
  const { entries, setEntries, status } = useCollectionEntries("yugioh", userId, fetchCollection, enrichCollectionEntry);
  const [sortBy, setSortBy] = useState("recent");

  async function handleQuantityChange(entry, newQuantity) {
    const qty = Math.max(0, Number(newQuantity) || 0);
    if (qty === 0) {
      await handleRemove(entry.id);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, quantity: qty } : e)));
    try {
      await updateCollectionEntry(entry.id, { quantity: qty });
    } catch (err) {
      console.error("Failed to update quantity:", err);
    }
  }

  async function handleRemove(entryId) {
    try {
      await removeFromCollection(entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      console.error("Failed to remove card:", err);
    }
  }

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalValue = entries.reduce((sum, e) => sum + cardPrice(e) * e.quantity, 0);
  const rarityCounts = entries.reduce((counts, e) => {
    const rarity = e.rarity;
    if (rarity) counts[rarity] = (counts[rarity] || 0) + e.quantity;
    return counts;
  }, {});
  const topRarities = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const sortedEntries = [...entries].sort((a, b) => {
    if (sortBy === "name") return a.card_name.localeCompare(b.card_name);
    if (sortBy === "price") return cardPrice(b) - cardPrice(a);
    return new Date(b.added_at) - new Date(a.added_at);
  });

  return (
    <>
      {status === "ready" && entries.length > 0 && (
        <div className="backlog-summary">
          <div className="panel__stat">
            <span className="panel__stat-value">{entries.length}</span>
            <span className="panel__stat-label">Unique cards</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value">{totalCards}</span>
            <span className="panel__stat-label">Total cards</span>
          </div>
          <div className="panel__stat">
            <span className="panel__stat-value">${totalValue.toFixed(2)}</span>
            <span className="panel__stat-label">Est. collection value (USD)</span>
          </div>
          {topRarities.map(([rarity, count]) => (
            <div className="panel__stat" key={rarity}>
              <span className="panel__stat-value">{count}</span>
              <span className="panel__stat-label">{rarity}</span>
            </div>
          ))}
        </div>
      )}

      <div className="backlog-add">
        <button type="button" className="quickdash-reset-btn" onClick={onGoToSearch}>
          + Search &amp; add
        </button>
      </div>

      {status === "ready" && entries.length > 0 && (
        <div className="backlog-add">
          <label className="currency-picker">
            <span>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {status === "loading" && <p className="panel__status">Loading your collection…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your collection right now.</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="panel__status">No cards in your collection yet — start with Search above.</p>
      )}

      {status === "ready" && entries.length > 0 && (
        <ul className="backlog-list">
          {sortedEntries.map((entry) => {
            const price = cardPrice(entry);
            return (
              <li key={entry.id} className="backlog-card">
                {entry.card?.imageUrlSmall ? (
                  <img src={entry.card.imageUrlSmall} alt="" className="backlog-card__thumb" style={{ width: "56px", height: "78px" }} loading="lazy" decoding="async" />
                ) : (
                  <div className="backlog-card__thumb backlog-card__thumb--placeholder" style={{ width: "56px", height: "78px" }} />
                )}
                <div className="backlog-card__info">
                  <span className="backlog-card__title">{entry.card_name}</span>
                  <div className="backlog-card__meta">
                    {entry.set_code && <span>{entry.set_code}</span>}
                    {entry.rarity && <span>{entry.rarity}</span>}
                    {entry.condition && <span>{entry.condition}</span>}
                    {price > 0 && <span className="score-badge">${price.toFixed(2)}</span>}
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  className="backlog-card__status-select"
                  style={{ width: "64px" }}
                  value={entry.quantity}
                  onChange={(e) => handleQuantityChange(entry, e.target.value)}
                />
                <button type="button" className="game-popup__close" onClick={() => handleRemove(entry.id)} aria-label="Remove">✕</button>
              </li>
            );
          })}
        </ul>
      )}

      <a href="https://ygoprodeck.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Card data and pricing via YGOPRODeck
      </a>
    </>
  );
}

// Compact deck list — the full editor lives in YugiohDeckBuilderPage.
function DecksTab({ userId, onGoToDecks }) {
  const [decks, setDecks] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!userId) return;
    setStatus("loading");
    fetchDecks(userId)
      .then((rows) => {
        setDecks(rows);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load decks:", err);
        setStatus("error");
      });
  }, [userId]);

  return (
    <>
      <div className="backlog-add">
        <button type="button" className="quickdash-reset-btn" onClick={onGoToDecks}>
          🛠️ Open Deck Builder
        </button>
      </div>

      {status === "loading" && <p className="panel__status">Loading your decks…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your decks right now.</p>}
      {status === "ready" && decks.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">🛠️</span>
          <p className="empty-state__body">No decks yet — open the Deck Builder to create one.</p>
        </div>
      )}

      {decks.length > 0 && (
        <div className="binder-grid">
          {decks.map((deck) => (
            <button key={deck.id} type="button" className="binder-card binder-card--plain" onClick={onGoToDecks}>
              <span className="binder-card__cover">
                {deck.cover_image_url ? (
                  <img src={deck.cover_image_url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="binder-card__cover-fallback" aria-hidden="true">🛠️</span>
                )}
              </span>
              <span className="binder-card__name">{deck.name}</span>
              <span className="binder-card__meta">{deck.format?.toUpperCase()}</span>
              {deck.labels?.length > 0 && (
                <div className="label-chip-row">
                  {deck.labels.map((l) => (
                    <span key={l} className="label-chip">{l}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
