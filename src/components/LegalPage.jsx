// Privacy Policy / Terms of Service / Refund Policy / Cookie Policy.
// Content lives in lib/legal.js; this just lays it out. Public — no
// sign-in needed, so it works from the sign-up form's links too.

import { useEffect } from "react";
import { LEGAL_CONTENT, LEGAL_PAGES, LEGAL_LAST_UPDATED } from "../lib/legal";
import { routeHref } from "../lib/router";

export default function LegalPage({ page, onBack }) {
  const content = LEGAL_CONTENT[page];

  useEffect(() => {
    if (!content) return;
    const previous = document.title;
    document.title = `${content.title} · Lykodex`;
    window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, [content]);

  if (!content) return null;

  return (
    <article className="legal-page" aria-labelledby="legal-page-title">
      {onBack && (
        <button type="button" className="legal-page__back" onClick={onBack}>
          ← Back
        </button>
      )}

      <nav className="legal-page__tabs" aria-label="Legal documents">
        {LEGAL_PAGES.map((p) => (
          <a
            key={p.id}
            href={routeHref(p.id)}
            className={`legal-page__tab${p.id === page ? " legal-page__tab--active" : ""}`}
            aria-current={p.id === page ? "page" : undefined}
          >
            {p.label}
          </a>
        ))}
      </nav>

      <header className="legal-page__header">
        <h1 id="legal-page-title" className="legal-page__title">{content.title}</h1>
        <p className="legal-page__updated">Last updated {LEGAL_LAST_UPDATED}</p>
        <p className="legal-page__intro">{content.intro}</p>
      </header>

      {content.sections.map((section) => (
        <section key={section.heading} className="legal-page__section">
          <h2 className="legal-page__heading">{section.heading}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text} className="legal-page__text">{text}</p>
          ))}
          {section.list && (
            <ul className="legal-page__list">
              {section.list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
