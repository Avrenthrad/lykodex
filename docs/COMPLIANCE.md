# Compliance checklist

Status of the 20-point website compliance checklist for Lykodex, as of
11 October 2026. Legal text lives in `src/lib/legal.js`. It's a
good-faith draft against Australian law (Privacy Act 1988 / APPs,
Australian Consumer Law), **not legal advice**. Get it reviewed before
relying on it.

**Before launch, fill in `BUSINESS` in `src/lib/legal.js`** (name,
ABN, contact email, state). The placeholders show on every policy and
in the footer until you do.

| # | Item | Status | Where |
|---|---|---|---|
| 1 | Privacy policy | ✅ Done | `#/privacy` |
| 2 | Terms of service | ✅ Done | `#/terms` |
| 3 | Refund policy | ✅ Done. Free today; covers future paid features under ACL | `#/refunds` |
| 4 | Cookie policy | ✅ Done | `#/cookies` |
| 5 | Cookie consent banner | ✅ Informational notice. Only essential/functional storage is used, so no opt-in is needed. **If analytics/ads are ever added, it must become an opt-in banner and those scripts must not load before consent.** | `CookieNotice.jsx` |
| 6 | Form consents | ✅ Sign-up has a required, unticked "16+ and agree to Terms/Privacy" box; consent time and version are saved to the auth user's metadata. OAuth on the sign-in tab shows a "by continuing…" note. Activity sharing and Discord tracking are opt-in, off by default. | `LoginPage.jsx`, `lib/auth.js` |
| 7 | No unnecessary data | ✅ Only email is required. No DOB, address, phone or ID. Names and gamertags are optional. | — |
| 8 | Audit third-party SDKs | ✅ See below. No analytics, ads or tracking SDKs. | — |
| 9 | Remove dark patterns | ✅ Copy reviewed. No pre-ticked boxes, fake urgency or confirm-shaming. Account deletion is one typed confirmation, no hoops. | — |
| 10 | Remove hidden fees | ✅ No fees anywhere; Marketplace is fee-free. Terms commit to showing full GST-inclusive prices before any future payment. | `#/terms` |
| 11 | Remove fake reviews | ✅ None exist (no testimonials or ratings shown as endorsements). | — |
| 12 | Remove unsupported claims | ✅ No superlatives found. Footer + Terms state that prices/data are third-party estimates and Mastery is Lykodex's own measure. | `SiteFooter.jsx` |
| 13 | Accessibility alt text | ✅ All `<img>` tags have `alt` (decorative ones use `alt=""`). | — |
| 14 | Colour contrast | ✅ Fixed. `--text-tertiary` was 2.5–3.1:1 (now uses `--text-muted`, 4.6:1+). Light-mode accents were 1.9–3.9:1 (now deepened to 4.5:1+). Dark mode accents unchanged. | `index.css` |
| 15 | Keyboard navigation | ✅ Skip-to-content link; Escape closes the header menu, game popup, confirm dialog and price-history modal; clickable list rows in Inbox and Price Watch now work with Enter/Space. Global `:focus-visible` outline already existed. | — |
| 16 | Business details | ⚠️ Footer + policies are wired up. **Fill in `BUSINESS`.** | `lib/legal.js` |
| 17 | Age consent for kids' data | ✅ 16+ minimum, confirmed at sign-up; policy says under-16 accounts get deleted on request. | — |
| 18 | Unsubscribe link in emails | ✅ N/A. Lykodex only sends Supabase sign-in/confirmation emails (transactional). Any future marketing email needs an unsubscribe link (Spam Act 2003). | — |
| 19 | License fonts/images | ✅ Fonts are Google Fonts (SIL Open Font License). ⚠️ See image notes below. | — |
| 20 | Data deletion request | ✅ Account Settings → Delete account (type DELETE). Server deletes Storage files, clears the delegate link, then deletes the auth user; all user tables cascade. Also available by email per the Privacy Policy. | `api/pricing.js` `account-delete` |

## Third-party services (item 8)

Nothing here tracks users for ads or analytics.

| Service | Purpose | Personal data involved |
|---|---|---|
| Supabase (Tokyo, Japan) | Auth, database, file storage | Everything stored in the app |
| Vercel (US / edge) | Hosting + `/api` functions | Requests, IP in logs |
| Railway (US) | Discord bot | Discord IDs, opted-in activity |
| Google Fonts | Web fonts | Visitor IP (browser fetch) |
| Steam Web API | Library, playtime, achievements | Steam ID |
| Xbox / Microsoft | Gamerscore, library | OAuth tokens (server-side) |
| PlayStation Network | Trophies, library | Tokens from user's npsso (server-side) |
| Crunchyroll | Watch history | Tokens from user's session cookie (server-side) |
| Discord, Twitch | Sign-in / linking | Provider profile |
| TMDB, AniList, Open Library, RAWG, Scryfall, Pokémon TCG, FaB, Open5e, Rebrickable, Comic Vine, CheapShark, Card Kingdom, JustTCG, XBXprices, PlatPrices, UPC lookup, Fortnite API, currency rates | Catalogue, price and metadata lookups | Search terms only (no account data) |

npm runtime dependencies: Supabase JS, React, Capacitor, Tauri plugins,
ZXing (barcode), Tesseract.js (on-device OCR), lightweight-charts,
react-grid-layout. None send data anywhere on their own.

**Worth knowing:** PSN and Crunchyroll linking use unofficial
session-token methods (neither offers a public API). That's a
platform-terms risk rather than a privacy one.

Keep this table and the "Who we share it with" section of the Privacy
Policy in sync when adding a service.

## Images and logos (item 19)

- `src/assets/logo*.png`, `hero.png`, `loading.gif`, app icons: Lykodex's own. Confirm you made them or hold the rights.
- Platform/community logos (`public/icons/platforms`, `public/icons/community`, `OAuthMark.jsx`): Steam, Xbox, PlayStation, Discord, Twitch, YouTube, App Store, Google Play. Fine to use to identify those services ("nominative use"), per each brand's guidelines: don't recolour or distort them, and don't imply endorsement. The footer has a not-affiliated / trademarks notice.
- `src/assets/hltb-logo.png` (HowLongToBeat): ⚠️ check HLTB's terms allow their logo to be used this way, or replace it with plain text.
- `src/assets/react.svg`, `vite.svg`: unused template files; safe to delete.
- Card, cover and game images are loaded from their source APIs (Scryfall, TMDB etc.) under those APIs' terms. The footer carries TMDB's required credit and a Scryfall credit. Check any other source you add for its own attribution rules.
