// TCG College hub — links to 5 real, built TCG features (MTG, Flesh
// and Blood, Pokémon, Yu-Gi-Oh!, One Piece), plus a real collection
// summary at the top when signed in. A 6th, Riftbound, is fully built
// but its tab is currently disabled — see the GAME_TABS comment below.
//
// In-page game tab switcher, same pattern TabletopHomePage.jsx already
// uses for RPG/Wargames/Dice/Rules — not a separate route/picker
// layer. GAME_TABS below is the single source of truth for which
// features + summary component each game gets.
//
// Real pricing IS honestly buildable for MTG (Scryfall), Pokémon
// (pokemontcg.io), Yu-Gi-Oh! (YGOPRODeck), and One Piece (optcgapi.com)
// — each summary shows a real estimated collection value. Flesh and
// Blood and Riftbound have no real pricing source confirmed for either
// (see lib/fab.js / lib/riftbound.js), so those two summaries are
// counts-only, never a fabricated number. Deliberately does NOT show a
// value "trend" (e.g. "+12% this month") on any summary strip — that's
// what MTG's dedicated Price Watch page is for, with real recorded
// history behind it.

import { useEffect, useState } from "react";
import { fetchCollection, enrichCollectionEntry } from "../lib/mtg";
import { fetchCollection as fetchFabCollection, enrichCollectionEntry as enrichFabCollectionEntry } from "../lib/fabCollection";
import { fetchCollection as fetchPokemonCollection, enrichCollectionEntry as enrichPokemonCollectionEntry } from "../lib/pokemonCollection";
import { currentPokemonPrice } from "../lib/pokemon";
import { fetchCollection as fetchYugiohCollection, enrichCollectionEntry as enrichYugiohCollectionEntry } from "../lib/yugiohCollection";
import { currentYugiohPrice } from "../lib/yugioh";
import { fetchCollection as fetchOnePieceCollection, enrichCollectionEntry as enrichOnePieceCollectionEntry } from "../lib/onepieceCollection";
import { currentOnePiecePrice } from "../lib/onepiece";
import CollegePageTitle from "./CollegePageTitle";

const MTG_FEATURES = [
  { id: "mtg-scan", label: "Scan Cards", icon: "📷", desc: "Free on-device text recognition, matched against real Scryfall data.", emphasized: true },
  { id: "mtg-search", label: "Card Search", icon: "🔍", desc: "Full Scryfall search — real cards, real pricing." },
  { id: "mtg-collection", label: "My Collection", icon: "📚", desc: "Real owned cards, real live pricing." },
  { id: "mtg-decks", label: "Deck Builder", icon: "🛠️", desc: "Real format-legality checking against Scryfall's own data." },
  { id: "mtg-price-watch", label: "Price Watch", icon: "📈", desc: "Real price trends across your whole collection, like a stock chart." },
  { id: "tcg-marketplace", label: "Marketplace", icon: "💰", desc: "Buy and sell real cards with other Lykodex users." },
];

const FAB_FEATURES = [
  { id: "fab-search", label: "Card Search", icon: "🔍", desc: "Real card data via goagain.dev's live Flesh and Blood API.", emphasized: true },
  { id: "fab-collection", label: "My Collection", icon: "📚", desc: "Real owned cards — no pricing shown yet." },
  { id: "fab-decks", label: "Deck Builder", icon: "🛠️", desc: "Real per-format legality checks, built around your chosen Hero." },
  { id: "tcg-marketplace", label: "Marketplace", icon: "💰", desc: "Buy and sell real cards with other Lykodex users." },
];

const POKEMON_FEATURES = [
  { id: "pokemon-search", label: "Card Search", icon: "🔍", desc: "Real card data and pricing via pokemontcg.io.", emphasized: true },
  { id: "pokemon-collection", label: "My Collection", icon: "📚", desc: "Real owned cards, real live pricing." },
  { id: "pokemon-decks", label: "Deck Builder", icon: "🛠️", desc: "Real format-legality checking against pokemontcg.io's own data." },
  { id: "tcg-marketplace", label: "Marketplace", icon: "💰", desc: "Buy and sell real cards with other Lykodex users." },
];

const YUGIOH_FEATURES = [
  { id: "yugioh-search", label: "Card Search", icon: "🔍", desc: "Real card data and pricing via YGOPRODeck.", emphasized: true },
  { id: "yugioh-collection", label: "My Collection", icon: "📚", desc: "Real owned cards, real live pricing." },
  { id: "yugioh-decks", label: "Deck Builder", icon: "🛠️", desc: "Real per-format banlist checking (TCG/OCG/GOAT) against YGOPRODeck's own data." },
  { id: "tcg-marketplace", label: "Marketplace", icon: "💰", desc: "Buy and sell real cards with other Lykodex users." },
];

