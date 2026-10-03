// Shared localStorage cache with expiry — used to keep repeated
// lookups (Xbox pricing especially, given its 1,000/month free-tier
// limit) from re-hitting APIs every time the page loads. Unlike
// sessionStorage, this survives closing the tab/browser entirely, so
// a 100-game wishlist only actually costs its API quota once per
// TTL window, not once per visit.

export function getCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const { value, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > ttlMs) {
      localStorage.removeItem(key);
      return undefined;
    }
    return value;
  } catch {
    return undefined; // corrupted entry or storage unavailable — just skip caching
  }
}

export function setCached(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // Storage full/unavailable (e.g. private browsing) — not worth failing over.
  }
}

export function deleteCached(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing to drop.
  }
}

// Common TTLs used across the app's API caches.
export const CACHE_TTL = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
};
