// URL <-> view routing.
//
// Website: real paths (lykodex.app/tcg-home, /login/signup). Vercel
// rewrites every non-file, non-/api path to index.html (vercel.json),
// and Vite's dev/preview servers do the same by default.
//
// Packaged apps (Tauri desktop, Capacitor mobile): keep #/view hashes.
// They load index.html from a local file/custom scheme with no server
// to rewrite a deep path back to it, so a reload on /tcg-home would 404.
//
// Old #/view links (bookmarks, shared links, and the Supabase OAuth
// redirectTo values in lib/auth.js, which deliberately still end in
// #/dashboard or #/linking so the redirect allow-list doesn't change)
// are converted to the matching path on load. Hashes that aren't a
// plain route (e.g. Supabase's #access_token=... after OAuth) are left
// alone for supabase-js to consume.

import { isPackagedApp } from "./platform";

export const NAVIGATE_EVENT = "lykodex:navigate";

const ROUTE_HASH = /^#\/([a-z0-9-]+)(?:\/([a-z]+))?\/?$/;

export function usesPathRouting() {
  return !isPackagedApp();
}

function splitRoute(route) {
  const [view = "", sub] = route.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  return { view, sub };
}

// Returns { view, sub } for the current location. view "" means home.
export function readLocation() {
  if (!usesPathRouting()) {
    return splitRoute(window.location.hash.replace(/^#\/?/, ""));
  }
  return splitRoute(window.location.pathname);
}

// Website only: turn a legacy #/view URL into /view in place. Returns
// true if it rewrote the URL.
export function upgradeLegacyHash() {
  if (!usesPathRouting()) return false;
  const match = window.location.hash.match(ROUTE_HASH);
  if (!match) return false;
  const [, view, sub] = match;
  const path = view === "overview" ? "/" : `/${view}${sub ? `/${sub}` : ""}`;
  window.history.replaceState(window.history.state, "", path + window.location.search);
  return true;
}

// href for a link to a view (used by plain <a> tags, e.g. legal links).
export function routeHref(view, sub) {
  const route = view === "overview" ? "" : `${view}${sub ? `/${sub}` : ""}`;
  return usesPathRouting() ? `/${route}` : `#/${route}`;
}

// Navigate to a view. replace: overwrite the current history entry.
export function navigate(view, sub, { replace = false } = {}) {
  const href = routeHref(view, sub);
  if (usesPathRouting()) {
    if (window.location.pathname + window.location.hash !== href) {
      window.history[replace ? "replaceState" : "pushState"](null, "", href);
    }
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  } else if (replace) {
    window.history.replaceState(null, "", href);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  } else {
    window.location.hash = href; // fires hashchange
  }
}

// Calls onChange whenever the route changes (back/forward, navigate()).
export function subscribeToRoute(onChange) {
  const browserEvent = usesPathRouting() ? "popstate" : "hashchange";
  window.addEventListener(browserEvent, onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener(browserEvent, onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

// Website only: make plain same-origin <a href="/view"> links navigate
// in-app instead of reloading the page. isKnownView(view) decides which
// paths belong to the app.
export function interceptInternalLinks(isKnownView) {
  if (!usesPathRouting()) return () => {};
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
    const legacy = url.hash.match(ROUTE_HASH);
    // In-page #section anchors: leave to the browser.
    if (url.hash && !legacy && url.pathname === window.location.pathname) return;
    const { view, sub } = legacy ? { view: legacy[1], sub: legacy[2] } : splitRoute(url.pathname);
    if (view && !isKnownView(view)) return;
    e.preventDefault();
    navigate(view || "overview", sub);
  }
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
