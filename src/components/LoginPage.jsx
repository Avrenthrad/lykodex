// Auth screen — real email/password via Supabase, plus real OAuth
// sign-in via Supabase's own signInWithOAuth. Discord and Twitch are
// the providers actually enabled today; Google/Apple/Microsoft stay
// listed but disabled until they're flipped on in the dashboard
// (attempting a disabled provider lands on a raw Supabase JSON error
// page — see fetchEnabledOAuthProviders in lib/auth.js). Email
// confirmation is still deliberately off for this early testing pass.

import { useEffect, useState } from "react";
import LykodexLogo from "./LykodexLogo";
import GlitchLykodexLogo from "./GlitchLykodexLogo";
import OAuthMark from "./OAuthMark";
import { signUp, signIn, signInWithOAuth, fetchEnabledOAuthProviders } from "../lib/auth";
import { MIN_AGE, LEGAL_LAST_UPDATED } from "../lib/legal";
import { supabaseConfigured } from "../lib/supabaseClient";
import { isPackagedApp } from "../lib/platform";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import CollectionConstellationBackground from "./CollectionConstellationBackground";
import { COLLEGES } from "../data/colleges";
import { routeHref } from "../lib/router";

const CYCLE_MS = 2600;

// The moving element in the hero. Cycles the 5 real Colleges rather
// than inventing marketing verbs, each in its own categorical section
// accent — gold --accent is interactive-only and must not be used as
// display text. All five words render stacked so the box never
// resizes as the word changes.
function HeroCycler() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timer = null;

    function apply() {
      if (timer) clearInterval(timer);
      timer = null;
      if (query?.matches) {
        // Freeze on one word rather than blinking or jumping.
        setIndex(0);
        return;
      }
      timer = setInterval(() => setIndex((i) => (i + 1) % COLLEGES.length), CYCLE_MS);
    }

    apply();
    query?.addEventListener("change", apply);
    return () => {
      if (timer) clearInterval(timer);
      query?.removeEventListener("change", apply);
    };
  }, []);

  return (
    <p className="auth-hero__cycler">
      <span className="auth-hero__cycler-label">Now drifting</span>
      <span className="auth-hero__cycler-stack">
        {COLLEGES.map((college, i) => (
          <span
            key={college.id}
            className={`auth-hero__cycler-word auth-hero__cycler-word--${college.id}${
              i === index ? " auth-hero__cycler-word--active" : ""
            }`}
          >
            {college.label}
          </span>
        ))}
      </span>
    </p>
  );
}

const oauthProviders = [
  { name: "Discord", provider: "discord" },
  { name: "Twitch", provider: "twitch" },
  { name: "Microsoft", provider: "azure" },
  // Google/Apple hidden for now — enabling them needs a broader round
  // of external app-registration infrastructure (Google Cloud OAuth
  // client, Apple Services ID + private key) the user is deferring to
  // a later pass. See HANDOFF.md for the setup checklist when picked
  // back up; re-add { name: "Google", provider: "google" } and
  // { name: "Apple", provider: "apple" } here at that point.
];

