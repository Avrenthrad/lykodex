// Riftbound — collection tracking and deck building.
// Real card data via Riftcodex, proxied through api/pricing.js (see
// lib/riftbound.js). No format/legality checking here — no confirmed
// banlist API exists for a game this new, so a deck is just a named
// list of cards, not a legal/illegal-checked build the way mtg/
// pokemon/yugioh decks are.

import { supabase } from "./supabaseClient";
import { getRiftboundCardById } from "./riftbound";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("riftbound_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("riftbound_collection").insert({
    user_id: userId,
    riftbound_card_id: card.id,
    card_name: card.name,
    set_id: card.setId,
    rarity: card.rarity,
    quantity,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("riftbound");
  logActivityForUser(userId, "riftbound_card_added", { title: card.name });
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("riftbound_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("riftbound_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live Riftcodex data — the row
// itself only stores stable identifiers, never a snapshot that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getRiftboundCardById(entry.riftbound_card_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("riftbound_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeck(userId, name) {
  const { data, error } = await supabase
    .from("riftbound_decks")
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("riftbound_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("riftbound_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("riftbound_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

export async function addCardToDeck(deckId, card, { quantity = 1 } = {}) {
  const { error } = await supabase.from("riftbound_deck_cards").insert({
    deck_id: deckId,
    riftbound_card_id: card.id,
    card_name: card.name,
    quantity,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("riftbound_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("riftbound_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}
