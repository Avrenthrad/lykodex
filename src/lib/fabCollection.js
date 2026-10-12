// Flesh and Blood — collection tracking and deck building.
// Real card data throughout via goagain.dev (see lib/fab.js).
// Mirrors lib/mtg.js's shape function-for-function where the real data
// is actually the same shape; deviates where it genuinely isn't (see
// checkFabDeckLegality and createDeck's required heroCard below).

import { supabase } from "./supabaseClient";
import { getFabCardById, getFabSet, getFabSetCoverArt, isFabCardIllegal } from "./fab";
import { logActivityForUser } from "./guilds";
import { notifyCollectionChanged } from "./collectionEvents";

// ---------- Collection ----------

export async function fetchCollection(userId) {
  const { data, error } = await supabase
    .from("fab_collection")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToCollection(userId, card, { quantity = 1, printingUniqueId = null, foiling = null, setId = null, edition = null, condition = "Near Mint", source = "manual" } = {}) {
  const { error } = await supabase.from("fab_collection").insert({
    user_id: userId,
    fab_card_id: card.id,
    card_name: card.name,
    printing_unique_id: printingUniqueId,
    set_id: setId,
    edition,
    foiling,
    quantity,
    condition,
    source,
  });
  if (error) throw error;
  notifyCollectionChanged("fab");
  logActivityForUser(userId, "fab_card_added", { title: card.name });
}

// Bulk version for CSV import — one real insert per confirmed row, same
// reasoning as lib/mtg.js's addManyToCollection (a partial failure
// shouldn't silently drop good rows).
export async function addManyToCollection(userId, rows) {
  const { error } = await supabase.from("fab_collection").insert(
    rows.map((r) => ({
      user_id: userId,
      fab_card_id: r.card.id,
      card_name: r.card.name,
      printing_unique_id: r.printingUniqueId || null,
      set_id: r.setId || null,
      edition: r.edition || null,
      foiling: r.foiling || null,
      quantity: r.quantity,
      condition: r.condition || "Near Mint",
      source: r.source || "csv",
    }))
  );
  if (error) throw error;
  notifyCollectionChanged("fab");
}

export async function updateCollectionEntry(entryId, patch) {
  const { error } = await supabase.from("fab_collection").update(patch).eq("id", entryId);
  if (error) throw error;
}

export async function removeFromCollection(entryId) {
  const { error } = await supabase.from("fab_collection").delete().eq("id", entryId);
  if (error) throw error;
}

// Enriches raw collection rows with live goagain data — the row itself
// only stores stable identifiers, never a snapshot that goes stale.
export async function enrichCollectionEntry(entry) {
  const card = await getFabCardById(entry.fab_card_id);
  return { ...entry, card };
}

// ---------- Decks ----------

export async function fetchDecks(userId) {
  const { data, error } = await supabase
    .from("fab_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// heroCard is required — every real FaB constructed format is built
// around exactly one Hero, unlike MTG where only Commander/Brawl need
// one. hero_card_id/hero_card_name are nullable at the DB level (a row
// can exist mid-creation via updateDeck later) but this function's own
// signature requires it, matching how the deck actually gets built.
export async function createDeck(userId, name, format, heroCard) {
  const { data, error } = await supabase
    .from("fab_decks")
    .insert({
      user_id: userId,
      name,
      format,
      hero_card_id: heroCard.id,
      hero_card_name: heroCard.name,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeck(deckId, patch) {
  const { error } = await supabase
    .from("fab_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId) {
  const { error } = await supabase.from("fab_decks").delete().eq("id", deckId);
  if (error) throw error;
}

export async function fetchDeckCards(deckId) {
  const { data, error } = await supabase
    .from("fab_deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  return data || [];
}

// No isSideboard param — no confirmed FaB constructed-play equivalent
// to MTG's sideboarding, so fab_deck_cards has no matching column.
export async function addCardToDeck(deckId, card, { quantity = 1 } = {}) {
  const { error } = await supabase.from("fab_deck_cards").insert({
    deck_id: deckId,
    fab_card_id: card.id,
    card_name: card.name,
    quantity,
  });
  if (error) throw error;
}

export async function updateDeckCardQuantity(cardRowId, quantity) {
  const { error } = await supabase.from("fab_deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCardFromDeck(cardRowId) {
  const { error } = await supabase.from("fab_deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}

// Real format-legality checking using goagain's own per-card format
// flags — NOT a straight port of lib/mtg.js's checkDeckLegality, since
// goagain has six separate boolean triples instead of one legalities
// map (see lib/fab.js's isFabCardIllegal / normalizeFabCard.formats).
// suspended/restricted are returned separately as softer warnings,
// never collapsed into "illegal" — the deck builder shows them
// distinctly rather than picking one bucket to lump them into.
//
// Class-vs-Hero matching (is this card legal for THIS specific Hero,
// not just this format) is deliberately not checked here — deferred
// pending confirming which types[] token is the class (see the plan's
// Phase 3b). This only checks the format-wide legal/banned flags plus
// the required Hero pick itself.
export async function checkFabDeckLegality(deckCards, format) {
  const enriched = await Promise.all(
    deckCards.map(async (dc) => ({ ...dc, card: await getFabCardById(dc.fab_card_id) }))
  );
  const illegal = enriched.filter((dc) => dc.card && isFabCardIllegal(dc.card, format));
  const warnings = enriched.filter((dc) => {
    const f = dc.card?.formats?.[format];
    return f && !isFabCardIllegal(dc.card, format) && (f.suspended || f.restricted);
  });
  return { illegal, warnings, enriched };
}

// ---------- Binders & Set Lists ----------
// Same table (fab_binders), split by kind — same shape as mtg_binders.

export async function fetchBinders(userId, kind) {
  let query = supabase.from("fab_binders").select("*").eq("user_id", userId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createBinder(userId, { name, labels = [], coverImageUrl = null, notes = null }) {
  const { data, error } = await supabase
    .from("fab_binders")
    .insert({ user_id: userId, name, labels, cover_image_url: coverImageUrl, notes, kind: "binder" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Looks up the real set via goagain, then creates a binder pinned to
// it with a genuine default cover (the set's real logo image) — never
// invented metadata. fab_set_icon_url may end up null if this
// particular set has no printing with a set_logo — an honest gap, not
// a fabricated one.
export async function createSetList(userId, setId) {
  const set = await getFabSet(setId);
  if (!set) throw new Error(`Unknown Flesh and Blood set id: ${setId}`);

  const coverArt = await getFabSetCoverArt(setId).catch(() => null);

  const { data, error } = await supabase
    .from("fab_binders")
    .insert({
      user_id: userId,
      name: set.name,
      kind: "set_list",
      fab_set_id: set.code,
      fab_set_name: set.name,
      fab_set_icon_url: coverArt,
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
    .from("fab_binders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", binderId);
  if (error) throw error;
}

export async function deleteBinder(binderId) {
  const { error } = await supabase.from("fab_binders").delete().eq("id", binderId);
  if (error) throw error;
}

export async function fetchBinderCards(binderId) {
  const { data, error } = await supabase
    .from("fab_binder_cards")
    .select("*")
    .eq("binder_id", binderId);
  if (error) throw error;
  return data || [];
}

// One row per (binder, card, printing) — re-adding the same printing
// updates its quantity instead of stacking a duplicate row (see the
// unique (binder_id, fab_card_id, printing_unique_id) constraint).
export async function setBinderCardQuantity(binderId, card, quantity, { printingUniqueId = null, foiling = null, setId = null, edition = null, condition = "Near Mint", source } = {}) {
  if (quantity <= 0) {
    let deleteQuery = supabase
      .from("fab_binder_cards")
      .delete()
      .eq("binder_id", binderId)
      .eq("fab_card_id", card.id);
    // Supabase's .eq() never matches NULL rows (SQL `= NULL` is never
    // true) — printingUniqueId is null whenever no specific printing was
    // picked, so that case needs .is() instead or the delete matches
    // nothing.
    deleteQuery = printingUniqueId === null
      ? deleteQuery.is("printing_unique_id", null)
      : deleteQuery.eq("printing_unique_id", printingUniqueId);
    const { error } = await deleteQuery;
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("fab_binder_cards")
    .upsert(
      {
        binder_id: binderId,
        fab_card_id: card.id,
        card_name: card.name,
        printing_unique_id: printingUniqueId,
        set_id: setId,
        edition,
        foiling,
        quantity,
        condition,
        ...(source ? { source } : {}),
      },
      { onConflict: "binder_id,fab_card_id,printing_unique_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeBinderCard(binderCardId) {
  const { error } = await supabase.from("fab_binder_cards").delete().eq("id", binderCardId);
  if (error) throw error;
}

// Shared cover-photo upload for binders, set lists, and decks — same
// real Supabase Storage pattern as lib/mtg.js's uploadCoverImage, just
// against the "fab-covers" bucket.
export async function uploadCoverImage(userId, file) {
  const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
  const mimeExt = file.type?.split("/")?.[1];
  const ext = (nameExt || mimeExt || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("fab-covers")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("fab-covers").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
