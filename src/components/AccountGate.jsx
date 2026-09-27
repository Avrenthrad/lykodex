// Two flavours of "you need an account for this":
//   - AccountGatePage: swapped in for an entire protected page
//     (Account Management, Account Linking, Dashfeed Settings) when
//     logged out. Renders in place of the real page rather than
//     redirecting the URL to Login — that matters for the browser
//     Back button: if we redirected instead, Back would just bounce
//     you straight back to this same gate again (the URL you came
//     from is still protected), making Back feel broken. Rendering in
//     place keeps the URL and the history stack sane.
//   - AccountGatePopover: a small anchored bubble for in-page actions
//     that need an account (e.g. adding to a wishlist) without
//     leaving the page at all.

export function AccountGatePage({ title, note, onSignIn, onCreateAccount }) {
  return (
    <div className="price-page">
      <div className="account-gate-page">
        <span className="account-gate-page__eyebrow">Account required</span>
        <h1 className="account-gate-page__title">{title}</h1>
        <p className="account-gate-page__note">
          {note || "You'll need a Lykodex account to use this — it only takes a moment."}
        </p>
        <div className="account-gate-page__actions">
          <button type="button" className="auth-form__submit" onClick={onCreateAccount}>
            Create account
          </button>
          <button type="button" className="auth-form__secondary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountGatePopover({ message, onSignIn, onCreateAccount, onDismiss }) {
  return (
    <div className="account-gate-popover" role="dialog">
      <p className="account-gate-popover__message">{message}</p>
      <div className="account-gate-popover__actions">
        <button type="button" className="auth-form__submit" onClick={onCreateAccount}>
          Create account
        </button>
        <button type="button" className="auth-form__secondary" onClick={onSignIn}>
          Sign in
        </button>
      </div>
      <button type="button" className="account-gate-popover__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// A smaller in-panel gate — for Quickdash dashboard cards (Friends,
// Library) rather than a whole page. Sits in place of the panel's
// real content, keeping the panel's own header/eyebrow/title above it.
export function AccountGatePanel({ message, onSignIn, onCreateAccount }) {
  return (
    <div className="account-gate-panel">
      <p className="account-gate-panel__note">{message}</p>
      <div className="account-gate-panel__actions">
        <button type="button" className="auth-form__submit" onClick={onCreateAccount}>
          Create account
        </button>
        <button type="button" className="auth-form__secondary" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}
