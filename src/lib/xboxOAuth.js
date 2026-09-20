// Real Xbox Live sign-in — Microsoft OAuth2 (login.live.com) -> Xbox
// Live user token -> XSTS token, confirmed against OpenXbox/xbox-
// webapi-python's actual working implementation (not guessed). The
// 3-step exchange itself happens server-side (api/pricing.js's
// handleXbox) since it needs a client secret and stores long-lived
// tokens this app never wants to hand to the browser — this file only
// builds the consent URL and calls that proxy.
//
// Packaged (Tauri/Capacitor) support: same custom-URL-scheme mechanism
// as Discord/Twitch (see lib/auth.js's signInWithOAuth /
// OAUTH_CALLBACK_URL comment) — a packaged build can't do a same-
// window redirect back from an external OAuth page the way a plain
// web tab can, so Microsoft is sent to this app's own scheme instead,
// and the OS hands the resulting URL back via Tauri's deep-link plugin
// / Capacitor's appUrlOpen (see AppContext.jsx's dedicated Xbox
// deep-link effect — this isn't routed through oauthRedirect.js since
// completing it needs a real completeXboxLink() call, not just
// applying a Supabase session). Registering this scheme is a one-time
// Azure step: add it as a redirect URI under a "Mobile and desktop
// applications" platform on the same app registration already used
// for the web "Web" platform redirect — the existing client secret
// still applies app-wide, regardless of which platform the redirect
// URI itself is registered under.
import { supabase } from "./supabaseClient";
import { API_BASE } from "./apiBase";
import { isPackagedApp, isTauri } from "./platform";
import { open as openInSystemBrowser } from "@tauri-apps/plugin-shell";
import { Browser } from "@capacitor/browser";

const XBOX_OAUTH_STATE = "xbox-link";
const XBOX_SCOPES = "Xboxlive.signin Xboxlive.offline_access";
export const XBOX_OAUTH_CALLBACK_URL = "lykodex://xbox-callback";

// The redirect_uri Microsoft sends the user back to must exactly match
// what's registered in the Azure app AND what's sent in the token
// exchange - using the app's own root (no path) since this is a
// hash-routed SPA with no server-side rewrite rules for other paths.
// Packaged builds use the custom scheme instead (see file header).
export function xboxRedirectUri() {
  if (isPackagedApp()) return XBOX_OAUTH_CALLBACK_URL;
  return `${window.location.origin}/`;
}

export function getXboxSignInUrl() {
  const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    approval_prompt: "auto",
    scope: XBOX_SCOPES,
    redirect_uri: xboxRedirectUri(),
    state: XBOX_OAUTH_STATE,
  });
  return `https://login.live.com/oauth20_authorize.srf?${params.toString()}`;
}

// Checks the current URL for a Microsoft OAuth callback (?code=...&
// state=xbox-link) — called once at app boot (see AppContext.jsx).
// Cleans the query string off the URL either way so a page refresh
// doesn't try to redeem an already-used code.
export function consumeXboxOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (state !== XBOX_OAUTH_STATE) return null;

  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);

  if (error) return { error: params.get("error_description") || error };
  if (!code) return null;
  return { code };
}

// Same shape as consumeXboxOAuthCallback above, but for a full
// lykodex://xbox-callback URL the OS hands back to a packaged app
// (see AppContext.jsx's deep-link effect) rather than a query string
// on this app's own window.location. Returns null for any URL that
// isn't actually this callback (the deep-link listener sees every
// lykodex:// URL, including Supabase's own auth-callback one).
export function parseXboxOAuthRedirectUrl(url) {
  if (!url.startsWith(XBOX_OAUTH_CALLBACK_URL)) return null;
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return null;

  const params = new URLSearchParams(url.slice(queryIndex + 1));
  const state = params.get("state");
  if (state !== XBOX_OAUTH_STATE) return null;

  const error = params.get("error");
  if (error) return { error: params.get("error_description") || error };
  const code = params.get("code");
  if (!code) return null;
  return { code };
}

// Opens the real Microsoft sign-in page — a plain link works on the
// web (a normal same-window navigation), but a packaged app has to
// hand it to the system/in-app browser instead, exactly like
// Discord/Twitch's signInWithOAuth (see lib/auth.js). Returns false
// if getXboxSignInUrl() couldn't build a URL (client ID not
// configured) so the caller can show its existing "not configured"
// message.
export async function startXboxSignIn() {
  const url = getXboxSignInUrl();
  if (!url) return false;

  if (isPackagedApp()) {
    if (isTauri()) {
      await openInSystemBrowser(url);
    } else {
      await Browser.open({ url });
    }
    return true;
  }

  window.location.href = url;
  return true;
}

async function callXboxService(mode, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch(`${API_BASE}/api/pricing?service=xbox&mode=${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await res.json();
  if (!res.ok) throw new Error(responseBody?.error || `Xbox ${mode} request failed`);
  return responseBody;
}

// Completes the real OAuth exchange for a freshly-received code —
// returns { gamertag, gamerscore }, both real.
export async function completeXboxLink(code) {
  return callXboxService("link", { code, redirectUri: xboxRedirectUri() });
}

// Pulls the current real Gamerscore for an already-linked account —
// this is what Refresh in GameMasterySection calls.
export async function fetchLiveGamerscore() {
  return callXboxService("gamerscore");
}

export async function unlinkXbox() {
  return callXboxService("unlink");
}

// Real online/offline state + whatever title is actively being played
// right now (if any) — { online: boolean, playing: { name,
// richPresence } | null }.
export async function fetchLiveXboxPresence() {
  return callXboxService("presence");
}

// Real full title/play history — { games: [{ titleId, name, imageUrl,
// currentGamerscore, totalGamerscore, lastPlayed }] }.
export async function fetchXboxLibrary() {
  return callXboxService("library");
}

// Real store wishlist — see api/pricing.js's xboxFetchWishlist. May
// fail with 501 until Microsoft exposes a stable list endpoint.
export async function fetchXboxWishlist() {
  return callXboxService("wishlist");
}

// Real per-title achievement list — { achievements: [{ id, name,
// description, icon, unlocked, unlockedAt, gamerscore, rarity }] }.
// titleId comes from fetchXboxLibrary's own titleId, same account this
// achievement list belongs to. See AchievementsPage.jsx for the
// "pick a game from your real library, then sync/refresh" flow.
export async function fetchXboxAchievements(titleId) {
  return callXboxService("achievements", { titleId });
}
