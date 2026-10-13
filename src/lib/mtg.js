// Magic: The Gathering — collection tracking and deck building.
// Real card data throughout via Scryfall (see lib/scryfall.js).

import { supabase } from "./supabaseClient";
import { getCardById, getSet, getSetCoverArt } from "./scryfall";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("mtg_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, foil = false, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("mtg_collection").insert({
    user_id: userId,
    scryfall_id: card.id,
    card_name: card.name,
    set_code: card.setCode,
    quantity,
    foil,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("mtg");
  logActivityForUser(userId, "mtg_card_added", { title: card.name });
}

// Bulk version for CSV import — one real insert per confirmed row
// rather than a synthetic batch call, so a partial failure doesn't
// silently drop good rows (each is caught/reported independently by
// the caller — see CsvImportPage).
export async function addManyToCollection(userId, rows) {
  const { error } = await supabase.from("mtg_collection").insert(
    rows.map((r) => ({
      user_id: userId,
      scryfall_id: r.card.id,
      card_name: r.card.name,
      set_code: r.card.setCode,
      quantity: r.quantity,
      foil: r.foil,
      condition: r.condition || "Near Mint",
      source: r.source || "csv",
    }))
  );
  if (error) throw error;
  notifyCollectionChanged("mtg");
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("mtg_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("mtg_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live Scryfall data (image,
// current price, legalities) — the row itself only stores the stable
// identifiers, not a snapshot of data that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getCardById(entry.scryfall_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("mtg_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeck(userId, name, format = "commander") {
  const { data, error } = await supabase
    .from("mtg_decks")
    .insert({ user_id: userId, name, format })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("mtg_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("mtg_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("mtg_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

export async function addCardToDeck(deckId, card, { quantity = 1, isSideboard = false } = {}) {
  const { error } = await supabase.from("mtg_deck_cards").insert({
    deck_id: deckId,
    scryfall_id: card.id,
    card_name: card.name,
    quantity,
    is_sideboard: isSideboard,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("mtg_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("mtg_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}

// Real format-legality checking using Scryfall's own legalities data
// per card — not a guess. Returns which cards (if any) aren't legal
// in the deck's chosen format, so the deck builder can flag them
// honestly instead of silently allowing an illegal deck.
export async function checkDeckLegality(deckCards, format) {
  const enriched = await Promise.all(
    deckCards.map(async (dc) => ({ ...dc, card: await getCardById(dc.scryfall_id) }))
  );
  const illegal = enriched.filter((dc) => dc.card && dc.card.legalities[format] !== "legal");
  return { illegal, enriched };
}

// ---------- Binders & Set Lists ----------
// Same table (mtg_binders), split by kind: a plain "binder" is just a
// user-named group of cards; a "set_list" is additionally pinned to
// one real Scryfall set and doubles as that set's owned-quantity
// checklist. See supabase/schema.sql for the RLS/ownership pattern.

export async function fetchBinders(userId, kind) {
  let query = supabase.from("mtg_binders").select("*").eq("user_id", userId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createBinder(userId, { name, labels = [], coverImageUrl = null, notes = null }) {
  const { data, error } = await supabase
    .from("mtg_binders")
    .insert({ user_id: userId, name, labels, cover_image_url: coverImageUrl, notes, kind: "binder" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Looks up the real set on Scryfall, then creates a binder pinned to
// it with a genuine default cover (a real card's art from that set)
// and the set's own icon — never invented metadata.
export async function createSetList(userId, setCode) {
  const set = await getSet(setCode);
  if (!set) throw new Error(`Unknown Scryfall set code: ${setCode}`);

  const coverArt = await getSetCoverArt(setCode).catch(() => null);

  const { data, error } = await supabase
    .from("mtg_binders")
    .insert({
      user_id: userId,
      name: set.name,
      kind: "set_list",
      set_code: set.code,
      set_name: set.name,
      scryfall_set_icon_url: set.iconSvgUri,
      cover_image_url: coverArt,
      labels: [],
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBinder(binderId, patch) {
  const { error } = await supabase
    .from("mtg_binders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", binderId);
  if (error) throw error;
}

export async function deleteBinder(binderId) {
  const { error } = await supabase.from("mtg_binders").delete().eq("id", binderId);
  if (error) throw error;
}

export async function fetchBinderCards(binderId) {
  const { data, error } = await supabase
    .from("mtg_binder_cards")
    .select("*")
    .eq("binder_id", binderId);
  if (error) throw error;
  return data || [];
}

// One row per card per binder — re-adding the same card updates its
// quantity instead of stacking a duplicate row (see the unique
// (binder_id, scryfall_id) constraint in schema.sql).
export async function setBinderCardQuantity(binderId, card, quantity, { foil = false, condition = "Near Mint", source } = {}) {
  if (quantity <= 0) {
    const { error } = await supabase
      .from("mtg_binder_cards")
      .delete()
      .eq("binder_id", binderId)
      .eq("scryfall_id", card.id);
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("mtg_binder_cards")
    .upsert(
      {
        binder_id: binderId,
        scryfall_id: card.id,
        card_name: card.name,
        set_code: card.setCode,
        quantity,
        condition,
        foil,
        ...(source ? { source } : {}),
      },
      { onConflict: "binder_id,scryfall_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeBinderCard(binderCardId) {
  const { error } = await supabase.from("mtg_binder_cards").delete().eq("id", binderCardId);
  if (error) throw error;
}

// Shared cover-photo upload for binders, set lists, and decks — same
// real Supabase Storage pattern as avatar upload (see
// AccountSettingsPage), just against the "mtg-covers" bucket instead.
// Unlike the avatar (one fixed filename per user), each cover needs
// its own permanent path since one person can have many binders/decks.
export async function uploadCoverImage(userId, file) {
  const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
  const mimeExt = file.type?.split("/")?.[1];
  const ext = (nameExt || mimeExt || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("mtg-covers")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("mtg-covers").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
