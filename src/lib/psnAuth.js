// Real PlayStation Network trophy sync via a person's own npsso token
// — Sony offers no public OAuth app registration path, so this is the
// same unofficial-but-real mechanism every PSN trophy tracker
// (PSNProfiles etc.) uses, confirmed against achievements-app/psn-api's
// actual working implementation (not guessed). The npsso is a 64-char
// session-cookie value the person copies from their own browser after
// signing into https://ca.account.sony.com/api/v1/ssocookie — it's
// sent once to complete linking, never stored here (only the
// resulting access/refresh tokens are, server-side — see
// api/pricing.js's handlePsn).

import { supabase } from "./supabaseClient";
import { API_BASE } from "./apiBase";

async function callPsnService(mode, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch(`${API_BASE}/api/pricing?service=psn&mode=${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await res.json();
  if (!res.ok) throw new Error(responseBody?.error || `PSN ${mode} request failed`);
  return responseBody;
}

// Completes the real npsso -> access code -> token exchange — returns
// { trophies: { bronze, silver, gold, platinum } }, all real.
export async function linkPsnAccount(npsso) {
  return callPsnService("link", { npsso });
}

// Pulls current real trophy counts for an already-linked account —
// this is what Refresh in GameMasterySection calls.
export async function fetchLiveTrophies() {
  return callPsnService("trophies");
}

export async function unlinkPsn() {
  return callPsnService("unlink");
}

// Real online/offline state + whatever title is actively being played
// right now (if any) — { online: boolean, playing: { name } | null }.
export async function fetchLivePsnPresence() {
  return callPsnService("presence");
}

// Real played-games list — { games: [{ titleId, name, imageUrl, lastPlayed }] }.
export async function fetchPsnLibrary() {
  return callPsnService("library");
}

// Real PS Store wishlist — undocumented GraphQL query, same mechanism
// trophy trackers use (see api/pricing.js's psnFetchWishlist).
export async function fetchPsnWishlist() {
  return callPsnService("wishlist");
}

// Real trophy-eligible game list — { games: [{ npCommunicationId,
// npServiceName, name, imageUrl, platform, definedTrophies,
// earnedTrophies }] }. This is the real source for "which games can
// this account sync trophies for", NOT fetchPsnLibrary above — that's
// a general played-games list (includes non-game apps, and its titleId
// is a different ID space that 404s against the trophy endpoints,
// confirmed live). See AchievementsPage.jsx's game-picker.
export async function fetchPsnTrophyTitles() {
  return callPsnService("trophy-titles");
}

// Real per-title trophy list — { trophies: [{ trophyId, name,
// description, icon, type, unlocked, unlockedAt, rarity }] }.
// npCommunicationId and npServiceName both come from fetchPsnTrophyTitles
// above (per-title, not guessable — see api/pricing.js's
// psnFetchMergedTrophiesForTitle for why a fallback guess was wrong).
export async function fetchPsnTitleTrophies(npCommunicationId, npServiceName) {
  return callPsnService("title-trophies", { npCommunicationId, npServiceName });
}
