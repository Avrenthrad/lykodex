// Magic: The Gathering — My Collection hub. Four real, distinct ways
// to organize owned cards, all backed by real Supabase tables:
//   Cards      — the flat owned-card list (mtg_collection), live pricing via Scryfall.
//   Decks      — real decks (mtg_decks), full editor lives at Deck Builder.
//   Binders    — user-named card groups with labels + a cover photo.
//   Set lists  — binders pinned to one real Scryfall set, doubling as
//                that set's owned-quantity checklist.
// See lib/mtg.js and MtgBindersPage.jsx for the binder/set-list logic.

import { useEffect, useState } from "react";
import { fetchCollection, enrichCollectionEntry, updateCollectionEntry, removeFromCollection, fetchDecks } from "../lib/mtg";
import { useCollectionEntries } from "../hooks/useCollectionEntries";
import MtgBindersPage from "./MtgBindersPage";
import MtgPriceHistoryModal from "./MtgPriceHistoryModal";

const TABS = [
  { id: "cards", label: "Cards" },
  { id: "decks", label: "Decks" },
  { id: "binders", label: "Binders" },
  { id: "set-lists", label: "Set lists" },
];

export default function MtgCollectionPage({ onBack, userId, onGoToSearch, onGoToScan, onGoToDecks, onGoToImport }) {
  const [tab, setTab] = useState("cards");

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back</button>
        <h1 className="price-page__title">My Collection</h1>
        <p className="price-page__subtitle">Real owned cards, decks, binders, and set checklists — all backed by real Scryfall data.</p>
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

      {tab === "cards" && (
        <CardsTab userId={userId} onGoToSearch={onGoToSearch} onGoToScan={onGoToScan} onGoToImport={onGoToImport} />
      )}
      {tab === "decks" && <DecksTab userId={userId} onGoToDecks={onGoToDecks} />}
      {tab === "binders" && <MtgBindersPage userId={userId} kind="binder" />}
      {tab === "set-lists" && <MtgBindersPage userId={userId} kind="set_list" />}
    </div>
  );
}

const RARITY_ORDER = ["mythic", "rare", "uncommon", "common"];

const SORT_OPTIONS = [
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Name" },
  { value: "price", label: "Price" },
  { value: "rarity", label: "Rarity" },
];

function cardPrice(entry) {
  const price = entry.foil ? entry.card?.prices?.usd_foil : entry.card?.prices?.usd;
  return Number(price) || 0;
}

