// Shown for any URL that isn't a real page (a mistyped or outdated
// link), instead of silently dropping the visitor on Overview.

import { useEffect } from "react";

export default function NotFoundPage({ onGoHome }) {
  useEffect(() => {
    const previous = document.title;
    document.title = "Page not found · Lykodex";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <p className="not-found__code">404</p>
      <h1 id="not-found-title" className="not-found__title">This page doesn't exist</h1>
      <p className="not-found__text">The link may be mistyped or out of date.</p>
      <button type="button" className="not-found__btn" onClick={onGoHome}>
        Go to Overview
      </button>
    </section>
  );
}
