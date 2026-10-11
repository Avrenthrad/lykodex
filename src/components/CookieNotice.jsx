// Cookie notice. Lykodex only stores strictly necessary and functional
// data (sign-in session + your settings) and runs no analytics or
// advertising, so there's nothing to opt into or out of. This is an
// informational notice with a link to the Cookie Policy, not a consent
// prompt. If non-essential cookies (e.g. analytics) are ever added,
// this needs to become an opt-in with Accept/Reject buttons, and those
// scripts must not load until the person accepts.

import { useState } from "react";
import { routeHref } from "../lib/router";

const STORAGE_KEY = "lykodex-cookie-notice-seen";

function alreadySeen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function CookieNotice() {
  const [visible, setVisible] = useState(() => !alreadySeen());
  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage blocked (private mode etc.) — just hide it for this visit.
    }
    setVisible(false);
  }

  return (
    <div className="cookie-notice" role="region" aria-label="Cookie notice">
      <p className="cookie-notice__text">
        Lykodex only stores what it needs to keep you signed in and remember your settings. No ads, no analytics, no
        tracking. <a href={routeHref("cookies")}>Cookie Policy</a>
      </p>
      <button type="button" className="cookie-notice__btn" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
