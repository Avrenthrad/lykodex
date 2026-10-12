// Yu-Gi-Oh! — collection tracking and deck building.
// Real card data via YGOPRODeck (see lib/yugioh.js). Mirrors
// lib/pokemonCollection.js closely — no Hero-anchor concept (unlike
// Flesh and Blood/One Piece), real per-format banlist legality
// instead of a plain legal/illegal flag.

import { supabase } from "./supabaseClient";
import { getYugiohCardById } from "./yugioh";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("yugioh_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("yugioh_collection").insert({
    user_id: userId,
    yugioh_card_id: card.id,
    card_name: card.name,
    set_code: card.sets?.[0]?.setCode || null,
    rarity: card.sets?.[0]?.rarity || null,
    quantity,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("yugioh");
  logActivityForUser(userId, "yugioh_card_added", { title: card.name });
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("yugioh_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("yugioh_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live YGOPRODeck data — the row
// itself only stores stable identifiers, never a snapshot that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getYugiohCardById(entry.yugioh_card_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("yugioh_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeck(userId, name, format = "tcg") {
  const { data, error } = await supabase
    .from("yugioh_decks")
    .insert({ user_id: userId, name, format })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("yugioh_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("yugioh_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("yugioh_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

export async function addCardToDeck(deckId, card, { quantity = 1 } = {}) {
  const { error } = await supabase.from("yugioh_deck_cards").insert({
    deck_id: deckId,
    yugioh_card_id: card.id,
    card_name: card.name,
    quantity,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("yugioh_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("yugioh_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}

// Real per-format banlist checking using YGOPRODeck's own
// banlist_info per card — unlike mtg/pokemon's plain legal/illegal
// flag, a card can be legal-but-capped ("Limited" = max 1 copy,
// "Semi-Limited" = max 2), so this returns copy-limit violations too,
// not just outright bans.
const BAN_FIELD = { tcg: "banTcg", ocg: "banOcg", goat: "banGoat" };
const COPY_LIMIT = { Forbidden: 0, Limited: 1, "Semi-Limited": 2 };

export async function checkYugiohDeckLegality(deckCards, format) {
  const banField = BAN_FIELD[format] || "banTcg";
  const enriched = await Promise.all(
    deckCards.map(async (dc) => ({ ...dc, card: await getYugiohCardById(dc.yugioh_card_id) }))
  );
  const violations = enriched
    .filter((dc) => dc.card)
    .map((dc) => {
      const banStatus = dc.card[banField];
      const limit = banStatus ? COPY_LIMIT[banStatus] : undefined;
      if (limit === undefined) return null;
      if (dc.quantity > limit) return { ...dc, banStatus, limit };
      return null;
    })
    .filter(Boolean);
  return { violations, enriched };
}