const ONEPIECE_FEATURES = [
  { id: "onepiece-search", label: "Card Search", icon: "🔍", desc: "Real card data and pricing via optcgapi.com.", emphasized: true },
  { id: "onepiece-collection", label: "My Collection", icon: "📚", desc: "Real owned cards, real live pricing." },
  { id: "onepiece-decks", label: "Deck Builder", icon: "🛠️", desc: "Built around one real Leader card, same as Flesh and Blood's Hero anchor." },
  { id: "tcg-marketplace", label: "Marketplace", icon: "💰", desc: "Buy and sell real cards with other Lykodex users." },
];

const RARITY_ORDER = ["mythic", "rare", "uncommon", "common"];
const RARITY_LABELS = { mythic: "Mythic", rare: "Rare", uncommon: "Uncommon", common: "Common" };

function MtgSummary({ isLoggedIn, userId }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    setStatus("loading");
    fetchCollection(userId)
      .then((rows) => Promise.all(rows.map(enrichCollectionEntry)))
      .then((enriched) => {
        setEntries(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("MTG collection summary fetch failed:", err);
        setStatus("error");
      });
  }, [isLoggedIn, userId]);

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);
  const rarityCounts = entries.reduce((acc, e) => {
    const rarity = e.card?.rarity;
    if (rarity) acc[rarity] = (acc[rarity] || 0) + e.quantity;
    return acc;
  }, {});
  const totalValue = entries.reduce((sum, e) => {
    const price = e.foil ? e.card?.prices?.usd_foil : e.card?.prices?.usd;
    return sum + (Number(price) || 0) * e.quantity;
  }, 0);

  if (!isLoggedIn || status !== "ready") return null;
  if (entries.length === 0) return null;

  return (
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
        <span className="panel__stat-label">Est. value (USD)</span>
      </div>
      {RARITY_ORDER.filter((r) => rarityCounts[r]).map((r) => (
        <div className="panel__stat" key={r}>
          <span className="panel__stat-value">{rarityCounts[r]}</span>
          <span className="panel__stat-label">{RARITY_LABELS[r]}</span>
        </div>
      ))}
    </div>
  );
}

function FabSummary({ isLoggedIn, userId }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    setStatus("loading");
    fetchFabCollection(userId)
      .then((rows) => Promise.all(rows.map(enrichFabCollectionEntry)))
      .then((enriched) => {
        setEntries(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Flesh and Blood collection summary fetch failed:", err);
        setStatus("error");
      });
  }, [isLoggedIn, userId]);

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);

  if (!isLoggedIn || status !== "ready") return null;
  if (entries.length === 0) {
    return <p className="panel__status">No cards in your collection yet — start with Search below.</p>;
  }

  return (
    <div className="backlog-summary">
      <div className="panel__stat">
        <span className="panel__stat-value">{entries.length}</span>
        <span className="panel__stat-label">Unique cards</span>
      </div>
      <div className="panel__stat">
        <span className="panel__stat-value">{totalCards}</span>
        <span className="panel__stat-label">Total cards</span>
      </div>
    </div>
  );
}

function PokemonSummary({ isLoggedIn, userId }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    setStatus("loading");
    fetchPokemonCollection(userId)
      .then((rows) => Promise.all(rows.map(enrichPokemonCollectionEntry)))
      .then((enriched) => {
        setEntries(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Pokémon collection summary fetch failed:", err);
        setStatus("error");
      });
  }, [isLoggedIn, userId]);

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalValue = entries.reduce((sum, e) => {
    const price = e.card ? currentPokemonPrice(e.card)?.price || 0 : 0;
    return sum + price * e.quantity;
  }, 0);
  const rarityCounts = entries.reduce((acc, e) => {
    const rarity = e.card?.rarity;
    if (rarity) acc[rarity] = (acc[rarity] || 0) + e.quantity;
    return acc;
  }, {});
  const topRarities = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  if (!isLoggedIn || status !== "ready") return null;
  if (entries.length === 0) {
    return <p className="panel__status">No cards in your collection yet — start with Search below.</p>;
  }

  return (
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
        <span className="panel__stat-label">Est. value (USD)</span>
      </div>
      {topRarities.map(([rarity, count]) => (
        <div className="panel__stat" key={rarity}>
          <span className="panel__stat-value">{count}</span>
          <span className="panel__stat-label">{rarity}</span>
        </div>
      ))}
    </div>
  );
}

