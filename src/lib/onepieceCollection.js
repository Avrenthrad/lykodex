// One Piece Card Game — collection tracking and deck building.
// Real card data via optcgapi.com (see lib/onepiece.js). Mirrors
// lib/fabCollection.js's Hero-anchor shape — a One Piece deck is
// built around exactly one Leader card the same way a Flesh and Blood
// deck is built around one Hero.

import { supabase } from "./supabaseClient";
import { getOnePieceCardById } from "./onepiece";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("onepiece_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("onepiece_collection").insert({
    user_id: userId,
    onepiece_card_id: card.id,
    card_name: card.name,
    set_id: card.setId,
    rarity: card.rarity,
    quantity,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("onepiece");
  logActivityForUser(userId, "onepiece_card_added", { title: card.name });
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("onepiece_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("onepiece_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live optcgapi.com data — the row
// itself only stores stable identifiers, never a snapshot that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getOnePieceCardById(entry.onepiece_card_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("onepiece_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeck(userId, name) {
  const { data, error } = await supabase
    .from("onepiece_decks")
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setDeckLeader(deckId, card) {
  const { error } = await supabase
    .from("onepiece_decks")
    .update({ leader_card_id: card.id, leader_card_name: card.name, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("onepiece_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("onepiece_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("onepiece_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

export async function addCardToDeck(deckId, card, { quantity = 1 } = {}) {
  const { error } = await supabase.from("onepiece_deck_cards").insert({
    deck_id: deckId,
    onepiece_card_id: card.id,
    card_name: card.name,
    quantity,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("onepiece_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("onepiece_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}
