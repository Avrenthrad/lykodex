// Site-wide footer: legal links, business details, and the
// third-party data / trademark notice.

import { BUSINESS, LEGAL_PAGES } from "../lib/legal";

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <nav className="site-footer__links" aria-label="Legal">
        {LEGAL_PAGES.map((p) => (
          <a key={p.id} href={`#/${p.id}`} className="site-footer__link">
            {p.label}
          </a>
        ))}
        <a href={`mailto:${BUSINESS.email}`} className="site-footer__link">
          Contact
        </a>
      </nav>
      <p className="site-footer__text">
        © {year} {BUSINESS.name}
        {BUSINESS.abn ? ` · ABN ${BUSINESS.abn}` : ""} · {BUSINESS.email}
      </p>
      <p className="site-footer__text site-footer__text--fine">
        Prices and game, card and media data come from third-party sources and may be out of date. Lykodex isn't
        affiliated with or endorsed by Valve, Microsoft, Sony, Nintendo, Discord or any other platform shown. All
        trademarks belong to their owners. This product uses the TMDB API but is not endorsed or certified by TMDB.
        Card data and images courtesy of Scryfall and other card databases.
      </p>
    </footer>
  );
}