function YugiohSummary({ isLoggedIn, userId }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    setStatus("loading");
    fetchYugiohCollection(userId)
      .then((rows) => Promise.all(rows.map(enrichYugiohCollectionEntry)))
      .then((enriched) => {
        setEntries(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Yu-Gi-Oh! collection summary fetch failed:", err);
        setStatus("error");
      });
  }, [isLoggedIn, userId]);

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalValue = entries.reduce((sum, e) => {
    const price = e.card ? currentYugiohPrice(e.card)?.price || 0 : 0;
    return sum + price * e.quantity;
  }, 0);
  const rarityCounts = entries.reduce((acc, e) => {
    if (e.rarity) acc[e.rarity] = (acc[e.rarity] || 0) + e.quantity;
    return acc;
  }, {});
  const topRarities = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  if (!isLoggedIn || status !== "ready") return null;
  if (entries.length === 0) {
    return <p className="panel__status">No cards in your collection yet — start with Search below.</p>;
  }

  return (
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
        <span className="panel__stat-label">Est. value (USD)</span>
      </div>
      {topRarities.map(([rarity, count]) => (
        <div className="panel__stat" key={rarity}>
          <span className="panel__stat-value">{count}</span>
          <span className="panel__stat-label">{rarity}</span>
        </div>
      ))}
    </div>
  );
}

function OnePieceSummary({ isLoggedIn, userId }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    setStatus("loading");
    fetchOnePieceCollection(userId)
      .then((rows) => Promise.all(rows.map(enrichOnePieceCollectionEntry)))
      .then((enriched) => {
        setEntries(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("One Piece collection summary fetch failed:", err);
        setStatus("error");
      });
  }, [isLoggedIn, userId]);

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalValue = entries.reduce((sum, e) => {
    const price = e.card ? currentOnePiecePrice(e.card)?.price || 0 : 0;
    return sum + price * e.quantity;
  }, 0);
  const rarityCounts = entries.reduce((acc, e) => {
    if (e.rarity) acc[e.rarity] = (acc[e.rarity] || 0) + e.quantity;
    return acc;
  }, {});
  const topRarities = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  if (!isLoggedIn || status !== "ready") return null;
  if (entries.length === 0) {
    return <p className="panel__status">No cards in your collection yet — start with Search below.</p>;
  }

  return (
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
        <span className="panel__stat-label">Est. value (USD)</span>
      </div>
      {topRarities.map(([rarity, count]) => (
        <div className="panel__stat" key={rarity}>
          <span className="panel__stat-value">{count}</span>
          <span className="panel__stat-label">{rarity}</span>
        </div>
      ))}
    </div>
  );
}

// Riftbound is fully built (RiftboundSearchPage.jsx, lib/riftbound.js,
// the DB tables — all untouched and still wired) but its tab is shown
// disabled: its proxy (api/pricing.js's handleRiftbound) is blocked in
// production (Riftcodex 403s requests from Vercel's infrastructure, see
// that file's comment), so enabling it would be a dead end. Kept as a
// greyed-out "coming soon" tab at the end rather than hidden; drop the
// `disabled` flag (and give it a features/Summary pair like the others,
// restorable from commit 6694bd4) once that proxy is fixed.
const GAME_TABS = [
  { id: "pokemon", label: "Pokémon", features: POKEMON_FEATURES, Summary: PokemonSummary },
  { id: "mtg", label: "Magic: The Gathering", features: MTG_FEATURES, Summary: MtgSummary },
  { id: "onepiece", label: "One Piece", features: ONEPIECE_FEATURES, Summary: OnePieceSummary },
  { id: "fab", label: "Flesh and Blood", features: FAB_FEATURES, Summary: FabSummary },
  { id: "yugioh", label: "Yu-Gi-Oh!", features: YUGIOH_FEATURES, Summary: YugiohSummary },
  { id: "riftbound", label: "Riftbound", disabled: true },
];

export default function TcgHomePage({ onNavigate, isLoggedIn, userId }) {
  const [game, setGame] = useState(GAME_TABS[0].id);
  const activeTab = GAME_TABS.find((t) => t.id === game) || GAME_TABS[0];
  const ActiveSummary = activeTab.Summary;

  return (
    <div className="price-page">
      <div className="price-page__head">
        <CollegePageTitle collegeId="tcg" />
      </div>

      <div className="backlog-status-tabs">
        {GAME_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`quickdash-reset-btn ${game === t.id ? "quickdash-reset-btn--active" : ""}`}
            onClick={() => setGame(t.id)}
            disabled={t.disabled}
            title={t.disabled ? "Coming soon" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ActiveSummary isLoggedIn={isLoggedIn} userId={userId} />

      <div className="overview-grid">
        {activeTab.features.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`overview-card ${f.emphasized ? "overview-card--emphasized" : ""}`}
            onClick={() => onNavigate(f.id)}
          >
            <span className="overview-card__icon">{f.icon}</span>
            <span className="overview-card__label">{f.label}</span>
            <span className="overview-card__empty">{f.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
