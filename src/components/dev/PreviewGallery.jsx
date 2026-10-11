// Dev-only visual gallery of the auth + onboarding surfaces (#/preview).
//
// Why it exists: several of these states are unreachable by clicking —
// the post-signup "check your email" message, the submit button's
// loading state, the packaged-app OAuth wait, the "accounts aren't set
// up" banner. This puts them all on one scrollable page with a
// dark/light toggle so light-theme regressions are visible at a glance.
//
// Two rules this file lives by:
//   1. No real data, ever. Every callback is a no-op logger, no user
//      state is read or written, and installNetworkGuard() below blocks
//      any cross-origin request the previewed components try to make
//      (LoginPage calls fetchEnabledOAuthProviders on mount and takes
//      no prop to stop it — the guard answers it with a canned payload
//      instead of letting it reach Supabase).
//   2. It never ships. App.jsx and AppContext both gate the route on
//      import.meta.env.DEV, so this module isn't even imported in a
//      production build.
//
// Some login states can't be driven from outside because LoginPage
// exposes no props for them and it's owned by concurrent work right
// now. Those are rendered as small markup replicas of just the
// affected fragment, copied from LoginPage, and labelled as replicas —
// they can drift, so treat the live frames as the source of truth.

import { useEffect, useState } from "react";
import LoginPage from "../LoginPage";
import OnboardingCollegePicker from "../OnboardingCollegePicker";
import AccountLinkingPage from "../AccountLinkingPage";
import { AccountGatePage, AccountGatePanel, AccountGatePopover } from "../AccountGate";
import "../../styles/preview.css";
import { readLocation, routeHref } from "../../lib/router";

const noop = (label) => (...args) => console.log(`[preview] ${label}`, ...args);

// Canned answer for Supabase's /auth/v1/settings so the OAuth buttons
// land in their real "Discord + Twitch live, the rest soon" shape
// without a request leaving the machine.
const FAKE_OAUTH_SETTINGS = {
  external: { discord: true, twitch: true, google: false, apple: false, azure: false },
};

// Blocks every non-same-origin fetch while the preview route is open.
// Same-origin is left alone so Vite's own dev traffic still works, and
// anything blocked is logged rather than silently swallowed.
//
// Patched once at module scope (this module is only ever imported by
// the dev-only #/preview route) rather than in an effect: a child's
// effect runs before its parent's, so LoginPage's provider check would
// already have fired before any effect here could install this. It
// disarms itself by checking the hash instead of by unmounting, so
// navigating away restores normal behaviour without the patch/restore
// race that React's StrictMode double-invocation causes.
const REAL_FETCH = window.fetch;

function isPreviewRoute() {
  return readLocation().view === "preview";
}

window.fetch = function previewGuardedFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
  if (sameOrigin || !isPreviewRoute()) {
    return REAL_FETCH.call(window, input, init);
  }
  console.log("[preview] blocked network request:", url);
  const body = url.includes("/auth/v1/settings") ? FAKE_OAUTH_SETTINGS : {};
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
};

