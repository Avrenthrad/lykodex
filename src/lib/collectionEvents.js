// Collection screens fetch once, when they mount. Adding a card happens
// on the search page — a different view — so a list that is still
// mounted keeps the pre-add rows until a full browser reload. Inserts
// notify here; open collection screens refetch in place.

const EVENT = "lykodex:collection-changed";

export function notifyCollectionChanged(game) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { game } }));
}

export function subscribeCollectionChanged(game, onChange) {
  function handler(event) {
    if (event.detail?.game === game) onChange();
  }
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
