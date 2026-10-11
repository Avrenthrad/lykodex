// Real email/password + OAuth auth via Supabase.

import { supabase, supabaseUrl, supabaseAnonKey } from "./supabaseClient";
import { isPackagedApp, isTauri } from "./platform";
import { Browser } from "@capacitor/browser";
import { open as openInSystemBrowser } from "@tauri-apps/plugin-shell";

// Which OAuth providers are actually enabled in Supabase right now —
// checked BEFORE ever attempting a sign-in. Without this, clicking a
// not-yet-enabled provider (Google, until its dashboard setup is done)
// navigates the whole page to Supabase's own /authorize endpoint,
// which 400s with a raw JSON error body — supabase-js's
// signInWithOAuth() doesn't reject for this case (constructing the
// redirect URL is a pure client-side operation; it has no idea
// whether the provider is enabled server-side), so there was never
// actually a JS exception here to catch and turn into a friendly
// message. This is Supabase's own public settings endpoint (needs the
// anon key as a header, not a secret — same key already shipped to
// every client) rather than anything provider-specific.
export async function fetchEnabledOAuthProviders() {
  if (!supabaseUrl || !supabaseAnonKey) return {};
  const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: supabaseAnonKey },
  });
  if (!res.ok) return {};
  const data = await res.json();
  return data?.external || {};
}

// Packaged apps can't complete a same-window redirect back from an
// external OAuth page the way a normal website tab can — the OAuth
// provider page opens in a separate system/in-app browser, not the
// app's own webview. This custom scheme is what that browser redirects
// back to instead; the native OS hands the URL back to the app (via
// Capacitor's appUrlOpen / Tauri's deep-link plugin — see
// oauthRedirect.js), which is why Android/iOS/Tauri each need this
// scheme registered (AndroidManifest.xml, Info.plist, tauri.conf.json).
// Must also be added to Supabase's own Authentication > URL
// Configuration > Redirect URLs allowlist, same one-time dashboard
// step as enabling the OAuth provider itself.
export const OAUTH_CALLBACK_URL = "lykodex://auth-callback";

// consent: { termsVersion } — recorded on the auth user's metadata
// with a timestamp, as a record that this person confirmed the minimum
// age and agreed to the Terms and Privacy Policy when signing up.
export async function signUp(email, password, consent) {
  const metadata = consent
    ? {
        terms_accepted_at: new Date().toISOString(),
        terms_version: consent.termsVersion,
        age_confirmed: consent.minAge,
      }
    : undefined;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata } });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Real OAuth sign-in (not linking — see linkIdentity below for that).
// Supabase's signInWithOAuth() redirects the browser to the provider
// itself by default, so this "returns" only if kicking off the
// redirect fails (provider not enabled in Supabase, etc.) — a
// successful call never resolves here, the page navigates away.
//
// Setup needed per provider (Supabase dashboard, not code):
//   Authentication > Providers > enable it, paste the Client ID/Secret
//   from that provider's own developer console, and add this app's
//   real deployed URL (now that one exists) as an authorized redirect
//   there. Apple additionally requires a Services ID + a private key
//   generated in Apple's developer portal, not just a client secret.
export async function signInWithOAuth(provider) {
  if (isPackagedApp()) {
    // skipBrowserRedirect: get the provider URL back as data instead of
    // Supabase navigating window.location itself (there's no sensible
    // "current window" to navigate in a packaged app's webview for an
    // external auth page — and Google/most providers actively refuse to
    // sign in at all inside an embedded webview).
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: OAUTH_CALLBACK_URL, skipBrowserRedirect: true },
    });
    if (error) throw error;

    if (isTauri()) {
      await openInSystemBrowser(data.url);
    } else {
      await Browser.open({ url: data.url });
    }
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    // Always the site root + #/dashboard: this exact URL is on Supabase's
    // redirect allow-list. lib/router.js turns #/dashboard into /dashboard
    // on arrival.
    options: { redirectTo: `${window.location.origin}/#/dashboard` },
  });
  if (error) throw error;
}

// Called from oauthRedirect.js once the OS hands the app the
// lykodex://auth-callback URL. Supabase's default (non-PKCE) OAuth
// flow puts the session tokens in the URL's hash fragment, exactly
// like the plain-web flow — the only difference is nothing auto-parses
// that fragment here (there's no real page navigation to trigger
// Supabase's own detectSessionInUrl), so it's extracted and applied
// manually via setSession.
export async function handleOAuthRedirectUrl(url) {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return false;

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return true;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Real OAuth account linking (Discord, Twitch) — genuinely different
// from the Bungie/Destiny 2 OAuth built earlier: that needed OUR
// deployed URL registered with Bungie directly. This uses Supabase's
// own built-in OAuth handling, whose callback URL is Supabase's own
// fixed domain (doesn't depend on our deployment at all) — meaning
// this can actually be set up and tested during local dev right now,
// not blocked on deployment like Destiny 2 was.
//
// Setup needed (one-time, in Supabase's dashboard, not code):
//   1. Authentication > Providers > enable Discord/Twitch, paste in
//      the Client ID/Secret from each platform's own developer portal
//   2. Authentication > Settings > enable "Allow manual linking"
//      (required specifically for linkIdentity, not just normal login)
// Each provider's app registration needs Supabase's callback URL
// added as an allowed redirect — that's shown right on the same
// Supabase provider settings page once you're there.
export async function linkIdentity(provider) {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: `${window.location.origin}/#/linking` },
  });
  if (error) throw error;
  return data; // { url } — caller should redirect the browser here
}