function Frame({ id, label, caption, narrow, tall, children }) {
  return (
    <section className="preview-frame" id={id}>
      <header className="preview-frame__head">
        <div className="preview-frame__label">{label}</div>
        {caption && <p className="preview-frame__caption">{caption}</p>}
      </header>
      <div
        className={`preview-frame__body${narrow ? " preview-frame__body--narrow" : ""}${
          tall ? " preview-frame__body--tall" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

const SECTIONS = [
  ["login", "Login"],
  ["login-fragments", "Login states (replicas)"],
  ["onboarding", "Onboarding"],
  ["gates", "Account gates"],
];

export default function PreviewGallery() {
  const [light, setLight] = useState(false);
  const [narrow, setNarrow] = useState(false);

  // The app itself themes off html[data-mode]; drive the same switch so
  // what's on screen is exactly what real light mode looks like.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-mode");
    root.setAttribute("data-mode", light ? "light" : "dark");
    return () => {
      if (previous === null) root.removeAttribute("data-mode");
      else root.setAttribute("data-mode", previous);
    };
  }, [light]);

  const frameProps = { narrow };

  return (
    <div className="preview-root">
      <div className="preview-bar">
        <span className="preview-bar__title">Auth &amp; onboarding preview</span>
        <button
          type="button"
          className={`preview-btn${light ? " preview-btn--on" : ""}`}
          onClick={() => setLight((v) => !v)}
        >
          <span>{light ? "Light theme" : "Dark theme"}</span>
        </button>
        <button
          type="button"
          className={`preview-btn${narrow ? " preview-btn--on" : ""}`}
          onClick={() => setNarrow((v) => !v)}
        >
          <span>{narrow ? "360px width" : "Full width"}</span>
        </button>
        <span className="preview-bar__note">
          Dev only. Fake props, no backend calls — every outbound request is blocked and logged.
        </span>
      </div>

      <nav className="preview-index">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={routeHref("preview")}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="preview-section" id="login">
        <h2 className="preview-section__title">Login</h2>

        <Frame
          {...frameProps}
          tall
          label="Sign in mode"
          caption="Live LoginPage. Check the tab underline, the OAuth row wrapping, and that the hero panel keeps its contrast in light theme."
        >
          <LoginPage initialMode="login" onLoginSuccess={noop("onLoginSuccess")} />
        </Frame>

        <Frame
          {...frameProps}
          tall
          label="Create account mode"
          caption="Live LoginPage with the confirm-password field. Typing two different passwords and submitting here reproduces the real 'Passwords don't match.' error without any network call."
        >
          <LoginPage initialMode="signup" onLoginSuccess={noop("onLoginSuccess")} />
        </Frame>
      </div>

      <div className="preview-section" id="login-fragments">
        <h2 className="preview-section__title">Login states (replicas)</h2>
        <p className="preview-note">
          LoginPage drives these from internal state and takes no props to force them, and the file
          is owned by concurrent work, so these are copies of just the affected markup — same
          classes, same copy, but they can drift from the real component.
        </p>

        <Frame
          {...frameProps}
          label="Form error"
          caption="panel__status--error inside the form. Look for readable red on the light background."
        >
          <div className="preview-fragment">
            <p className="panel__status panel__status--error">Passwords don&apos;t match.</p>
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="Post-signup confirmation notice"
          caption="Shown after a successful signup that returns no session. Note it reuses the error style even though it is good news."
        >
          <div className="preview-fragment">
            <p className="panel__status panel__status--error">
              Account created — check your email to confirm it, then sign in.
            </p>
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="Submit button, loading"
          caption="Disabled submit during an in-flight auth call. Check the disabled contrast."
        >
          <div className="preview-fragment">
            <button type="button" className="auth-form__submit" disabled>
              Please wait…
            </button>
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="Packaged-app OAuth wait"
          caption="Only reachable inside the desktop/mobile builds, after an external browser opens."
        >
          <div className="preview-fragment">
            <div className="auth-oauth-waiting">
              <p className="panel__status">Finish signing in in the browser that just opened…</p>
              <button type="button" className="auth-card__switch" onClick={noop("cancelOauthWait")}>
                Cancel
              </button>
            </div>
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="OAuth error"
          caption="Sits below the secondary provider row."
        >
          <div className="preview-fragment">
            <p className="panel__status panel__status--error">
              Discord sign-in isn&apos;t available yet.
            </p>
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="Unconfigured deployment banner"
          caption="Shown when supabaseConfigured is false — a build-time module constant, so it can't be toggled at runtime."
        >
          <div className="preview-fragment">
            <p className="panel__status panel__status--error">
              Accounts aren&apos;t set up yet on this deployment.
            </p>
          </div>
        </Frame>
      </div>

      <div className="preview-section" id="onboarding">
        <h2 className="preview-section__title">Onboarding</h2>

        <Frame
          {...frameProps}
          label="Step 1 — College picker, with a first name"
          caption="Two Colleges pre-selected so the selected-card treatment and the check badge are both visible."
        >
          <div className="onboarding-shell">
            <OnboardingCollegePicker
              firstName="Joshua"
              selected={["gaming", "tcg"]}
              onChange={noop("setSelectedColleges")}
              onContinue={noop("onContinue")}
            />
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="Step 1 — College picker, no first name"
          caption="The OAuth-signup path where no name is known yet; the title falls back to 'Welcome to Lykodex'."
        >
          <div className="onboarding-shell">
            <OnboardingCollegePicker
              firstName={null}
              selected={[]}
              onChange={noop("setSelectedColleges")}
              onContinue={noop("onContinue")}
            />
          </div>
        </Frame>

        <Frame
          {...frameProps}
          tall
          label="Step 2 — Account linking, no Steam linked"
          caption="AccountLinkingPage in onboarding variant: no userId, so it skips the profile fetch and the handle cards."
        >
          <div className="onboarding-shell">
            <AccountLinkingPage
              variant="onboarding"
              linkedSteamId={null}
              onUnlinkSteam={noop("onUnlinkSteam")}
              onAddToWishlist={noop("onAddToWishlist")}
              onFinishOnboarding={noop("onFinishOnboarding")}
            />
          </div>
        </Frame>

        <Frame
          {...frameProps}
          tall
          label="Step 2 — Account linking, Steam already linked"
          caption="The linked branch, with a fake SteamID64 and the Unlink action in place of the import form."
        >
          <div className="onboarding-shell">
            <AccountLinkingPage
              variant="onboarding"
              linkedSteamId="76561190000000000"
              onUnlinkSteam={noop("onUnlinkSteam")}
              onAddToWishlist={noop("onAddToWishlist")}
              onFinishOnboarding={noop("onFinishOnboarding")}
            />
          </div>
        </Frame>
      </div>

      <div className="preview-section" id="gates">
        <h2 className="preview-section__title">Account gates</h2>

        <Frame
          {...frameProps}
          label="AccountGatePage"
          caption="Whole-page gate, rendered in place of a protected page."
        >
          <AccountGatePage
            title="Account Settings"
            onSignIn={noop("onSignIn")}
            onCreateAccount={noop("onCreateAccount")}
          />
        </Frame>

        <Frame
          {...frameProps}
          label="AccountGatePanel"
          caption="In-panel gate for Quickdash cards — the compact one."
        >
          <div className="preview-fragment">
            <AccountGatePanel
              message="Sign in to see your friends here."
              onSignIn={noop("onSignIn")}
              onCreateAccount={noop("onCreateAccount")}
            />
          </div>
        </Frame>

        <Frame
          {...frameProps}
          label="AccountGatePopover"
          caption="Anchored bubble for in-page actions. Normally positioned by its anchor; shown loose here."
        >
          <div className="preview-popover-stage">
            <AccountGatePopover
              message="Sign in to add this to your wishlist."
              onSignIn={noop("onSignIn")}
              onCreateAccount={noop("onCreateAccount")}
              onDismiss={noop("onDismiss")}
            />
          </div>
        </Frame>
      </div>
    </div>
  );
}
