// Collectibles College — real personal inventory, with real section
// navigation (My Shelf / Add Item / Hardware / Wishlist / Stats).
// Add Item supports real lookups: a camera barcode scan against a
// generic public UPC database (lib/upc.js — covers any retail
// product, since no general catalogue exists for most collectible
// types), a search against the real open Funko Pop catalog
// (lib/funko.js), the real Rebrickable LEGO set database (lib/rebrickable.js
// — needs a real REBRICKABLE_KEY set server-side, degrades to an
// honest "not set up yet" state until then, same pattern as this
// app's other optional-key integrations), and the real Discogs vinyl
// database (lib/discogs.js — genuinely keyless, called directly from
// the browser, no server-side setup needed at all). Everything else
// stays honest manual entry.

import { useEffect, useState } from "react";
import { fetchCollectibles, addCollectible, updateCollectible, removeCollectible } from "../lib/collectibles";
import { lookupProductByBarcode } from "../lib/upc";
import { searchFunkoCatalog } from "../lib/funko";
import { searchRebrickableSets } from "../lib/rebrickable";
import { searchDiscogsVinyl } from "../lib/discogs";
import ProductBarcodeScanner from "./ProductBarcodeScanner";
import MarketplaceSection from "./MarketplaceSection";

const TYPE_GROUPS = [
  { label: "Figures & Statues", types: ["figure", "statue", "funko_pop"] },
  { label: "Builds", types: ["lego_set", "model_kit"] },
  { label: "Play Hardware", types: ["console", "controller", "accessory", "amiibo"] },
  { label: "Display Smalls", types: ["pin", "prop"] },
  { label: "Media & Editions", types: ["vinyl_music", "print", "collectors_edition"] },
  { label: "Other", types: ["other"] },
];

const TYPE_LABELS = {
  figure: "Figure", statue: "Statue", funko_pop: "Funko Pop", lego_set: "LEGO Set",
  model_kit: "Model Kit", amiibo: "Amiibo", prop: "Prop", pin: "Pin",
  vinyl_music: "Vinyl / Music", print: "Print", collectors_edition: "Collector's Edition",
  console: "Console", controller: "Controller", accessory: "Accessory", other: "Other",
};

const HARDWARE_TYPES = ["console", "controller", "accessory", "amiibo"];

const PACKAGE_STATES = ["sealed", "opened_boxed", "loose", "boxed_complete", "boxed_incomplete", "discarded_box"];
const PACKAGE_STATE_LABELS = {
  sealed: "Sealed", opened_boxed: "Opened (boxed)", loose: "Loose",
  boxed_complete: "Boxed, complete", boxed_incomplete: "Boxed, incomplete", discarded_box: "Box discarded",
};

const CONDITIONS = ["mint", "near_mint", "good", "fair", "poor"];
const CONDITION_LABELS = { mint: "Mint", near_mint: "Near Mint", good: "Good", fair: "Fair", poor: "Poor" };