export async function unlinkProviderIdentity(provider) {
  const { data: identitiesData, error: listError } = await supabase.auth.getUserIdentities();
  if (listError) throw listError;
  const identity = identitiesData.identities.find((i) => i.provider === provider);
  if (!identity) return;
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) throw error;
}

export async function getLinkedProviders() {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return data.identities.map((i) => i.provider);
}

// Records the Discord snowflake ID in discord_links right after a
// successful link — this is what lets the presence bot (running
// separately, using the service_role key) match a Discord presence
// update back to a Lykodex account. Self-contained — fetches its
// own session rather than requiring a userId param, so it's safe to
// call from anywhere right after checking Discord is linked.
//
// Field priority: Supabase's own top-level Identity.id is documented
// as "the provider identifier of the user" (the cleanest, most
// abstracted source) — checked first. identity_data.id is the second
// choice since Discord's own raw OAuth user object (what identity_data
// actually holds) genuinely uses the field name "id" for the snowflake
// per Discord's API docs, not "provider_id"/"sub" (those aren't real
// Discord field names — kept only as a last-resort fallback in case
// Supabase normalizes the payload differently than expected). Never
// tested against a real live Discord link, so the warning below logs
// the raw shape if all of these come up empty, rather than failing
// silently with no way to diagnose it.
export async function syncDiscordLink() {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;

  const discordIdentity = data.identities.find((i) => i.provider === "discord");
  if (!discordIdentity) return; // not linked (yet, or unlinked) — nothing to sync

  const discordUserId =
    discordIdentity.id ||
    discordIdentity.identity_data?.id ||
    discordIdentity.identity_data?.provider_id ||
    discordIdentity.identity_data?.sub;
  if (!discordUserId) {
    console.warn(
      "Couldn't find a Discord user ID in the linked identity — raw identity for debugging:",
      discordIdentity
    );
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return;

  const { error: upsertError } = await supabase
    .from("discord_links")
    .upsert({ user_id: userId, discord_user_id: String(discordUserId), updated_at: new Date().toISOString() });
  if (upsertError) throw upsertError;
}

export async function removeDiscordLink(userId) {
  const { error } = await supabase.from("discord_links").delete().eq("user_id", userId);
  if (error) throw error;
}

// ---------- "Act as Lykodex" — real session swap, not a pretend
// client-side toggle. RLS needs a genuine auth.uid() to enforce
// anything anywhere, so the only correct way to make writes actually
// happen "as Lykodex" everywhere in the app is a real session swap —
// see api/pricing.js's lykodex-session handler for the server side
// (it independently re-verifies the caller is the registered delegate
// every time; this client check is only ever for UI visibility).

// Whether the CURRENT signed-in account is the one registered
// delegate for the Lykodex system account — purely to decide whether
// to show the toggle at all.
export async function checkIsLykodexDelegate() {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("am_i_lykodex_delegate");
  if (error) {
    console.error("Failed to check Lykodex delegate status:", error);
    return false;
  }
  return Boolean(data);
}

// Permanently deletes the signed-in person's own account and data
// (server side: api/pricing.js handleAccountDelete). The caller should
// sign out locally afterwards.
export async function deleteMyAccount() {
  const { data: current } = await supabase.auth.getSession();
  const token = current.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const { API_BASE } = await import("./apiBase");
  const res = await fetch(`${API_BASE}/api/pricing?service=account-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Couldn't delete your account.");
}

// Exchanges the caller's own (already-verified-server-side) session
// for a genuine Lykodex session. Throws if the caller isn't actually
// the registered delegate — the server checks this independently of
// whatever checkIsLykodexDelegate() showed in the UI.
export async function requestLykodexSession() {
  const { data: current } = await supabase.auth.getSession();
  const callerToken = current.session?.access_token;
  if (!callerToken) throw new Error("Not signed in.");

  const { API_BASE } = await import("./apiBase");
  const res = await fetch(`${API_BASE}/api/pricing?service=lykodex-session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${callerToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || "Couldn't start acting as Lykodex.");
  return body.session; // { access_token, refresh_token, ... }
}
