// Pokémon TCG — collection tracking and deck building.
// Real card data throughout via pokemontcg.io (see lib/pokemon.js).
// Mirrors lib/mtg.js closely — Pokémon needs no Hero picker and no
// multi-flag legality translation the way Flesh and Blood does, its
// legalities shape is already MTG-like ({standard, expanded, unlimited}).

import { supabase } from "./supabaseClient";
import { getPokemonCardById, getPokemonSet, getPokemonSetCoverArt } from "./pokemon";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("pokemon_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, finish = null, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("pokemon_collection").insert({
    user_id: userId,
    pokemon_card_id: card.id,
    card_name: card.name,
    set_id: card.setId,
    finish,
    quantity,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("pokemon");
  logActivityForUser(userId, "pokemon_card_added", { title: card.name });
}

export async function addManyToCollection(userId, rows) {
  const { error } = await supabase.from("pokemon_collection").insert(
    rows.map((r) => ({
      user_id: userId,
      pokemon_card_id: r.card.id,
      card_name: r.card.name,
      set_id: r.card.setId,
      finish: r.finish || null,
      quantity: r.quantity,
      condition: r.condition || "Near Mint",
      source: r.source || "csv",
    }))
  );
  if (error) throw error;
  notifyCollectionChanged("pokemon");
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("pokemon_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("pokemon_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live pokemontcg.io data — the row
// itself only stores stable identifiers, never a snapshot that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getPokemonCardById(entry.pokemon_card_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("pokemon_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeck(userId, name, format = "standard") {
  const { data, error } = await supabase
    .from("pokemon_decks")
    .insert({ user_id: userId, name, format })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("pokemon_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("pokemon_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("pokemon_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

export async function addCardToDeck(deckId, card, { quantity = 1 } = {}) {
  const { error } = await supabase.from("pokemon_deck_cards").insert({
    deck_id: deckId,
    pokemon_card_id: card.id,
    card_name: card.name,
    quantity,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("pokemon_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("pokemon_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}

// Real format-legality checking using pokemontcg.io's own legalities
// data per card. Confirmed live: values are capitalized "Legal" (not
// Scryfall's lowercase "legal") — a real, deliberate difference, not
// a copy-paste of MTG's check.
export async function checkPokemonDeckLegality(deckCards, format) {
  const enriched = await Promise.all(
    deckCards.map(async (dc) => ({ ...dc, card: await getPokemonCardById(dc.pokemon_card_id) }))
  );
  const illegal = enriched.filter((dc) => dc.card && dc.card.legalities[format] !== "Legal");
  return { illegal, enriched };
}

// ---------- Binders & Set Lists ----------

export async function fetchBinders(userId, kind) {
  let query = supabase.from("pokemon_binders").select("*").eq("user_id", userId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createBinder(userId, { name, labels = [], coverImageUrl = null, notes = null }) {
  const { data, error } = await supabase
    .from("pokemon_binders")
    .insert({ user_id: userId, name, labels, cover_image_url: coverImageUrl, notes, kind: "binder" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Looks up the real set via pokemontcg.io, then creates a binder
// pinned to it with a genuine default cover (the set's real logo) —
// never invented metadata. Confirmed live that set.id filtering
// genuinely scopes correctly for Pokémon (unlike Flesh and Blood's
// equivalent, which doesn't), so set lists are viable here.
export async function createSetList(userId, setId) {
  const set = await getPokemonSet(setId);
  if (!set) throw new Error(`Unknown Pokémon set id: ${setId}`);

  const coverArt = await getPokemonSetCoverArt(setId).catch(() => null);

  const { data, error } = await supabase
    .from("pokemon_binders")
    .insert({
      user_id: userId,
      name: set.name,
      kind: "set_list",
      pokemon_set_id: set.id,
      pokemon_set_name: set.name,
      pokemon_set_icon_url: set.symbolUrl,
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
    .from("pokemon_binders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", binderId);
  if (error) throw error;
}

export async function deleteBinder(binderId) {
  const { error } = await supabase.from("pokemon_binders").delete().eq("id", binderId);
  if (error) throw error;
}

export async function fetchBinderCards(binderId) {
  const { data, error } = await supabase
    .from("pokemon_binder_cards")
    .select("*")
    .eq("binder_id", binderId);
  if (error) throw error;
  return data || [];
}

// One row per (binder, card, finish) — re-adding the same finish
// updates its quantity instead of stacking a duplicate row.
export async function setBinderCardQuantity(binderId, card, quantity, { finish = null, condition = "Near Mint", source } = {}) {
  if (quantity <= 0) {
    let deleteQuery = supabase
      .from("pokemon_binder_cards")
      .delete()
      .eq("binder_id", binderId)
      .eq("pokemon_card_id", card.id);
    // Supabase's .eq() never matches NULL rows (SQL `= NULL` is never
    // true) — finish is null whenever no specific finish was picked, so
    // that case needs .is() instead or the delete matches nothing.
    deleteQuery = finish === null
      ? deleteQuery.is("finish", null)
      : deleteQuery.eq("finish", finish);
    const { error } = await deleteQuery;
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("pokemon_binder_cards")
    .upsert(
      {
        binder_id: binderId,
        pokemon_card_id: card.id,
        card_name: card.name,
        set_id: card.setId,
        finish,
        quantity,
        condition,
        ...(source ? { source } : {}),
      },
      { onConflict: "binder_id,pokemon_card_id,finish" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeBinderCard(binderCardId) {
  const { error } = await supabase.from("pokemon_binder_cards").delete().eq("id", binderCardId);
  if (error) throw error;
}

// Shared cover-photo upload for binders, set lists, and decks — same
// real Supabase Storage pattern as lib/mtg.js's uploadCoverImage, just
// against the "pokemon-covers" bucket.
export async function uploadCoverImage(userId, file) {
  const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
  const mimeExt = file.type?.split("/")?.[1];
  const ext = (nameExt || mimeExt || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("pokemon-covers")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("pokemon-covers").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