export default function CollectiblesHomePage({ onBack, isLoggedIn, userId, onSignIn, onCreateAccount, currency }) {
  const [section, setSection] = useState("shelf"); // shelf | add | hardware | wishlist | stats | marketplace
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, userId]);

  async function loadEntries() {
    setStatus("loading");
    try {
      const rows = await fetchCollectibles(userId);
      setEntries(rows);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load collectibles:", err);
      setStatus("error");
    }
  }

  async function handleStateChange(entryId, field, value) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, [field]: value } : e)));
    try {
      await updateCollectible(entryId, { [field]: value });
    } catch (err) {
      console.error("Failed to update collectible:", err);
    }
  }

  async function handleRemove(entryId) {
    try {
      await removeCollectible(entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      console.error("Failed to remove collectible:", err);
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="price-page">
        <div className="price-page__head">
          <button type="button" className="back-link" onClick={onBack}>← Back to Overview</button>
          <p className="price-page__subtitle">Your real shelf — Pops, statues, LEGO, hardware, and more.</p>
        </div>
        <div className="backlog-add">
          <button type="button" className="linking-row__connect" onClick={onSignIn}>Sign in</button>
          <button type="button" className="linking-row__connect" onClick={onCreateAccount}>Create account</button>
        </div>
      </div>
    );
  }

  const owned = entries.filter((e) => !e.is_wishlist);
  const wishlist = entries.filter((e) => e.is_wishlist);
  const hardware = owned.filter((e) => HARDWARE_TYPES.includes(e.type));

  return (
    <div className="price-page">
      <div className="price-page__head">
        <button type="button" className="back-link" onClick={onBack}>← Back to Overview</button>
        <p className="price-page__subtitle">
          Scan a barcode, or search the real Funko Pop, LEGO (Rebrickable), or vinyl (Discogs)
          catalogs to add items fast — everything else stays honest manual entry.
        </p>
      </div>

      <div className="backlog-status-tabs">
        <button type="button" className={`quickdash-reset-btn ${section === "shelf" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("shelf")}>My Shelf</button>
        <button type="button" className={`quickdash-reset-btn ${section === "add" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("add")}>Add Item</button>
        <button type="button" className={`quickdash-reset-btn ${section === "hardware" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("hardware")}>Hardware</button>
        <button type="button" className={`quickdash-reset-btn ${section === "wishlist" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("wishlist")}>Wishlist</button>
        <button type="button" className={`quickdash-reset-btn ${section === "stats" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("stats")}>Stats</button>
        <button type="button" className={`quickdash-reset-btn ${section === "marketplace" ? "quickdash-reset-btn--active" : ""}`} onClick={() => setSection("marketplace")}>Marketplace</button>
      </div>

      {status === "loading" && <p className="panel__status">Loading your shelf…</p>}
      {status === "error" && <p className="panel__status panel__status--error">Couldn't load your shelf right now.</p>}

      {status === "ready" && section === "shelf" && (
        <EntryList
          entries={owned}
          emptyMessage="Your shelf is empty — use Add Item to get started."
          onStateChange={handleStateChange}
          onRemove={handleRemove}
        />
      )}

      {section === "add" && (
        <AddItemForm userId={userId} onAdded={() => { loadEntries(); setSection("shelf"); }} />
      )}

      {status === "ready" && section === "hardware" && (
        <EntryList
          entries={hardware}
          emptyMessage="No hardware yet — consoles, controllers, accessories, and amiibo show up here."
          onStateChange={handleStateChange}
          onRemove={handleRemove}
        />
      )}

      {status === "ready" && section === "wishlist" && (
        <EntryList
          entries={wishlist}
          emptyMessage="Nothing on your wishlist yet — add an item and mark it as wishlist."
          onStateChange={handleStateChange}
          onRemove={handleRemove}
        />
      )}

      {status === "ready" && section === "stats" && <StatsView owned={owned} />}

      {section === "marketplace" && (
        <MarketplaceSection
          category="collectibles"
          userId={userId}
          isLoggedIn={isLoggedIn}
          onSignIn={onSignIn}
          onCreateAccount={onCreateAccount}
          currency={currency}
        />
      )}
    </div>
  );
}

function EntryList({ entries, emptyMessage, onStateChange, onRemove }) {
  if (entries.length === 0) return <p className="panel__status">{emptyMessage}</p>;
  return (
    <ul className="backlog-list">
      {entries.map((entry) => (
        <li key={entry.id} className="backlog-card">
          {entry.cover_image_url ? (
            <img src={entry.cover_image_url} alt="" className="backlog-card__thumb" loading="lazy" decoding="async" />
          ) : (
            <div className="backlog-card__thumb backlog-card__thumb--placeholder" />
          )}
          <div className="backlog-card__info">
            <span className="backlog-card__title">{entry.title} {entry.qty > 1 && `×${entry.qty}`}</span>
            <div className="backlog-card__meta">
              <span>{TYPE_LABELS[entry.type]}</span>
              <span className="score-badge">{PACKAGE_STATE_LABELS[entry.package_state]}</span>
              <span>{CONDITION_LABELS[entry.condition]}</span>
              {entry.price_paid != null && <span>${Number(entry.price_paid).toFixed(2)}</span>}
            </div>
            {entry.notes && <span className="backlog-card__meta">{entry.notes}</span>}
          </div>
          <select
            className="backlog-card__status-select"
            value={entry.package_state}
            onChange={(e) => onStateChange(entry.id, "package_state", e.target.value)}
          >
            {PACKAGE_STATES.map((s) => (
              <option key={s} value={s}>{PACKAGE_STATE_LABELS[s]}</option>
            ))}
          </select>
          <button type="button" className="game-popup__close" onClick={() => onRemove(entry.id)} aria-label="Remove">✕</button>
        </li>
      ))}
    </ul>
  );
}

function AddItemForm({ userId, onAdded }) {
  const [type, setType] = useState("funko_pop");
  const [title, setTitle] = useState("");
  const [packageState, setPackageState] = useState("sealed");
  const [condition, setCondition] = useState("mint");
  const [qty, setQty] = useState(1);
  const [pricePaid, setPricePaid] = useState("");
  const [notes, setNotes] = useState("");
  const [isWishlist, setIsWishlist] = useState(false);

  // Set by a barcode scan or a Funko catalog match — never by hand.
  const [identifier, setIdentifier] = useState(null);
  const [source, setSource] = useState("user");
  const [coverImageUrl, setCoverImageUrl] = useState(null);

  const [showScanner, setShowScanner] = useState(false);
  const [scanStatus, setScanStatus] = useState("idle"); // idle | loading | found | not-found | error

  const [showFunkoSearch, setShowFunkoSearch] = useState(false);
  const [funkoQuery, setFunkoQuery] = useState("");
  const [funkoResults, setFunkoResults] = useState([]);
  const [funkoStatus, setFunkoStatus] = useState("idle"); // idle | loading | ready | error

  const [showLegoSearch, setShowLegoSearch] = useState(false);
  const [legoQuery, setLegoQuery] = useState("");
  const [legoResults, setLegoResults] = useState([]);
  const [legoStatus, setLegoStatus] = useState("idle"); // idle | loading | ready | error | no_key

  const [showVinylSearch, setShowVinylSearch] = useState(false);
  const [vinylQuery, setVinylQuery] = useState("");
  const [vinylResults, setVinylResults] = useState([]);
  const [vinylStatus, setVinylStatus] = useState("idle"); // idle | loading | ready | error

  async function handleBarcodeDetected(barcode) {
    setShowScanner(false);
    setScanStatus("loading");
    try {
      const match = await lookupProductByBarcode(barcode);
      if (match) {
        setTitle(match.title || title);
        setCoverImageUrl(match.imageUrl);
        setIdentifier(barcode);
        setSource("upc");
        setScanStatus("found");
      } else {
        setIdentifier(barcode);
        setScanStatus("not-found");
      }
    } catch (err) {
      console.error("Barcode lookup failed:", err);
      setScanStatus("error");
    }
  }

  async function handleFunkoSearch(e) {
    e.preventDefault();
    if (!funkoQuery.trim()) return;
    setFunkoStatus("loading");
    try {
      const results = await searchFunkoCatalog(funkoQuery.trim());
      setFunkoResults(results);
      setFunkoStatus("ready");
    } catch (err) {
      console.error("Funko catalog search failed:", err);
      setFunkoStatus("error");
    }
  }

  function handlePickFunko(pop) {
    setTitle(pop.series ? `${pop.title} (${pop.series})` : pop.title);
    setCoverImageUrl(pop.imageUrl);
    setIdentifier(pop.handle);
    setSource("funko");
    setShowFunkoSearch(false);
    setFunkoResults([]);
    setFunkoQuery("");
  }

  async function handleLegoSearch(e) {
    e.preventDefault();
    if (!legoQuery.trim()) return;
    setLegoStatus("loading");
    try {
      const results = await searchRebrickableSets(legoQuery.trim());
      if (results === "no_key") {
        setLegoStatus("no_key");
        return;
      }
      setLegoResults(results);
      setLegoStatus("ready");
    } catch (err) {
      console.error("Rebrickable search failed:", err);
      setLegoStatus("error");
    }
  }

  function handlePickLego(set) {
    setTitle(set.year ? `${set.name} (${set.year})` : set.name);
    setCoverImageUrl(set.imageUrl);
    setIdentifier(set.setNum);
    setSource("rebrickable");
    setShowLegoSearch(false);
    setLegoResults([]);
    setLegoQuery("");
  }

  async function handleVinylSearch(e) {
    e.preventDefault();
    if (!vinylQuery.trim()) return;
    setVinylStatus("loading");
    try {
      const results = await searchDiscogsVinyl(vinylQuery.trim());
      setVinylResults(results);
      setVinylStatus("ready");
    } catch (err) {
      console.error("Discogs search failed:", err);
      setVinylStatus("error");
    }
  }

  function handlePickVinyl(release) {
    setTitle(release.year ? `${release.title} (${release.year})` : release.title);
    setCoverImageUrl(release.imageUrl);
    setIdentifier(String(release.id));
    setSource("discogs");
    setShowVinylSearch(false);
    setVinylResults([]);
    setVinylQuery("");
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await addCollectible(userId, {
        type, title: title.trim(), packageState, condition,
        qty: Number(qty) || 1, pricePaid: pricePaid ? Number(pricePaid) : null,
        notes: notes.trim() || null, isWishlist,
        identifier, source, coverImageUrl,
      });
      onAdded();
    } catch (err) {
      console.error("Failed to add collectible:", err);
    }
  }

  return (
    <form className="backlog-add" onSubmit={handleAdd} style={{ marginTop: "16px" }}>
      <div className="settings-form-row">
        <button type="button" className="quickdash-reset-btn" onClick={() => setShowScanner((v) => !v)}>
          {showScanner ? "Cancel scan" : "📷 Scan a barcode"}
        </button>
        {type === "funko_pop" && (
          <button type="button" className="quickdash-reset-btn" onClick={() => setShowFunkoSearch((v) => !v)}>
            {showFunkoSearch ? "Cancel search" : "🔍 Search real Funko catalog"}
          </button>
        )}
        {type === "lego_set" && (
          <button type="button" className="quickdash-reset-btn" onClick={() => setShowLegoSearch((v) => !v)}>
            {showLegoSearch ? "Cancel search" : "🔍 Search real LEGO catalog"}
          </button>
        )}
        {type === "vinyl_music" && (
          <button type="button" className="quickdash-reset-btn" onClick={() => setShowVinylSearch((v) => !v)}>
            {showVinylSearch ? "Cancel search" : "🔍 Search real vinyl catalog"}
          </button>
        )}
      </div>

      {showScanner && <ProductBarcodeScanner onDetected={handleBarcodeDetected} onManualEntry={handleBarcodeDetected} />}
      {scanStatus === "loading" && <p className="panel__status">Looking up that barcode…</p>}
      {scanStatus === "found" && <p className="panel__status">Matched a real product — review the fields below before saving.</p>}
      {scanStatus === "not-found" && <p className="panel__status">No match for that barcode — fill in the details manually below.</p>}
      {scanStatus === "error" && <p className="panel__status panel__status--error">Barcode lookup failed — fill in the details manually below.</p>}

      {showFunkoSearch && (
        <div className="backlog-add">
          <form className="price-search" onSubmit={handleFunkoSearch}>
            <input
              className="price-search__input"
              type="text"
              placeholder="Search the real Funko Pop catalog…"
              value={funkoQuery}
              onChange={(e) => setFunkoQuery(e.target.value)}
            />
            <button type="submit" className="price-search__button" disabled={funkoStatus === "loading"}>
              {funkoStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </form>
          {funkoStatus === "error" && <p className="panel__status panel__status--error">Couldn't load the Funko catalog right now.</p>}
          {funkoStatus === "ready" && funkoResults.length === 0 && <p className="panel__status">No matches — try a different search.</p>}
          {funkoResults.length > 0 && (
            <ul className="backlog-search-results">
              {funkoResults.map((pop) => (
                <li key={pop.handle} className="backlog-search-results__row">
                  {pop.imageUrl && <img src={pop.imageUrl} alt="" loading="lazy" decoding="async" />}
                  <span>{pop.title}{pop.series ? ` — ${pop.series}` : ""}</span>
                  <button type="button" className="linking-row__connect" onClick={() => handlePickFunko(pop)}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showLegoSearch && (
        <div className="backlog-add">
          <form className="price-search" onSubmit={handleLegoSearch}>
            <input
              className="price-search__input"
              type="text"
              placeholder="Search the real LEGO set catalog…"
              value={legoQuery}
              onChange={(e) => setLegoQuery(e.target.value)}
            />
            <button type="submit" className="price-search__button" disabled={legoStatus === "loading"}>
              {legoStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </form>
          {legoStatus === "no_key" && <p className="panel__status">LEGO catalog search isn't set up yet — fill in the details manually below.</p>}
          {legoStatus === "error" && <p className="panel__status panel__status--error">Couldn't load the LEGO catalog right now.</p>}
          {legoStatus === "ready" && legoResults.length === 0 && <p className="panel__status">No matches — try a different search.</p>}
          {legoResults.length > 0 && (
            <ul className="backlog-search-results">
              {legoResults.map((set) => (
                <li key={set.setNum} className="backlog-search-results__row">
                  {set.imageUrl && <img src={set.imageUrl} alt="" loading="lazy" decoding="async" />}
                  <span>{set.name}{set.year ? ` (${set.year})` : ""} — #{set.setNum}</span>
                  <button type="button" className="linking-row__connect" onClick={() => handlePickLego(set)}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showVinylSearch && (
        <div className="backlog-add">
          <form className="price-search" onSubmit={handleVinylSearch}>
            <input
              className="price-search__input"
              type="text"
              placeholder="Search the real Discogs vinyl catalog…"
              value={vinylQuery}
              onChange={(e) => setVinylQuery(e.target.value)}
            />
            <button type="submit" className="price-search__button" disabled={vinylStatus === "loading"}>
              {vinylStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </form>
          {vinylStatus === "error" && <p className="panel__status panel__status--error">Couldn't load the vinyl catalog right now.</p>}
          {vinylStatus === "ready" && vinylResults.length === 0 && <p className="panel__status">No matches — try a different search.</p>}
          {vinylResults.length > 0 && (
            <ul className="backlog-search-results">
              {vinylResults.map((release) => (
                <li key={release.id} className="backlog-search-results__row">
                  {release.imageUrl && <img src={release.imageUrl} alt="" loading="lazy" decoding="async" />}
                  <span>{release.title}{release.year ? ` (${release.year})` : ""}{release.format ? ` — ${release.format}` : ""}</span>
                  <button type="button" className="linking-row__connect" onClick={() => handlePickVinyl(release)}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {coverImageUrl && (
        <img src={coverImageUrl} alt="" className="backlog-card__thumb" style={{ alignSelf: "flex-start" }} decoding="async" />
      )}

      <label className="auth-form__field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="auth-form__field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Batman (Chase Variant)" required />
      </label>

      <div className="settings-form-row">
        <label className="auth-form__field">
          <span>Package state</span>
          <select value={packageState} onChange={(e) => setPackageState(e.target.value)}>
            {PACKAGE_STATES.map((s) => (
              <option key={s} value={s}>{PACKAGE_STATE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="auth-form__field">
          <span>Condition</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-form-row">
        <label className="auth-form__field">
          <span>Quantity</span>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="auth-form__field">
          <span>Price paid (optional)</span>
          <input type="number" min="0" step="0.01" value={pricePaid} onChange={(e) => setPricePaid(e.target.value)} placeholder="e.g. 24.99" />
        </label>
      </div>

      <label className="auth-form__field">
        <span>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where you got it, condition details, etc." />
      </label>

      <label className="pref-choice">
        <input type="checkbox" checked={isWishlist} onChange={(e) => setIsWishlist(e.target.checked)} />
        <span>This is a wishlist item (don't own it yet)</span>
      </label>

      <button type="submit" className="linking-row__connect">Save item</button>
    </form>
  );
}

function StatsView({ owned }) {
  const totalItems = owned.reduce((sum, e) => sum + e.qty, 0);
  const sealedCount = owned.filter((e) => e.package_state === "sealed").reduce((sum, e) => sum + e.qty, 0);
  const totalPaid = owned.reduce((sum, e) => sum + (Number(e.price_paid) || 0) * e.qty, 0);
  const anyPriceEntered = owned.some((e) => e.price_paid != null);

  if (owned.length === 0) {
    return <p className="panel__status">Nothing on your shelf yet — stats will show up once you add items.</p>;
  }

  return (
    <div className="backlog-summary" style={{ marginTop: "16px" }}>
      <div className="panel__stat">
        <span className="panel__stat-value">{owned.length}</span>
        <span className="panel__stat-label">Entries</span>
      </div>
      <div className="panel__stat">
        <span className="panel__stat-value">{totalItems}</span>
        <span className="panel__stat-label">Total items</span>
      </div>
      <div className="panel__stat">
        <span className="panel__stat-value">{sealedCount}</span>
        <span className="panel__stat-label">Sealed</span>
      </div>
      {anyPriceEntered && (
        <div className="panel__stat">
          <span className="panel__stat-value">${totalPaid.toFixed(2)}</span>
          <span className="panel__stat-label">Total paid (entered only)</span>
        </div>
      )}
    </div>
  );
}