function CardsTab({ userId, onGoToSearch, onGoToScan, onGoToImport }) {
  const { entries, setEntries, status } = useCollectionEntries("mtg", userId, fetchCollection, enrichCollectionEntry);
  const [priceHistoryCard, setPriceHistoryCard] = useState(null);
  const [viewMode, setViewMode] = useState("list"); // list | grid
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

  async function handleFoilToggle(entry) {
    const foil = !entry.foil;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, foil } : e)));
    try {
      await updateCollectionEntry(entry.id, { foil });
    } catch (err) {
      console.error("Failed to update foil status:", err);
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
    const rarity = e.card?.rarity;
    if (RARITY_ORDER.includes(rarity)) counts[rarity] = (counts[rarity] || 0) + e.quantity;
    return counts;
  }, {});

  const sortedEntries = [...entries].sort((a, b) => {
    if (sortBy === "name") return a.card_name.localeCompare(b.card_name);
    if (sortBy === "price") return cardPrice(b) - cardPrice(a);
    if (sortBy === "rarity") return RARITY_ORDER.indexOf(a.card?.rarity) - RARITY_ORDER.indexOf(b.card?.rarity);
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
          <div className="panel__stat">
            <span className="panel__stat-value">
              {RARITY_ORDER.map((r) => rarityCounts[r] || 0).join(" / ")}
            </span>
            <span className="panel__stat-label">Mythic / Rare / Uncommon / Common</span>
          </div>
        </div>
      )}

      <div className="backlog-add">
        <button type="button" className="quickdash-reset-btn" onClick={onGoToScan}>
          📷 Scan a card
        </button>
        <button type="button" className="quickdash-reset-btn" onClick={onGoToSearch}>
          + Search &amp; add
        </button>
        <button type="button" className="quickdash-reset-btn" onClick={onGoToImport}>
          ⬆️ Import CSV
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
          <div className="backlog-status-tabs">
            <button
              type="button"
              className={`quickdash-reset-btn ${viewMode === "list" ? "quickdash-reset-btn--active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
            <button
              type="button"
              className={`quickdash-reset-btn ${viewMode === "grid" ? "quickdash-reset-btn--active" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              Grid
            </button>
          </div>
        </div>
      )}

      {status === "loading" && <p className="panel__status">Loading your collection…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your collection right now.</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="panel__status">Nothing in your collection yet — search and add some cards.</p>
      )}

      {status === "ready" && entries.length > 0 && viewMode === "grid" && (
        <div className="mtg-card-grid">
          {sortedEntries.map((entry) => (
            <div key={entry.id} className="mtg-card-grid__item">
              {entry.card?.image ? (
                <img src={entry.card.image} alt="" className="mtg-card-grid__img" loading="lazy" decoding="async" />
              ) : (
                <div className="mtg-card-grid__img mtg-card-grid__img--placeholder" />
              )}
              {entry.card && (entry.card.prices?.usd || entry.card.prices?.usd_foil) && (
                <button
                  type="button"
                  className="score-badge mtg-card-grid__price"
                  onClick={() => setPriceHistoryCard(entry.card)}
                  title="View real price + history"
                >
                  {entry.foil && entry.card.prices?.usd_foil
                    ? `$${entry.card.prices.usd_foil}`
                    : entry.card.prices?.usd
                    ? `$${entry.card.prices.usd}`
                    : "View price"}
                </button>
              )}
              <div className="mtg-card-grid__footer">
                <span className="mtg-card-grid__name">{entry.card_name}</span>
                <div className="mtg-card-grid__controls">
                  <input
                    type="number"
                    min="0"
                    value={entry.quantity}
                    onChange={(e) => handleQuantityChange(entry, e.target.value)}
                  />
                  <label>
                    <input type="checkbox" checked={entry.foil} onChange={() => handleFoilToggle(entry)} />
                    Foil
                  </label>
                  <button type="button" className="game-popup__close" onClick={() => handleRemove(entry.id)} aria-label="Remove">✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "ready" && entries.length > 0 && viewMode === "list" && (
        <ul className="backlog-list">
          {sortedEntries.map((entry) => (
            <li key={entry.id} className="backlog-card">
              {entry.card?.imageSmall ? (
                <img src={entry.card.imageSmall} alt="" className="backlog-card__thumb" style={{ width: "56px", height: "78px" }} loading="lazy" decoding="async" />
              ) : (
                <div className="backlog-card__thumb backlog-card__thumb--placeholder" style={{ width: "56px", height: "78px" }} />
              )}
              <div className="backlog-card__info">
                <span className="backlog-card__title">{entry.card_name}</span>
                <div className="backlog-card__meta">
                  <span>{entry.set_code?.toUpperCase()}</span>
                  {entry.card && (entry.card.prices?.usd || entry.card.prices?.usd_foil) && (
                    <button
                      type="button"
                      className="score-badge score-badge--link"
                      onClick={() => setPriceHistoryCard(entry.card)}
                      title="View real price + history"
                    >
                      {entry.foil && entry.card.prices?.usd_foil
                        ? `$${entry.card.prices.usd_foil} (foil)`
                        : entry.card.prices?.usd
                        ? `$${entry.card.prices.usd}`
                        : "View price"}
                    </button>
                  )}
                </div>
                <div className="backlog-card__actions">
                  <label className="backlog-card__hours">
                    Qty:
                    <input
                      type="number"
                      min="0"
                      value={entry.quantity}
                      onChange={(e) => handleQuantityChange(entry, e.target.value)}
                      style={{ width: "48px" }}
                    />
                  </label>
                  <label className="backlog-card__hours">
                    <input type="checkbox" checked={entry.foil} onChange={() => handleFoilToggle(entry)} />
                    Foil
                  </label>
                </div>
              </div>
              <button type="button" className="game-popup__close" onClick={() => handleRemove(entry.id)} aria-label="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}

      <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" className="ps-trophy-attribution">
        Card data and pricing powered by Scryfall
      </a>

      {priceHistoryCard && (
        <MtgPriceHistoryModal card={priceHistoryCard} onClose={() => setPriceHistoryCard(null)} />
      )}
    </>
  );
}

// Compact deck list — the full editor (add/remove cards, legality
// checks) still lives in MtgDeckBuilderPage; this tab is a real,
// live-loaded summary with covers/labels so decks show up alongside
// the other three organization tools instead of being a separate silo.
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
              <span className="binder-card__meta">{deck.format}</span>
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