export default function LoginPage({ onLoginSuccess, initialMode }) {
  const [mode, setMode] = useState(initialMode || "login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Sign-up consent: unticked by default and required — no pre-ticked
  // boxes. Also gates the OAuth buttons in sign-up mode, since those
  // create an account too.
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [error, setError] = useState("");

  // Which OAuth button (if any) is mid-redirect, and any error from
  // kicking that off — keyed so one provider erroring doesn't disable
  // the others.
  const [oauthLoading, setOauthLoading] = useState(null);
  const [oauthError, setOauthError] = useState("");
  // Packaged apps only: signInWithOAuth opens an external browser and
  // returns right away instead of navigating this page away like on
  // web — this tracks that "still out in the external browser" state
  // so it can show different copy and offer a way out.
  const [oauthWaitingExternally, setOauthWaitingExternally] = useState(false);
  // null = not checked yet — buttons stay enabled and untouched until
  // this resolves (or fails: fails open to null too, rather than
  // disabling every provider just because this one check failed).
  const [enabledProviders, setEnabledProviders] = useState(null);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    fetchEnabledOAuthProviders()
      .then(setEnabledProviders)
      .catch((err) => console.error("Failed to check enabled OAuth providers:", err));
  }, []);

  // If the user cancels/backs out of that external browser instead of
  // completing sign-in, nothing would otherwise ever clear the
  // waiting state above — Capacitor's Browser plugin firing
  // browserFinished (the in-app browser tab closed, for any reason)
  // and the app resuming from background (covers Tauri's system
  // browser too, which has no equivalent close event of its own) are
  // both good signals that whatever happened out there is done.
  useEffect(() => {
    if (!isPackagedApp()) return;
    let cancelled = false;
    let browserHandle;
    let resumeHandle;

    (async () => {
      if (cancelled) return;
      browserHandle = await Browser.addListener("browserFinished", () => {
        setOauthLoading(null);
        setOauthWaitingExternally(false);
      });
      resumeHandle = await App.addListener("resume", () => {
        setOauthLoading(null);
        setOauthWaitingExternally(false);
      });
    })();

    return () => {
      cancelled = true;
      browserHandle?.remove();
      resumeHandle?.remove();
    };
  }, []);

  async function handleOAuth(provider, label) {
    setOauthError("");

    // Checked up front — attempting a not-yet-enabled provider anyway
    // would navigate (web) or open an external browser (packaged)
    // straight to Supabase's raw "provider is not enabled" JSON error
    // page, since supabase-js has no way to know that client-side
    // before making the request.
    if (enabledProviders?.[provider] === false) {
      setOauthError(`${label} sign-in isn't available yet.`);
      return;
    }

    if (mode === "signup" && !agreed) {
      setOauthError(`Please confirm you're ${MIN_AGE} or older and agree to the Terms and Privacy Policy first.`);
      return;
    }

    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
      // Web: a successful call means the browser is about to navigate
      // away to the provider — nothing further to do here. Packaged
      // apps: the external browser just launched and this page is
      // still showing, so switch to the distinct waiting state above.
      if (isPackagedApp()) setOauthWaitingExternally(true);
    } catch (err) {
      console.error(`${label} sign-in failed:`, err);
      setOauthError(
        err.message?.toLowerCase().includes("provider is not enabled")
          ? `${label} sign-in isn't available yet.`
          : err.message || `Couldn't start ${label} sign-in.`
      );
      setOauthLoading(null);
    }
  }

  function cancelOauthWait() {
    setOauthLoading(null);
    setOauthWaitingExternally(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!supabaseConfigured) {
      setError("Accounts aren't set up yet.");
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    if (mode === "signup" && !agreed) {
      setError(`Please confirm you're ${MIN_AGE} or older and agree to the Terms and Privacy Policy.`);
      return;
    }

    setStatus("loading");
    try {
      let result;
      if (mode === "signup") {
        result = await signUp(email, password, { termsVersion: LEGAL_LAST_UPDATED, minAge: MIN_AGE });
      } else {
        result = await signIn(email, password);
      }

      // signUp() can succeed (the account genuinely gets created)
      // without returning an active session — that happens when the
      // Supabase project still has "Confirm email" switched on
      // (Supabase's own default for every new project). Previously
      // this called onLoginSuccess() regardless, which looked exactly
      // like "I made an account and nothing happened" — the account
      // was real, there just was no session yet to actually be
      // logged in with.
      if (!result?.session) {
        setStatus("idle");
        setError(
          mode === "signup"
            ? "Account created — check your email to confirm it, then sign in."
            : "Signed in, but something went wrong — try refreshing."
        );
        return;
      }

      onLoginSuccess(mode);
    } catch (err) {
      console.error("Auth failed:", err);
      setError(err.message || "Something went wrong — try again.");
      setStatus("idle");
    }
  }

  function oauthLabel(p, notEnabled) {
    if (oauthLoading === p.provider) {
      return isPackagedApp() ? "Waiting…" : "Redirecting…";
    }
    if (notEnabled) return `${p.name} (soon)`;
    return `Continue with ${p.name}`;
  }

  function renderOauthButtons(providers) {
    return providers.map((p) => {
      const notEnabled = enabledProviders?.[p.provider] === false;
      return (
        <button
          key={p.name}
          type="button"
          className={`auth-oauth-btn${notEnabled ? " auth-oauth-btn--soon" : ""}`}
          onClick={() => handleOAuth(p.provider, p.name)}
          disabled={oauthLoading !== null || notEnabled}
          title={notEnabled ? `${p.name} sign-in isn't available yet` : undefined}
        >
          <span className="auth-oauth-btn__mark">
            <OAuthMark provider={p.provider} />
          </span>
          {oauthLabel(p, notEnabled)}
        </button>
      );
    });
  }

  return (
    <div className="auth-page">
      <div className="auth-stage">
        <section className="auth-panel">
          <div className="auth-card">
            <LykodexLogo className="auth-card__logo" transparent />

            <div className="auth-tabs" role="tablist" aria-label="Account">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`auth-tabs__btn${mode === "login" ? " auth-tabs__btn--active" : ""}`}
                onClick={() => setMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`auth-tabs__btn${mode === "signup" ? " auth-tabs__btn--active" : ""}`}
                onClick={() => setMode("signup")}
              >
                Create account
              </button>
            </div>

            <h1 className="auth-card__title">
              {mode === "login" ? "Welcome back" : "Create your Lykodex"}
            </h1>
            <p className="auth-card__subtitle">
              {mode === "login"
                ? "Sign in to pick up your library, prices, and friends."
                : "One account for every College — games, cards, shelf, and table."}
            </p>

            {!supabaseConfigured && (
              <p className="panel__status panel__status--error">
                Accounts aren't set up yet on this deployment.
              </p>
            )}

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-form__field">
                <span>Email</span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="auth-form__field">
                <span>Password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>

              {mode === "signup" && (
                <label className="auth-form__field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </label>
              )}

              {mode === "signup" && (
                <label className="auth-consent">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    required
                  />
                  <span>
                    I'm {MIN_AGE} or older and I agree to the <a href={routeHref("terms")}>Terms of Service</a> and{" "}
                    <a href={routeHref("privacy")}>Privacy Policy</a>.
                  </span>
                </label>
              )}

              {error && <p className="panel__status panel__status--error">{error}</p>}

              <button type="submit" className="auth-form__submit" disabled={status === "loading"}>
                {status === "loading" ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <div className="auth-divider">
              <span>Or continue with</span>
            </div>

            <div className="auth-oauth-row auth-oauth-row--soon">{renderOauthButtons(oauthProviders)}</div>

            {oauthWaitingExternally && (
              <div className="auth-oauth-waiting">
                <p className="panel__status">Finish signing in in the browser that just opened…</p>
                <button type="button" className="auth-card__switch" onClick={cancelOauthWait}>
                  Cancel
                </button>
              </div>
            )}
            {oauthError && <p className="panel__status panel__status--error">{oauthError}</p>}

            {mode === "login" && (
              <p className="auth-legal-note">
                New here? Continuing with a provider creates an account. By doing so you confirm you're {MIN_AGE} or
                older and agree to the <a href={routeHref("terms")}>Terms</a> and <a href={routeHref("privacy")}>Privacy Policy</a>.
              </p>
            )}
          </div>
        </section>

        <aside className="auth-hero" aria-hidden="true">
          <CollectionConstellationBackground />
          <div className="auth-hero__brand" aria-hidden="true">
            <GlitchLykodexLogo size={148} alt="" />
          </div>
          <div className="auth-hero__overlay">
            <span className="auth-hero__eyebrow">Collection constellation</span>
            <p className="auth-hero__title">
              <span className="auth-hero__title-line">Five Colleges.</span>
              <span className="auth-hero__title-line auth-hero__title-line--ghost">One vault.</span>
            </p>
            <HeroCycler />
            <p className="auth-hero__body">Everything you own, drifting as one map.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
