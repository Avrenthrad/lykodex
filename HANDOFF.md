# Handoff notes — Claude Code ⇄ Cursor

This file is the shared source of truth between the two agents working on
Lykodex. There's no live link between us — no shared session, no direct
API — so this doc, plus commit messages/PR descriptions and code comments,
is how context actually crosses over. Keep it current: whoever picks up a
thread the other one dropped should be able to read this and know what's
going on without re-deriving it.

**Starting point (2026-08-27):** `main` is the only stream. Old V0 chats
were archived; the stalled `v0/runtime-error-resolution-baf343a0` branch
(Commander View / social analytics / college-hero rewrite) was deleted
unmerged — do not recreate it or port from memory. New UI starts from
isolated V0 screens against `DESIGN_TOKENS.md`, wired into this repo on
`main`.

**Division of labor (as of 2026-08-27):** V0 generates isolated UI
screens/components from `DESIGN_TOKENS.md` — never the full app. Cursor
owns wiring that UI into the real Vite app and general feature build-out.
Claude Code owns troubleshooting, testing/verification, and some feature
builds of its own (backend/Supabase work, native platform plumbing, bug
fixes) — delegated by the user per-task, not a fixed split. If you're
picking up a task the other agent started, check the "In progress /
recently touched" section below first.

**If you're V0:** design ONE screen/component at a time against
`DESIGN_TOKENS.md`, in isolation — do not try to import or boot this
full repo in your own preview. See the gotchas below for why that
reliably breaks (your embedded preview pane parses this project's
Tailwind CSS `@import`s as JavaScript and throws `SyntaxError:
Unexpected token '*'` — confirmed not a bug in the actual code, which
builds and runs clean everywhere else it's been tested).

## Project shape

- React 19 + Vite, hash-based custom routing (no react-router) — see
  `src/context/AppContext.jsx`'s `KNOWN_VIEWS`/`parseHash`/`hashFor`.
- Capacitor (Android/iOS) + Tauri (desktop) for packaged builds. Platform
  detection lives in `src/lib/platform.js`
  (`isPackagedApp()`/`isTauri()`/`isAndroid()`/`isMobileApp()`) — branch on
  these, don't re-derive platform checks inline.
- Supabase Postgres backend, project id `zcwrlnljtfvslldwyldq`. RLS almost
  everywhere; cross-user lookups go through narrow `SECURITY DEFINER` RPCs
  (e.g. `get_public_profiles`, friend-scoped `get_friends_*` functions) —
  never widen an existing RPC's exposure without checking who else calls it
  for a narrower reason.
- Vercel serverless functions under `/api/*` proxy anything that needs a
  server-side key (Steam, etc.) or that blocks direct browser requests.
- CI: `.github/workflows/release-android.yml` /
  `release-desktop.yml`, tag pattern `android-v0.1.X` / `desktop-v0.1.X`,
  versioned via `github.run_number`.

## Conventions worth matching

- No comments explaining *what* code does — only *why*, when it's a real
  gotcha/constraint/history that isn't obvious from reading it. Match the
  existing comment density and tone; don't add narration.
- Every commit message explains why, not just what — read recent `git log`
  before writing one, the style is consistent and worth continuing.
- Before committing: `npx oxlint <touched files>` then `npm run build`.
  Both must be clean. If a change is visually observable, verify it live
  (dev server via the browser, not just a build check) before calling it
  done.
- Honest empty states over fabricated data — if something has no real
  history/content yet, say so in the UI rather than inventing a number or
  a fake trend.

## Sharp edges / gotchas actually hit this project

- **`git add <file>` stages the whole file, not just your intended diff.**
  This broke 3 release builds in a row (2026-08-25/26): an in-progress,
  uncommitted Tailwind CSS integration was sitting in `src/index.css`
  alongside unrelated CSS edits, and got swept into a commit without its
  `package.json`/`vite.config.js` companions, breaking `npm ci` in CI.
  Before staging a file you didn't fully author this session, `git diff`
  it first and check nothing unrelated is riding along.
- **Windows vs. Linux CI is case-sensitive for imports.** Windows dev
  environments resolve `import "./Foo"` against `foo.js` without
  complaint; the Linux GitHub Actions runners won't. Double-check new
  file import paths match exact on-disk casing (`git ls-files` reports
  the real case) before assuming a local build success means CI will
  agree.
- **Google/Apple/Microsoft OAuth aren't enabled in Supabase yet** (Discord
  and Twitch are). `src/lib/auth.js`'s `fetchEnabledOAuthProviders()`
  checks Supabase's own public `/auth/v1/settings` endpoint up front and
  disables not-yet-enabled provider buttons — don't remove that check,
  it's there because attempting a disabled provider anyway lands on a raw
  Supabase JSON error page, not a catchable JS error.
- **Packaged-app OAuth needs a different flow than web.** `signInWithOAuth`
  branches on `isPackagedApp()`: web does a normal same-window redirect;
  packaged apps get `skipBrowserRedirect: true`, open the URL in an
  external browser (Capacitor's `Browser.open` on mobile,
  `@tauri-apps/plugin-shell`'s `open()` on desktop — never Tauri's own
  webview, most providers refuse to authenticate inside an embedded
  webview), and the redirect comes back via a registered
  `lykodex://auth-callback` custom scheme
  (`android/.../AndroidManifest.xml`, `ios/.../Info.plist`,
  `src-tauri/tauri.conf.json`'s deep-link plugin config) —
  `src/lib/oauthRedirect.js` catches that and calls `setSession()`
  manually, since there's no real page navigation for Supabase's own
  `detectSessionInUrl` to catch.
- **`mastery_score_history`** is a new table + daily `pg_cron` snapshot job
  (see the `add_mastery_score_history` migration) — `overall_mastery_score`
  itself is still a live-computed, current-value-only column with no
  history of its own; don't assume other "Mastery"-adjacent columns have
  history without checking.
- **A file exporting both a component and a hook/constant breaks Vite Fast
  Refresh** into a full-page reload on every edit (oxlint's
  `only-export-components` catches this). Established fix pattern in this
  repo: move the non-component export to its own file in `lib/` or
  `hooks/`, not into the same file with a re-export.
- **`src/index.css` is one long flat file with no layers, so `@media`
  blocks lose to any same-specificity base rule declared later.** Hit
  again on 2026-08-27: a `@media (max-width: 480px)` block sat next to
  the `.auth-*` rules around line 1660 but also targeted
  `.account-gate-page` and `.onboarding-*`, which define their own
  padding ~2000-4000 lines further down — so the phone padding silently
  never applied. Put responsive overrides at the very end of the file
  (or verify every selector in the block is defined above it).
- **The `Browser pane` local preview tool can't take real screenshots** in
  this environment (times out — "pane not displayed"). Structural
  verification (console errors, `read_page`/`get_page_text`, computed
  styles/bounding rects via the JS eval tool) works fine; for genuine
  pixel-level review, publish a small standalone HTML preview as an
  Artifact instead and have the user look at that.

## Open branches

`main` is where all active work happens. One archive-only branch,
`mobile-paused-2026-08-29` — a full snapshot of the native Android/iOS/
Capacitor setup exactly as it stood before mobile got pulled off `main`
(see the entry directly below). Not for active development; it exists
purely so that setup is fully recoverable if/when mobile work resumes.

## In progress / recently touched (most recent first)

- 2026-09-20 — **Achievement Tracker (Gaming sidebar, renamed from
  "Achievements"): collapsible trophy categories + real Xbox/PlayStation
  sync. PR #5, not yet merged.** Two pieces:
  - **Collapsible categories**, matching an IGN trophy-guide layout the
    user pointed at: achievements/trophies group into named sections
    (Story, Collectibles, etc.) that auto-collapse once everything
    inside is checked off, so you don't scroll past what's finished — a
    click always overrides the default either way. Applies to Steam
    (`AchievementsPage.jsx`'s `CategorySection`/`CategoryTagInput`) and
    the manual Xbox/PS tracker. Steam achievements get a new
    `steam_achievement_categories` table for tagging (Steam's schema has
    no grouping of its own); the manual tracker got a `category` column
    directly on `platform_achievements`.
  - **Real Xbox/PlayStation achievement sync (new capability, not just
    UI).** You can now pick a game from your own already-linked Xbox/PSN
    library (`fetchXboxLibrary`/`fetchPsnLibrary`, both pre-existing) and
    pull its real achievement/trophy list — same auto-crossing-off Steam
    already had. A **Refresh** button re-syncs a tracked game's unlock
    state. This corrects an earlier assumption baked into this codebase's
    own comments ("neither platform has a public API for a person's own
    achievement/trophy list") — untrue for real per-title data: Xbox
    Live's `achievements.xboxlive.com` and PSN's per-`npCommunicationId`
    trophy endpoints both work with the exact same tokens already stored
    in `xbox_tokens`/`psn_tokens`, confirmed against the same reference
    implementations (OpenXbox/xbox-webapi-python, achievements-app/psn-
    api) already cited throughout `api/pricing.js`. New server modes:
    `service=xbox&mode=achievements` (body `{titleId}`),
    `service=psn&mode=title-trophies` (body `{npCommunicationId}` — PSN
    needs a fallback attempt with `npServiceName=trophy` for PS4/PS3/
    Vita titles since PS5-native titles omit it and there's no reliable
    field to tell which up front ahead of a 404). Synced rows live in
    the same `platform_achievements` table as manual ones (new
    `external_id`/`external_title_id`/`icon_url`/`source` columns) —
    a refresh only ever touches unlock state/description/icon, so a
    person's own category tag on a synced achievement survives every
    future refresh untouched.
  - **Not yet live-tested against a real Xbox/PSN account** — no linked
    account was available in that session. Worth a real smoke test
    before/after merging PR #5; this repo's own history shows this exact
    class of Xbox/PSN unofficial-API integration has needed a live debug
    round before (see the "Fix real Xbox/PSN library-import 400s found
    via live error bodies" commits below).
  - All four migrations (category columns/table, sync columns) were
    applied directly to production via Supabase MCP and mirrored in
    `schema.sql`; `get_advisors` checked clean after each.

- 2026-09-01 — **College overview hero banners — done (Cursor).**
  Full-width animated hero on each College home only (`dashboard`,
  `tcg-home`, `college-entertainment`, `college-collectibles`,
  `college-tabletop`). New `CollegeHeroBanner.jsx` +
  `getCollegeHeroForView()` in `navSections.js`; wired in `App.jsx`
  above the sidebar/content row. Per-college canvas themes (Gaming
  scanlines, TCG cards, Library film/play marks, Loot sparkles,
  Wartable hex + dice). Compact `CollegePageTitle` removed from those
  home pages (banner replaces them). Respects `prefers-reduced-motion`.

- 2026-09-01 — **Emergency production outage in `api/pricing.js`,
  found and fixed — root cause was NOT what it first looked like.**
  After the Crunchyroll commit deployed, every single service in
  `api/pricing.js` started returning `FUNCTION_INVOCATION_FAILED` (not
  just the new one) — confirmed via direct `curl` against multiple
  unrelated modes, including `service=currency` which touches none of
  the new code. First fix attempt (a bare `"crypto"` import →
  `"node:crypto"`) shipped clean but did NOT resolve it — the actual
  cause was `src/lib/overallMastery.js` importing `./gameMastery` with
  no `.js` extension: fine under Vite/webpack, but this project has
  `"type": "module"` in `package.json`, so Node's native ESM loader
  (which Vercel's Node runtime uses) rejects an extensionless relative
  import outright with `ERR_MODULE_NOT_FOUND` — and since
  `api/pricing.js` imports from that file, the whole module failed to
  load for every request. **Lesson worth keeping in mind for both of
  us:** `node --check` only validates syntax, it does NOT catch this —
  the only way to actually catch an import-resolution bug like this
  before shipping is `node -e "import('./api/file.js')"` (or an
  equivalent real module load), which is what actually caught it here
  after the first fix's blind spot. Fixed, verified locally via a real
  module load before pushing, confirmed live afterward.

- 2026-09-01 — **Gaming Collection: Full Library got real status
  toggles, a rating system, sort/filter, and a fixed DLC-nesting bug
  (confirmed live to be genuinely broken, not a one-off).** All in
  `LibraryPage.jsx`/`LibraryGameCard.jsx`/`gameLibrary.js` unless noted:
  - **DLC-nesting bug, two separate causes, both fixed:** entire
    separate games (Call of Duty: Black Ops, Modern Warfare, Vanguard,
    WWII; Final Fantasy IV: The After Years; Halo: Reach; Assassin's
    Creed: Brotherhood; and more) were being shown nested as "N DLC
    owned" under a bare franchise/base title, confirmed live via two
    real user screenshots. (1) Xbox/PSN had ZERO real DLC/parent-game
    data available at all (neither platform exposes any), so the old
    `inferParentTitleFromName` title-string heuristic was pure
    guessing — removed entirely for both, titles now import
    standalone. (2) Steam DOES have a real signal (`resolveGameName` →
    `api/steam.js`'s `appinfo` mode → Steam's own appdetails
    type/fullgame fields), and it correctly said "this is a real game,
    not DLC" — but the heuristic fallback in `importSteamLibrary`
    didn't distinguish "the real check failed to run" from "the real
    check ran and said no," so it silently overrode confirmed real
    games anyway. Also removed the SAME heuristic from
    `mergeLibraryByTitle`'s live client-side grouping (a second,
    independent re-nesting pass on every render that the import-time
    fix alone didn't touch — confirmed live that Final Fantasy IV: The
    After Years was STILL nested even after the import-time fix
    shipped, until this was also removed). DLC nesting now relies
    solely on an explicit, already-Steam-verified `parent_title`.
    Cleared the 33 already-wrong rows directly in production via SQL
    (23 Xbox, 10 PlayStation) since `ignoreDuplicates` on the upsert
    means a re-import can no longer self-correct existing rows.
  - **Platform filter**: checkbox dropdown (Steam/Xbox/PlayStation —
    Nintendo omitted, no real library-import source for it exists yet)
    above the Full Library table.
  - **Sort**: toggle between Most Played (existing default) and
    Recently Added, using `game_library_items.added_at` — real for
    Xbox/PSN (when actually imported), but Steam has no purchase-date
    field available at all via `GetOwnedGames` (confirmed — only
    `rtime_last_played` exists and needs the account owner's own
    personal API key, not this project's shared server key), so
    undated Steam-only entries sort last rather than getting a
    fabricated date.
  - **Row status toggles**: Completed / Run It Back / 100% / Backlog+ /
    Dropped. First four are independent, non-exclusive flags in a new
    `game_library_tags` table (deliberately separate from
    `backlog_items`' 4-state status column — these can all be true at
    once for one game). Backlog+ isn't a tag, it's a real
    `addToBacklog` call, disabled once already there.
  - **Rating system**: 1-10 scale, real and persisted (not a mockup —
    user explicitly wants richer fields added later, but the core
    submit/display loop to work now). New `game_ratings` table, RLS
    strictly self-only on raw rows; `get_game_average_ratings` RPC
    (security definer, batched per page load) is the only way a
    cross-user average is ever exposed — never who rated what.
  - **Known gap**: could not do a live click-through of the row
    toggles/rating popover specifically — the local dev session was
    lost when the preview server got restarted mid-session, and
    re-authenticating needs credentials Claude Code doesn't have.
    Verified instead that the whole app bundle loads with zero
    console/transform errors before and after, which would have caught
    a JSX break in these files (they're statically imported, not
    lazy-loaded). Worth an actual click-through by whoever picks this
    up next if anything looks off.
  - **Xbox/PSN playtime import — investigated, not yet built.** PSN's
    real gamelist response includes a genuine `playDuration` field
    (ISO 8601 duration, e.g. `"PT228H56M33S"`) we're not capturing yet
    — real and addable. Xbox's titlehub response has no equivalent
    universal field (confirmed against the real
    OpenXbox/xbox-webapi-python `Title` model — `stats` is per-title
    and inconsistent, not a clean minutes-played value), so Xbox
    playtime alongside Steam isn't reliably buildable the same way.

- 2026-09-01 — **Real Crunchyroll account linking (unofficial, cookie-
  based) — first of a planned batch (Crunchyroll done, Kindle and
  Audible next).** Researched which streaming/media services actually
  have a real, workable path before building anything (never guessed
  an API here either):
  - **Netflix/Disney+/Prime Video: genuine dead end.** No public API,
    and unlike Xbox/PSN/Crunchyroll, no established community library
    reverse-engineers personal viewing history for these either —
    confirmed via real research, not assumed. Not being pursued.
  - **Crunchyroll: built.** No public API/OAuth at all —
    `crunchyroll_tokens` table (RLS, service_role only) +
    `api/pricing.js`'s `handleCrunchyroll` (mirrors `handlePsn`'s exact
    shape) exchange the person's own `etp_rt` session cookie
    (extracted from their own browser, same shape as PSN's npsso) at
    `beta-api.crunchyroll.com/auth/v1/token` — confirmed against
    HarshitKumar9030/crunchyroll-api's actual working source.
    `CrunchyrollCard` on Account Linking mirrors `PsnCard`.
  - **New `media_library_items` table** + `lib/mediaLibrary.js`/
    `mediaLibraryImport.js` — Library College's equivalent of Gaming's
    `game_library_items`: a flat "you have this, from this source"
    list, no status forced onto bulk-imported real watch history
    (`entertainment_entries`' completed/watching/want_to_watch model
    would've silently mis-tagged everything, same reasoning as why
    Xbox/PSN library import doesn't write to Backlog).
  - **Kindle: confirmed buildable but more fragile** —
    [Xetera/kindle-api](https://github.com/Xetera/kindle-api) is real
    and cookie-based (same PSN-style shape), but needs to work around
    Amazon's active anti-bot TLS fingerprinting — the least stable of
    this batch, not built yet.
  - **Audible: confirmed buildable, bigger trust ask, not built yet**
    — no OAuth alternative exists (checked: Amazon's real "Login with
    Amazon" service only offers `profile`/`profile:user_id`/
    `postal_code` scopes, nothing for any Amazon media library). The
    real path (mkb79/Audible, actively maintained) needs the person's
    actual Amazon password submitted through the server (not a session
    token like everything else here), Amazon's login CAPTCHA/2FA, and
    RSA device-registration request-signing for every call after —
    user explicitly confirmed proceeding with this trade-off knowingly
    when asked directly.

  **Verified structurally live** (renders correctly, no crash) — the
  actual Crunchyroll token exchange isn't tested against a real
  account yet, same as Xbox/PSN's first pass.

  **Still to do**: Kindle, Audible, and — once all three exist —
  restructuring Account Linking into per-College sections (explicitly
  requested), each section hidden entirely for Colleges the user
  hasn't opted into via `selectedColleges` (also explicitly
  requested). Not started yet — deferred until there's more than one
  Library-College integration to actually organize.

- 2026-08-31 — **Mastery tier system (Bronze/Silver/Gold/Platinum/
  Diamond) + Guild Mastery Score (average of all members) + primary
  guild assignment.** Three real pieces:

  1. **`lib/masteryTiers.js`** (new, pure): `tierFromScore(score)` —
     round-number bands (0/1,000/2,500/5,000/10,000), not percentile
     math — confirmed live there are only 2 real active users right
     now (~312 and ~5,060), nowhere near enough for percentiles to
     mean anything. Diamond (10,000+) is deliberately aspirational,
     nobody's there yet. Shared by both individual Overall Mastery
     Score and Guild Mastery Score below — same bands for both, since
     a guild's score is just an average on the identical scale.

  2. **Guild Mastery Score** — `get_guild_mastery_average(p_guild_id)`
     RPC (public to any signed-in user, matches "Any signed-in user
     can browse guilds" — an aggregate average reveals no individual
     member's own score, which stays strictly self-only) averages
     every member's real `profiles.overall_mastery_score` live, no
     caching/recompute trigger needed (guild rosters are small).
     `lib/guilds.js`'s `fetchGuildMasteryAverage`. Shown on
     `GuildDetail` (GuildsPage.jsx) with its tier badge and progress
     to the next tier. Verified live: a real 2-member guild (5,060 +
     311.9) correctly averaged to 2,686 → Gold, 2,314 to Platinum.

  3. **Primary guild** — `guild_members.is_primary` (new column) with
     a partial unique index on `user_id where is_primary` — at most
     one per USER across all their guilds (not one per guild), set
     atomically via `set_primary_guild(p_guild_id)` RPC (unsets any
     existing primary + sets the new one in one call, no window where
     two could briefly both be true). `lib/guilds.js`'s
     `setPrimaryGuild`; `fetchMyGuilds` now carries `is_primary` on
     each returned guild. "Set as Primary Guild" button added to
     `GuildDetail`, gated on membership. Verified live end-to-end,
     including confirming via direct SQL that exactly one row has
     `is_primary = true` after clicking it.

  Individual tier badges shown in `FriendMasteryChart.jsx` (next to
  each friend's name — verified live: SpinelDos's real 312 correctly
  shows "Bronze") and in `Header.jsx`'s Mastery Score popover (next
  to your own score) — **the Header.jsx change is only applied
  locally, not committed**, same entanglement-with-Cursor's-concurrent-
  work reason as the two other pending Header.jsx changes below.

  **Found and fixed in passing**: `get_guildmates_mastery_history`
  (called live from `lib/guilds.js`'s `fetchGuildmatesMasteryHistory`,
  used by the Overview chart's guild/red peer lines) was documented in
  `schema.sql` for a long time but **never actually applied to the
  database** — confirmed via a direct `pg_proc` lookup coming back
  empty. Every call was silently failing this whole time, caught and
  logged as a warning, rendering as "no guild data" rather than a
  visible error. Applied now, with the same live "now" row unioned in
  as `get_friends_mastery_history` already had.

  **Header.jsx now has a second pending local-only fix**, on top of
  the `GAMING_VIEWS` one from before: Cursor's same edit also dropped
  the `TCG_VIEWS` import (`ReferenceError: TCG_VIEWS is not defined`,
  crashing the whole app again exactly the same way) — restored
  locally alongside the `GAMING_VIEWS` one. Whoever commits
  `Header.jsx` next needs BOTH:
  `import { GAMING_VIEWS, TCG_VIEWS } from "../lib/navSections";`
  — plus the "Recompute" → "Refresh" label and the mastery tier badge
  from this entry, all still sitting uncommitted in the same file.

- 2026-08-31 — **College "collection" pages renamed (user-visible text
  only, per request) + Xbox/PSN library import now targets a real
  Gaming Collection, not Backlog.**

  1. **Renames**: `LibraryPage.jsx` (Gaming's own owned-games page,
     confusingly ALSO titled "Library" before this — a real collision
     with the Library College's own home page, both literally titled
     "Library") → **"Gaming Collection"**; `navSections.js`'s matching
     sidebar item too. `EntertainmentHomePage.jsx` (the real Library
     College home) → **"Library Collection"**. `CollectiblesHomePage.jsx`
     (Loot) → **"Loot Collection"**. Left `BacklogPage.jsx` ("Backlog /
     To Be Played") alone — genuinely a different feature (status-
     tracked to-play list, not "everything owned"). Left TCG's per-game
     "My Collection" pages (Magic/Pokemon/Yugioh/etc.) and Wartable
     alone too — judgment calls, not explicitly requested.

  2. **New `game_library_items` table** (migration applied live,
     mirrored in `schema.sql`) + `lib/gameLibrary.js` — a flat "you own
     this, on this platform" list with **no status/completion
     tracking at all**, deliberately separate from `backlog_items`
     (4-state Backlog/Playing/Completed/Dropped model): bulk-importing
     someone's full Xbox/PSN library into Backlog would've silently
     defaulted every single imported game to status "backlog" (not yet
     played), which is wrong for games they've already finished.
     `lib/libraryImport.js`'s `importXboxLibrary`/`importPsnLibrary`
     now write here instead — Account Linking's buttons relabeled
     "Import Library to Gaming Collection". `addToGameLibrary` upserts
     with `ignoreDuplicates` against a real `unique(user_id, platform,
     title)` index (exact-case match is intentional — the same game
     owned on two platforms is two real rows, not a duplicate to
     collapse) and returns whether it was a genuinely new row, so the
     import progress count doesn't double-count re-imports.

  3. **`LibraryPage.jsx` (Gaming Collection) now shows the real
     imported Xbox/PSN library**, not just the old Discord-presence-
     observed subset — that limited section (only covers time played
     since Discord was linked, honestly caveated in its own copy) is
     kept as a separate "Recently Active" section, distinct from the
     new full "Xbox & PlayStation Library" list sourced from
     `game_library_items`.

  Verified live in a real logged-in dev session (842-game real Steam
  library rendered correctly under the new heading; the empty-state
  message for un-imported Xbox/PSN showed correctly too) before
  shipping.

  **Found and fixed in passing**: `Header.jsx` referenced `GAMING_VIEWS`
  without importing it — a real `ReferenceError` crashing the entire
  app on every load, unrelated to this work (Cursor's concurrent
  changes to that file). Fixed the missing import locally, but
  **Header.jsx's own commit is being left to Cursor** — their
  concurrent rework of the Mastery Score popover in that same file is
  substantial and looks complete, and my one-line fix + the "Recompute"
  → "Refresh" label rename (also requested) are both sitting inside
  that same uncommitted diff, too entangled to cleanly extract via
  patch surgery. Confirm before either of you commits Header.jsx that
  the `import { GAMING_VIEWS } from "../lib/navSections";` line is
  still in there.

- 2026-08-30 — **"Download desktop app" in the account drawer, web
  only.** New `DownloadDesktopMenuItem.jsx`, placed right after Log
  out in `Header.jsx`'s account drawer (`isPackagedApp()` gate is the
  exact inverse of `UpdateCheckMenuItem`'s, which is packaged-only —
  no point offering an already-installed person a link to install).
  The installer's own filename embeds its version
  (`Lykodex_0.1.NN_x64-setup.exe`, bumped every release — see
  `.github/workflows/release-desktop.yml`), so there's no stable
  static URL to hardcode; fetches GitHub's real "latest release" API
  at click time instead and opens whichever `.exe` asset is actually
  there. Confirmed live: the repo is genuinely public (`"private":
  false`), so the unauthenticated API call and the asset's own
  download URL both just work, no token needed — verified against the
  real endpoint (currently resolves to `desktop-v0.1.77`).

- 2026-08-30 — **Mastery recompute across all 5 Colleges (not just
  Xbox/PSN) — daily, not per-timezone-midnight as first attempted.**
  This was originally built to run hourly and only act at each
  person's own local midnight (`profiles.timezone`) — that schedule
  **broke every single deployment** from the moment it shipped,
  including totally unrelated commits pushed afterward (confirmed via
  GitHub's commit-status API: Vercel's own failure link redirected
  straight to its [Cron Jobs usage & pricing
  docs](https://vercel.com/docs/cron-jobs/usage-and-pricing) —
  **Hobby-plan accounts hard-reject any cron expression that would run
  more than once a day**, failing the deployment outright, not just
  silently coalescing it). Reverted `vercel.json` back to
  `"0 4 * * *"` and dropped the per-timezone gating entirely to
  unblock deploys immediately.

  What actually shipped, once-daily for everyone (same fixed UTC time
  as the original Xbox/PSN-only cron, now a real superset):
  - **Steam genuinely refreshes too now**, not just Xbox/PSN — new
    `getLiveSteamMasteryRaw()`/`steamFetch*` helpers in
    `api/pricing.js` replicate the same 3 Steam Web API endpoints
    `lib/gameMasteryData.js`'s (browser-only, not importable server-
    side) `gatherSteamAchievements` uses. Falls back to the last-
    computed value only if the live fetch fails, same "never silently
    drop a contribution" rule Xbox/PSN's fallback already used.
  - **Overall Mastery (all 5 Colleges) recombines too** — new
    `recomputeOverallMasteryServerSide()`. Deliberately does NOT
    re-gather TCG/Library/Loot/Wartable's own raw data server-side
    (would mean duplicating `mtg.js`/`entertainment.js`/
    `collectibles.js`/`tabletop.js`, all browser-only): those 4 only
    change when a person edits them directly in-app, which already
    triggers a fresh combine right then — no external drift to catch
    overnight the way Gaming's real third-party platforms have.
    Reuses each College's already-cached `raw` value from
    `overall_mastery_breakdown` (see `overallMastery.js`'s
    `computeOverallScore`, which already stores raw alongside
    normalized) and only replaces Gaming's with the fresh one.

  `profiles.timezone` (real IANA name, e.g. "Australia/Sydney",
  captured client-side in `AppContext.jsx` from the browser's own
  `Intl.DateTimeFormat().resolvedOptions().timeZone` on every login)
  is still captured and kept current — genuinely per-user-midnight
  precision needs a **Vercel Pro upgrade** (Pro allows per-minute
  cron schedules; Hobby is capped at once/day) to actually build,
  and the timezone data will already be there ready to use whenever
  that happens. Pick this up by re-adding an hourly cron +
  `isLocalMidnightHour()`-style gating (removed from `api/pricing.js`
  when this was reverted) only after confirming the plan is Pro.

  **Not yet tested live** in its shipped (once-daily) form.

- 2026-08-30 — **Account Linking: reordered cards, removed a leftover
  duplicate PlayStation card.** Order is now Steam → PSN → Xbox →
  Discord → Twitch (per request). Also found and removed a real bug
  while doing this: `HANDLE_PLATFORMS` in `AccountLinkingPage.jsx`
  still had a self-reported "PlayStation" entry (an "Online ID" field
  + "Open your PlayStation Library" link) that was never cleaned up
  when real PSN linking (`PsnCard`, npsso-based) replaced manual
  entry earlier this session — two separate "PlayStation" cards were
  rendering on the same page, one real and verified, one a stale
  self-reported duplicate. Confirmed live via a user screenshot
  showing the duplicate's "Online ID: Avrenthrad" / Refresh / library
  link, none of which exist in the real `PsnCard`. Nintendo is now the
  only entry left in `HANDLE_PLATFORMS` (still no public API for a
  person's own library at all). Dropped `playstation_online_id` from
  this file's profile fetch too — `PlatformQuickLinks.jsx` still
  references that column separately (as a documented, low-priority
  fallback for a profile-link destination) and wasn't touched here.

- 2026-08-30 — **Real "Sign in through Steam" replaces the old
  "paste your SteamID64 and we trust it" flow.** Steam's OpenID 2.0
  provider (`steamcommunity.com/openid/login`) is the only account-
  linking mechanism Valve actually offers — genuinely simpler to set
  up than everything else on this page: no app registration, no
  client ID/secret, no Supabase dashboard step at all. New
  `src/lib/steamAuth.js` (client: builds the redirect, reads the
  callback) + `api/steam.js`'s new `verifyOpenId` mode (server: re-
  posts the exact params Steam signed back to it with
  `openid.mode=check_authentication`, only trusts the SteamID64 in
  `openid.claimed_id` if Steam confirms `is_valid:true` — the redirect
  alone is trivially forgeable client-side, this is the actual proof).
  Wired into `AppContext.jsx` the same shape as Xbox's web callback
  (boot-time capture → complete once a session exists), including the
  same `recomputeMastery(steamId).then(recomputeOverallMastery)` call
  the old manual-entry `onLinkSteam` wrapper made, so linking still
  triggers a fresh Mastery snapshot. `AccountLinkingPage.jsx`'s Steam
  card now shows a "Sign in through Steam" button when unlinked, and a
  separate explicit "Import Steam Wishlist" button once linked
  (dropped the old bundled "link & import" — matches Xbox/PSN's
  already-separate link vs. import buttons instead of being the odd
  one out). Removed the now-dead `onLinkSteam` prop from
  `AccountLinkingPage.jsx`/`App.jsx`/`PreviewGallery.jsx` — the actual
  link now happens in `AppContext.jsx` directly.

  **Web-only for now** — Steam's OpenID realm/return_to must be a real
  http(s) URL it can validate; unlike Xbox/Discord's OAuth2
  redirect_uri, there's no app-registration step anywhere to register
  a custom `lykodex://` scheme as an allowed destination. Packaged-app
  support would need a real hosted bounce-back page (sign in via the
  system browser to a real https:// page, which then hands off to
  `lykodex://` itself) and isn't built yet.

  **Not yet tested live.**

- 2026-08-30 — **Real Xbox desktop sign-in confirmed working
  end-to-end** (client ID env var → deep-link argv forwarding →
  public-client token exchange, the three entries below) — real
  Gamerscore now showing after linking on the desktop app. The whole
  Xbox desktop/mobile support chain is done; no longer "not yet tested
  live."

- 2026-08-30 — **Fixed "Public clients can't send a client secret" on
  desktop Xbox sign-in.** Confirmed live: after the deep-link fix
  below, sign-in reached the real token exchange but Microsoft
  rejected it outright — registering `lykodex://xbox-callback` under
  Azure's "Mobile and desktop applications" platform with "Allow
  public client flows" on (both needed to get past the earlier
  confirm-loop) makes Microsoft treat that specific redirect_uri as a
  **public client**, which must never send `client_secret` at all; the
  web flow's redirect_uri is still a confidential client and still
  requires it. `xboxOAuthTokenRequest()` always included the secret
  whenever the env var was set, regardless of which flow was in play.

  Fixed by threading a `usePublicClient` flag through: computed once
  at link time from whether `redirectUri` is the `lykodex://` scheme,
  persisted on a new `xbox_tokens.is_public_client` column (applied
  live via `apply_migration` and mirrored in `schema.sql`, since a
  later `refresh_token` request has no redirect_uri of its own to
  infer this from), and read back by all three refresh call sites
  (`getLiveXboxGamerscore`/`getLiveXboxPresence`/`getLiveXboxLibrary`)
  so a refresh sends/omits the secret the same way the original link
  did.

- 2026-08-30 — **Fixed deep-link callbacks never reaching the frontend
  on Windows desktop (`src-tauri/src/lib.rs`).** Confirmed live: Xbox
  sign-in on desktop got past Azure's consent screen fine (after the
  two Azure fixes below) but then "flicked back to the app and
  repeated" — never actually linking. Root cause, confirmed against
  Tauri's own docs/example (which has the identical gap): on Windows/
  Linux, a deep-link redirect (`lykodex://...`) reaching an
  already-running app arrives as a plain CLI argument to a *second*
  launch attempt, which `tauri-plugin-single-instance` intercepts — the
  existing callback only used that to refocus the window and silently
  discarded the argument, so the actual callback URL (with the real
  OAuth code) never reached the frontend's `onOpenUrl` listener at
  all. Fixed by having the callback scan `argv` for a `lykodex://` URL
  and re-emit it on `deep-link://new-url` — the exact event
  `@tauri-apps/plugin-deep-link`'s `onOpenUrl` listens on — so it
  reaches `oauthRedirect.js`/`AppContext.jsx`'s Xbox effect the same as
  a cold start would.

  **This likely also explains any past flakiness linking Discord/
  Twitch specifically on the desktop app** (same scheme, same
  mechanism) — worth a real re-test now that this is fixed, not just
  Xbox.

- 2026-08-30 — **Set VITE_MICROSOFT_CLIENT_ID in the desktop release
  workflow.** It was never added since Xbox desktop support didn't
  exist until the entry just above this one — without it,
  `getXboxSignInUrl()` silently returns null and the Xbox Live card
  shows "Xbox sign-in isn't configured yet" even with real
  packaged-app OAuth support built and the Azure redirect URI
  registered. Confirmed live on the desktop app. Client ID only (a
  public OAuth identifier, not the secret, which stays server-side
  only in Vercel).

- 2026-08-30 — **Friends' Mastery Score chart now reflects a same-day
  recompute, not just the next day's snapshot.** `get_friends_mastery_
  history` (RPC behind `FriendMasteryChart.jsx`) only ever read
  `mastery_score_history`, which is written exactly once a day by the
  live `snapshot-mastery-scores-daily` pg_cron job (0 4 * * * UTC) —
  so a friend clicking "Recompute Gaming Mastery" (or the daily Xbox/
  PSN cron) updated their real `profiles.overall_mastery_score`
  instantly, but the chart had no way to show it until the next day's
  4am UTC snapshot. Confirmed live: exactly this mismatch reported by
  the user right after a friend recomputed.

  Fixed by having the RPC `union all` each friend's current live
  `overall_mastery_score` as a synthetic "now" row alongside the real
  history rows — same idea as a stock chart's live intraday tick on
  top of its official daily closes. Applied directly via
  `apply_migration` (`append_live_score_to_friends_mastery_history`)
  and mirrored in `supabase/schema.sql`. No client-side change needed
  — `FriendMasteryChart.jsx` already just plots whatever rows the RPC
  returns.

  `get_guildmates_mastery_history` (documented in `schema.sql`) has
  the same one-snapshot-a-day gap but isn't actually deployed to
  production (no live guild Mastery Score chart exists yet) — apply
  the same `union all` fix there whenever that feature gets built.

- 2026-08-30 — **Fixed CORS preflight blocking Xbox/PSN linking on
  packaged builds, then built real Xbox desktop/mobile support.**
  Two related fixes:

  1. **CORS preflight bug (`api/_cors.js`, `api/pricing.js`).** Xbox/
     PSN linking POSTs a real `Authorization: Bearer <token>` header —
     a non-simple CORS request that triggers a browser preflight
     `OPTIONS` first. `allowCors()` only ever set
     `Access-Control-Allow-Origin`, with no `-Headers`/`-Methods` and
     no `OPTIONS` short-circuit in the handler, so the preflight
     failed and the browser blocked the real request before it was
     ever sent. Never surfaced on web (`API_BASE` is `""` there — same
     origin, no preflight at all), only cross-origin, i.e. packaged
     builds where `API_BASE` is the real deployed URL. Confirmed live:
     desktop PSN link attempt failed with "Failed to fetch". Fixed by
     adding `Access-Control-Allow-Headers`/`-Methods` to every
     response and an early `OPTIONS` → `204` return in the handler.

  2. **Real Xbox sign-in on packaged builds** (`src/lib/xboxOAuth.js`,
     `src/context/AppContext.jsx`, `AccountLinkingPage.jsx`). Xbox
     previously only worked on web — needed a real same-window
     redirect back from `login.live.com`, which a packaged webview
     can't do. Now mirrors Discord/Twitch's existing packaged-app
     pattern (see `lib/auth.js`'s `OAUTH_CALLBACK_URL`): a distinct
     `lykodex://xbox-callback` scheme, `xboxRedirectUri()` returns
     that instead of the web origin when `isPackagedApp()`,
     `startXboxSignIn()` opens the sign-in URL in the system browser
     (Tauri's `plugin-shell` / Capacitor's `Browser`) instead of
     navigating the webview, and a new dedicated deep-link effect in
     `AppContext.jsx` (separate from `oauthRedirect.js`'s generic one,
     since completing Xbox needs a real `completeXboxLink()` call, not
     just a Supabase `setSession`) parses the callback and reuses the
     same completion logic (`completeXboxOAuth`) as the web path.

     **Blocked on one external step, not code** — Microsoft will
     reject the packaged-app flow until `lykodex://xbox-callback` is
     registered in the Azure app as a redirect URI under a **"Mobile
     and desktop applications"** platform (the existing "Web" platform
     entry stays as-is for the web flow) — same app registration, same
     client secret, just one more redirect URI added. Do this before
     testing on desktop; the web flow is unaffected either way.

     **Not yet tested live** on desktop or mobile — same caveat as the
     rest of this Xbox/PSN work until the Azure step above is done.

- 2026-08-30 — **Google + Apple sign-in: hidden again, deferred.**
  Briefly wired these up (Login page already had them in
  `oauthProviders`, gated on live `enabledProviders`; added matching
  `OAuthProviderCard`s to Account Linking) but the user is deferring
  the external app-registration work (Google Cloud OAuth client, Apple
  Services ID + private key) to a later, broader infrastructure pass —
  so both are hidden again for now:
  - `LoginPage.jsx`'s `oauthProviders` array (line ~72) — Google/Apple
    entries commented out with a note on what to re-add.
  - `AccountLinkingPage.jsx` — the two `OAuthProviderCard`s for
    Google/Apple removed (comment left in their place).

  Nothing else needs undoing — `OAuthMark.jsx`'s Google/Apple marks and
  `lib/auth.js`'s generic `signInWithOAuth`/`linkIdentity` were never
  provider-specific, so they're harmless left in place. **To pick this
  back up:** re-add the two provider entries in `LoginPage.jsx` and the
  two `OAuthProviderCard`s in `AccountLinkingPage.jsx` (both call sites
  still have comments marking exactly where), then do the external
  setup:
  - **Google**: an OAuth 2.0 Client ID (Web application) in Google
    Cloud Console, redirect URI
    `https://zcwrlnljtfvslldwyldq.supabase.co/auth/v1/callback`, paste
    Client ID + Secret into Supabase.
  - **Apple**: a Services ID (not an App ID) configured for "Sign in
    with Apple" with the same redirect URI, plus a Sign-in-with-Apple
    private key (.p8) — Supabase's Apple provider screen wants Services
    ID, Team ID, Key ID, and the key contents together.

  Once either is enabled server-side in Supabase, no other code change
  is needed beyond un-hiding — just live-test the button.

- 2026-08-30 — **Added real Xbox/PSN library import to Backlog.**
  Xbox via `titlehub.xboxlive.com`'s title-history endpoint (OpenXbox/
  xbox-webapi-python), PSN via `m.np.playstation.com`'s `gamelist/v2`
  (achievements-app/psn-api's `getUserPlayedGames`) — both confirmed
  real before building. New `getLiveXboxLibrary`/`getLivePsnLibrary`
  in `api/pricing.js` (`mode=library`), and `lib/libraryImport.js`
  adds owned/played games to the existing **Backlog**
  (`backlog_items.platform`), not Wishlist — de-dupes by title
  (case-insensitive) against what's already there first, since
  `backlog_items` has no unique constraint to lean on. "Import Library
  to Backlog" buttons live on both cards in Account Linking, shown
  once linked. Committed `68ddbd6`.

  **Not yet tested live** — same caveat as the rest of this Xbox/PSN
  work.

- 2026-08-30 — **Added real Xbox/PSN live activity ("Now Playing").**
  Both confirmed against the same real community library sources the
  Gamerscore/trophy sync used: Xbox via
  `userpresence.xboxlive.com/users/me?level=all` (OpenXbox/xbox-webapi-
  python), PSN via `m.np.playstation.com`'s `basicPresences` endpoint
  (achievements-app/psn-api). New `getLiveXboxPresence`/
  `getLivePsnPresence` in `api/pricing.js` (`mode=presence` on the
  existing `xbox`/`psn` services), and a new `GamingPresenceCard.jsx`
  (same sliding-banner style as `SteamPresenceCard.jsx`) in Gaming
  Dashboard's "Right now" lane. Committed `4eb7fe3`.

  **Self only, deliberately** — showing a friend's Xbox/PSN presence
  needs a friend-scoped server-side check (both token tables have no
  client-readable RLS at all) that doesn't exist yet. Pick this up if
  extending: mirror `get_friends_linked_steam_ids`'s friend-scoped RPC
  pattern, but the "is this real user actually my friend" check has to
  happen server-side (in `api/pricing.js`, using service_role) since
  the tokens themselves can never be exposed to the client either way
  — a client-side RPC returning someone else's raw presence data
  wouldn't be safe to gate with just "are we friends" at the RLS layer
  the way Steam's linked-id lookup is.

  **Not yet tested live** — same caveat as the rest of this Xbox/PSN
  work, needs a real signed-in account with both linked to click
  through and confirm the actual UI renders sensibly (particularly:
  does `richPresence`/`titleName` come back populated in practice, or
  mostly null for non-title-cooperative games).

- 2026-08-30 — **Replaced crude placeholder brand icons with real
  logos** (Discord/Twitch/YouTube/App Store/Google Play/Steam sourced
  from Simple Icons, MIT-licensed real vector reproductions; Xbox/
  PlayStation hand-approximated since Simple Icons doesn't carry
  either — PlayStation's Simple Icons entry is actually the wrong real
  logo, the old PS-button glyph rather than the current brand mark, so
  that one specifically needed hand-building anyway). Found and fixed
  a real construction bug in YouTube's icon along the way (was
  double-layering the shape instead of using its built-in cutout).

  Also fixed a real regression from the earlier Xbox Gamerscore field
  removal: `PlatformQuickLinks.jsx`'s "is Xbox/PlayStation linked"
  check still read the old self-reported profile columns, so the
  Overview/Gaming icon row showed both as "not linked" for anyone
  who'd switched to real Xbox Live sign-in / PSN sync. Added narrow
  `is_xbox_linked()`/`is_psn_linked()` RPCs (both token tables have no
  client-readable RLS policy at all — service_role only — so this is
  the safe way for the client to check link status without touching
  token values) and wired the icon row to them. Committed `570434a`.

- 2026-08-30 — **Daily automatic Mastery recompute for linked Xbox/PSN
  accounts.** New Vercel Cron (`vercel.json`, `0 4 * * *` — same time
  as the existing pg_cron `mastery_score_history` snapshot) hits
  `api/pricing.js`'s new `handleMasteryCron` once a day for every user
  with `xbox_tokens` or `psn_tokens` linked, refreshing real
  Gamerscore/trophy counts automatically instead of only updating when
  someone clicks "Recompute" themselves. Protected by a new
  `CRON_SECRET` env var (not yet set in Vercel — **needed before this
  actually runs**, see `.env.example`). Refactored the per-user
  gamerscore/trophies logic in `handleXbox`/`handlePsn` into shared
  `getLiveXboxGamerscore`/`getLiveTrophies` helpers so both the
  on-demand endpoints and this cron share the exact same refresh-if-
  needed logic. Steam is deliberately NOT re-fetched by this cron
  (whatever Steam contribution was last computed is carried forward
  from the existing `mastery_breakdown` rather than dropped) — only
  Xbox/PSN are in scope, per the request. Manual "Recompute Gaming
  Mastery" still refreshes all three fresh. Self-reported manual entry
  for both Xbox Gamerscore and PlayStation trophies was removed from
  `GameMasterySection.jsx` once both real integrations were confirmed
  working end-to-end — no manual entry left for any of Steam/Xbox/
  PlayStation. Committed `f9d799b`, `ea0fd5c`.

  **Not yet verified**: the actual cron firing on schedule (needs
  `CRON_SECRET` set in Vercel first, then waiting for the next 4am UTC
  run, or triggering it manually with the right bearer token to
  confirm before then).

- 2026-08-30 — **Xbox Live sign-in and PSN trophy sync both confirmed
  working end-to-end** by the user (real Gamerscore/real trophy counts
  actually showing up). Cleanup once that was confirmed: removed the
  self-reported Xbox Gamerscore manual-entry field from
  `GameMasterySection.jsx` (`recomputeMastery` already prefers the
  live value automatically once linked, so it was pure redundancy) —
  committed `ef6eb42`. PlayStation's manual trophy-count entry stays,
  as the honest fallback for anyone who doesn't want to link PSN.

  This closes out a real multi-step debugging chain (see the entries
  below for the actual bugs found and fixed along the way — a stale
  Supabase Site URL, a `flowType` mismatch, a client secret/ID mix-up,
  a missing `SUPABASE_SERVICE_ROLE_KEY`, and a genuine env-var-name bug
  in `api/pricing.js` itself). Nothing else known outstanding for
  either integration.

- 2026-08-30 — **Fixed a real bug in the Xbox Live token exchange
  itself**, found live-testing after the Discord/Twitch fixes below
  were confirmed working: `xboxOAuthTokenRequest()` in `api/pricing.js`
  read `process.env.MICROSOFT_CLIENT_ID` (a server-only name), but the
  setup docs (`.env.example`) only ever said to set
  `VITE_MICROSOFT_CLIENT_ID` (the client-side name) — so the server
  always sent `client_id=""` to Microsoft, which correctly rejected it
  as "the client does not exist." Fixed to read
  `VITE_MICROSOFT_CLIENT_ID` instead — the client ID isn't a secret,
  and Vercel's serverless runtime has `VITE_`-prefixed vars in
  `process.env` regardless (that prefix only controls what Vite
  inlines into the browser bundle). No two separate env vars needed.
  Committed `f16beec`.

  Also needed and now set (both by the user, confirmed): the real
  Azure app's actual client ID (`0992438b-884c-458d-8387-cae830a765bb`
  — an earlier mix-up briefly had a client *secret's* `keyId` pasted
  into `VITE_MICROSOFT_CLIENT_ID` instead, which produced the same
  "client does not exist" error for a completely different reason —
  worth remembering both failure modes look identical from the error
  message alone) and `SUPABASE_SERVICE_ROLE_KEY` (was never set at all
  until now — also unblocks the "Act as Lykodex" toggle from earlier
  in this project, which needed the same var).

  **Not yet confirmed working end-to-end** — waiting on the user to
  retest after this deploy goes out.

- 2026-08-30 — **Fixed two real, pre-existing OAuth bugs surfaced while
  testing Xbox Live sign-in** (neither was caused by that work, both
  had just never been exercised/noticed before):
  1. Supabase's Authentication > URL Configuration Site URL/Redirect
     URLs still pointed at `gamerdash.vercel.app` (the project's name
     before the Lykodex rename) — every Supabase-mediated OAuth
     (Discord, Twitch) redirected there and 404'd once that old
     deployment was gone. **Fixed by the user directly in the Supabase
     dashboard** (not a code change) — updated to
     `https://lykodex.vercel.app`.
  2. Once #1 was fixed, Discord/Twitch redirected back correctly but
     landed the app in a logged-out state. Root cause: `supabaseClient.js`
     created the client with zero explicit `auth` config, so it rode
     whatever `flowType` supabase-js defaults to. Captured a real
     post-redirect URL and confirmed the actual response comes back as
     `#access_token=...&refresh_token=...` (implicit-flow shape) — if
     the client expects PKCE's `?code=` instead, it never looks at the
     hash at all, so a genuinely valid session sits unused. Fixed by
     pinning `flowType: "implicit"` explicitly in `createClient()`.
     Committed `3299df3`.

  **Not yet confirmed working end-to-end** — waiting on the user to
  retest Discord/Twitch sign-in now that both fixes are live.

- 2026-08-30 — **Added real Xbox Live sign-in + real PSN trophy sync.**
  Both confirmed against actual working community implementations
  (OpenXbox/xbox-webapi-python, achievements-app/psn-api) before
  building against them, per the standing "never guess an endpoint
  shape" rule.

  - **Xbox**: real "Sign in with Microsoft" OAuth -> Xbox Live's own
    3-step token exchange (MS access token -> XBL user token -> XSTS
    token) -> real Gamerscore from `profile.xboxlive.com`.
    **NEEDS SETUP before it works**: a real Azure app registration at
    portal.azure.com — see `.env.example` for the exact redirect-URI
    requirement (register it as a "Web" platform, not SPA, since the
    exchange needs the client secret server-side) — then set
    `VITE_MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`. Until
    that's done, `XboxLiveCard` shows "Xbox sign-in isn't configured
    yet" rather than a broken button.
  - **PSN**: real trophy counts via a person's own npsso session token
    (Sony has no public OAuth registration path — same unofficial-but-
    real mechanism every PSN trophy tracker uses) -> access/refresh
    tokens via `ca.account.sony.com` -> real bronze/silver/gold/
    platinum from `m.np.playstation.com`'s trophySummary. **No setup
    needed** — this one should already work end-to-end once a real
    person pastes their own npsso token in Account Linking.

  Both proxied server-side only (`api/pricing.js`'s `handleXbox`/
  `handlePsn`, merged into the existing dispatch — still at Vercel's
  12-function cap). Tokens live in new `xbox_tokens`/`psn_tokens`
  tables with **no RLS policies granted to anon/authenticated** —
  service_role only, same posture as the "act as Lykodex" endpoint —
  never sent to the client. Both refresh expired tokens automatically
  and support a real disconnect.

  `gameMasteryData.js`'s `recomputeMastery` now tries live Xbox/PSN
  data first (what hitting Refresh actually pulls), falling back to
  the older self-reported `mastery_inputs` numbers when not linked —
  not competing mechanisms, whichever's available wins.

  **Not yet built**: packaged (Tauri/Capacitor) support for the Xbox
  OAuth redirect — same constraint `lib/auth.js`'s `signInWithOAuth`
  already documents for Discord/Twitch (no same-window redirect back
  into a packaged app's webview). Web-only for now.

  **Verification status**: lint + build clean, page loads with no
  console errors. Could NOT click-test the actual linked/unlinked
  states or a real OAuth round-trip — that needs either a real Azure
  app (Xbox) or a real logged-in Lykodex account + a real npsso token
  (PSN), neither available in this session. First real test should be
  the user's own: get an Azure app set up, then try both cards from a
  signed-in account. Committed `5d9d373`.

- 2026-08-30 — **Riftbound's tab removed from TCG College** (user's
  call, given the proxy block below made it a dead end for users).
  `RIFTBOUND_FEATURES`/`RiftboundSummary` removed from
  `TcgHomePage.jsx` rather than kept as unreachable dead code (a
  leading-underscore rename to dodge `no-unused-vars` broke
  react-hooks' rules-of-hooks check). Recoverable from commit
  `6694bd4` (the original TCG College build), or just re-add a
  `GAME_TABS` entry + summary component matching the existing pattern,
  once the proxy issue below is actually fixed. `RiftboundSearchPage.jsx`,
  `lib/riftbound.js`, the DB tables, etc. are all untouched and still
  fully wired — only the tab entry point is gone. Committed `5ce6898`.

- 2026-08-30 — **Riftbound search/lookup is currently NON-FUNCTIONAL
  in production** — found live-testing the TCG College work below.
  `api/pricing.js`'s `handleRiftbound` gets a real 403 from Riftcodex
  (`api.riftcodex.com`) specifically when the request originates from
  Vercel's infrastructure; identical requests from anywhere else
  succeed. Tried the same User-Agent-header fix that resolves this
  exact symptom for Card Kingdom/Comic Vine elsewhere in that file —
  confirmed live, retested several minutes after deploy, that it does
  **not** fix this one. Very likely a network-level IP/ASN block on
  Vercel's egress ranges, not a bot-signature check — a header can't
  route around that.

  Yu-Gi-Oh! and One Piece are unaffected (both called directly from
  the browser, no Vercel proxy involved) — this is Riftbound-only.
  `RiftboundSearchPage.jsx`'s error copy was corrected to stop implying
  "try again in a moment" will help, since it currently fails every
  time, not occasionally.

  **Not yet attempted, real options if someone picks this up**: ask
  Riftcodex (`support@riftcodex.com`, per its own OpenAPI contact) to
  allowlist Vercel's ranges; proxy through a non-Vercel host; or try a
  Cloudflare Worker instead (Riftcodex is also Cloudflare-fronted —
  unverified guess that this might not trip the same block). Committed
  `4539024`.

- 2026-08-30 — Also while testing the above: fixed a real One Piece
  bug — `card.id` was `card_set_id`, which a Parallel/Alternate Art
  variant shares with its base printing, producing real duplicate
  React keys (confirmed live) and risking duplicate-collection-row
  collisions. Switched to `card_image_id`, distinct per variant —
  except optcgapi.com's own dataset ALSO has a handful of confirmed
  genuine collisions where `card_image_id` repeats across two
  *unrelated* cards (e.g. `OP03-070`) — an upstream data-quality issue,
  documented in `lib/onepiece.js` rather than silently papered over;
  render keys fold in the array index to stay stable regardless.
  Committed `b060b2b` (bundled with the Riftbound User-Agent attempt
  above, before that attempt was found not to work).

- 2026-08-30 — **TCG College: added full Yu-Gi-Oh!, One Piece, and
  Riftbound support** (search + collection + deck builder + real
  pricing where a real source exists), matching Pokémon's existing
  feature depth. `TcgHomePage.jsx` is now driven by a `GAME_TABS` array
  (id/label/features/Summary component) instead of the old 3-way
  ternary — adding a 7th game later is a data entry, not new branching.

  Real APIs used (all confirmed live before building against them, per
  this project's standing rule against guessing endpoint shapes):
  - **Yu-Gi-Oh!** — YGOPRODeck (`db.ygoprodeck.com/api/v7`). Free,
    keyless, sends `Access-Control-Allow-Origin: *` — called directly
    from `lib/yugioh.js`, no Vercel proxy. Real market pricing
    (`card_prices`) and real per-format banlist data (`banlist_info`:
    `ban_tcg`/`ban_ocg`/`ban_goat`) — deck builder checks real
    copy-limit violations (Forbidden/Limited/Semi-Limited), not just a
    legal/illegal flag.
  - **One Piece** — optcgapi.com. Also free, keyless, also sends open
    CORS — `lib/onepiece.js` calls it directly too. Real market/
    inventory pricing. Deck builder anchors on one real Leader card,
    same Hero-anchor shape as Flesh and Blood.
  - **Riftbound** — Riftcodex (`api.riftcodex.com`). Free, keyless,
    real rich card data, but confirmed to send **no CORS headers at
    all** (the odd one out among the three) — proxied through
    `api/pricing.js`'s existing merge-point convention
    (`?service=riftbound`) rather than a 13th Vercel function (already
    at the Hobby-plan cap). No real pricing field on its cards (has a
    `tcgplayer_id`, no embedded price) and no confirmed banlist API for
    a game this new — counts-only collection, deck builder has no
    legality checking, same honest situation Flesh and Blood is in.

  9 new Supabase tables (`yugioh`/`onepiece`/`riftbound` ×
  `collection`/`decks`/`deck_cards`), 6 new `lib/` modules, 9 new page
  components, 9 new routes in `App.jsx`. Deliberately NOT built for
  these 3 (matches what Pokémon's own home-page feature list already
  omits): binders/set-lists, card scanning, price-watch history charts.

  Committed `6694bd4`, pushed to `main`.

- 2026-08-30 — **PS trophy scoring: dropped rarity weighting, tier
  count only.** `PS_RARITY_TIERS`/`PS_RARITY_MULTIPLIERS` removed from
  `gameMastery.js` (and its `discord-bot/` duplicate) — those were
  always a person's own subjective read of their trophy case's rarity
  label, never verified data the way Steam's global unlock-percent is.
  `computePsScore` is now just `count × tier points` per tier.
  `TYPICAL_MAX.playstation` dropped 8000 → 5300 alongside this (raw
  totals dropped ~1.5x without the rarity multiplier — left unchanged,
  1000 would have quietly meant "less dedicated" than before).
  `GameMasterySection.jsx`'s 4×4 tier×rarity grid is now 4 plain count
  inputs; old saved `ps_trophy_counts` rows in the previous nested
  shape are skipped on load, not misrendered. Committed `cc44c28`.

- 2026-08-30 — **Account Linking: Nintendo gets a Username field,
  loses its Refresh button; all three handle cards get a "connected"
  view.** `profiles.nintendo_username` added alongside the existing
  `nintendo_friend_code`. Nintendo's Refresh button removed — it only
  ever recomputed Gaming Mastery from Xbox/PS/Steam data, which
  Nintendo never feeds (misleading to leave it there). Once a
  platform's field(s) are saved, `PlatformHandleCard` now shows a
  clean connected view (saved values + Disconnect) matching
  `OAuthProviderCard`'s Discord/Twitch look, instead of leaving a
  filled-in form sitting there. `HANDLE_PLATFORMS`/`PlatformHandleCard`
  generalized from one field per platform to a `fields[]` list to
  support Nintendo's two. Committed `9450172`.

  **Still open, explicitly paused mid-conversation, not started**:
  user asked for real Xbox OAuth ("Sign in with Microsoft" + the
  official Xbox Live API) and the unofficial PSN `npsso`-token method
  so Refresh can pull live Gamerscore/trophies instead of self-
  reported numbers. Both are real, substantial builds — Xbox needs an
  Azure app registration (external step, not something done from
  here) + XSTS token exchange; PSN's method is unofficial/ToS-gray
  (same one PSNProfiles-style trophy trackers use). User confirmed
  wanting both built. Not yet scoped or started — pick this up before
  assuming Xbox/PlayStation stay self-reported.

- 2026-08-30 — **Removed the artificial 1000-point cap on Mastery
  Score.** User flagged "why is this all 1000/1000" on the Gaming
  Mastery breakdown. Root cause: `normalize()` in `lib/gameMastery.js`
  used an exponential diminishing-returns curve
  (`1000 * (1 - e^(-x/typicalMax))`) that asymptotes at 1000 no matter
  how high the raw score gets — and the `typicalMax` reference values
  (PlayStation 8000, Steam 5000) were low enough that any reasonably
  dedicated player saturated the display long before being near the
  real top end (PS trophy points scale as `count × tier × rarity`, so
  ~50 platinums alone can clear 8000 raw).

  Replaced with a linear, uncapped formula:
  `normalized = 1000 × (raw / typicalMax)` — `typicalMax` is now a
  reference point, not a ceiling; scores can climb past 1000
  indefinitely. `overallMastery.js` inherits this for free (imports
  `normalize` from `gameMastery.js`). `GameMasterySection.jsx`'s
  per-platform breakdown now shows just the number, no more "X / 1000"
  fraction. Hand-synced into `discord-bot/gameMastery.js` per its
  existing sync-by-hand convention (separate deployable package, not a
  shared workspace).

  Xbox's curve (`100 * log10(1 + gamerscore)`) was never actually
  saturating — flagging in case Cursor or V0 touch the Xbox side and
  wonder why it looked "fine" already.

  Committed `1c0aa8c`, pushed to `main`.

- 2026-08-30 — **Accent now defaults per-page until customized: gold
  on Overview, red on the 5 College homes.** Discovered along the way:
  the write-back effect in `AppContext.jsx` has always saved
  `accent_color` on every profile edit regardless of whether the user
  ever opened the theme picker, so a non-null `accent_color` alone
  can't tell "genuinely chose gold" apart from "never touched it."

  Added a real `profiles.accent_customized` boolean (migration
  `add_accent_customized_flag`), set only via the new
  `setAccentColorExplicit()` in `AppContext.jsx` — used exclusively by
  the swatch row in `AccountSettingsPage.jsx`. Backfilled `true` only
  for accounts already on a non-default preset (red/purple/blue);
  gold and the retired `yellow` alias are treated as "never
  customized." Until customized (logged-out visitors included, since
  they never touch this flag at all), the `<html data-accent>` value
  resolves per current `view`: red on `dashboard` (Gaming)/`tcg-home`/
  `college-entertainment`/`college-collectibles`/`college-tabletop`
  (the 5 College **home** views only, not their subpages), gold
  everywhere else. Once a user picks any swatch, that choice applies
  everywhere again, same as before this change. No CSS changes needed
  — the `html[data-accent="red"]` preset already existed in
  `index.css`.

  `AccountSettingsPage.jsx`'s `onAccentColorChange` prop is now dead
  (renamed to `_onAccentColorChange` locally to satisfy lint) — the
  swatch calls `setAccentColorExplicit` via `useApp()` instead. Left
  `App.jsx`'s wiring of that prop alone rather than touching it mid
  your Overview work; harmless to leave, safe to clean up whenever.

  Committed `4a06cd6`, pushed to `main`.

- 2026-08-30 — **Real in-app presence added; friends/guild roster sort
  online-first.** User explicitly chose to build genuine in-app
  presence rather than reuse Steam status as an "online" proxy, and
  scoped it to exactly two lists: the friends list and the guild
  member roster — NOT the friend-request lists.

  New: `src/lib/presence.js` — `subscribeToPresence(userId, onChange)`
  joins a shared Supabase Realtime Presence channel (`"lykodex-
  presence"`, keyed by `user_id`), tracks on subscribe, calls back
  with a live `Set<userId>` on sync/join/leave. `sortOnlineFirst(items,
  onlineUserIds, getUserId, getDisplayName)` is the shared sort (online
  alphabetical, then everyone else alphabetical) — used by both call
  sites despite their different row shapes (`f.friend_id`/`f.profile`
  vs `m.user_id`/`m.profile`).

  Wired into `AppContext.jsx` as `onlineUserIds` state + a
  userId-keyed effect (same pattern as `actingAsLykodex`), exposed via
  context. `FriendsPage.jsx`'s "Your friends" list and `GuildsPage.jsx`'s
  member roster both consume it via `useApp()` directly rather than
  new props — same deliberate "everything via props" exception already
  used in `AccountSettingsPage.jsx`. **Gotcha hit while wiring this**:
  the guild member roster (`members.map`) lives inside the `GuildDetail`
  sub-component in `GuildsPage.jsx`, not the top-level `GuildsPage`
  function — the hook has to go there, not in the outer component, or
  it's an unused variable in one scope and out-of-scope in the other.

  This is the first Realtime usage anywhere in the codebase (confirmed
  via grep before starting — zero existing `channel(`/`presenceState`
  usage). No existing convention to match; if a second Realtime feature
  gets built, revisit whether this should generalize.

  Committed `8844f1a`, pushed to `main`. Not yet load-tested with two
  real concurrent sessions — worth a manual check (open two browser
  profiles signed in as different accounts, confirm each shows the
  other online) before relying on it.

- 2026-08-29 — **Mobile fully paused and pulled off `main`.** Following
  the earlier "hub-first, mobile paused" decision, the user asked to go
  further: actually remove the native Android/iOS/Capacitor projects
  from the day-to-day tree, not just stop building feature work on them.
  Before removing anything, the exact pre-removal state was snapshotted
  on branch `mobile-paused-2026-08-29` (pushed to origin) — fully
  recoverable from there regardless of what happens to `main` afterward.

  Removed from `main`: `android/`, `ios/`, `capacitor.config.json`,
  `.github/workflows/release-android.yml`. Removed from `package.json`:
  the `@capacitor/android`/`@capacitor/ios` dependencies, the
  `@capacitor/cli` devDependency, and the `cap:sync`/`cap:android`/
  `cap:ios` scripts — nothing in `src/` ever imported those two platform
  packages directly (confirmed via a repo-wide grep before removing), so
  there was nothing else to touch for them. `package-lock.json`
  regenerated via `npm install` (95 packages dropped, 0 vulnerabilities).

  **Deliberately NOT removed** — these are shared platform-detection
  code and packages still actively used by working desktop/web code
  paths, not mobile-only, and gutting them would risk breaking things
  that work fine today for no real benefit: `src/lib/platform.js`
  (`isPackagedApp()`/`isTauri()`/`isAndroid()`/`isMobileApp()` — the
  `isAndroid()`/`isMobileApp()` branches simply never evaluate true
  anymore with no native shell to run in, which is fine, not broken);
  `@capacitor/core`/`@capacitor/app`/`@capacitor/browser` (still
  imported by `oauthRedirect.js`, `LoginPage.jsx`'s native OAuth flow,
  `UpdateCheckMenuItem.jsx` — all degrade gracefully on web/desktop via
  Capacitor's own web fallback, confirmed earlier this session);
  components that render conditionally on `isAndroid()`/`isMobileApp()`
  (e.g. `AndroidUpdateBanner.jsx`) — left in place, simply dormant.

  Verified: `npx oxlint src` and `npm run build` both clean after the
  removal + `npm install`. **Not yet verified**: a live GitHub Actions
  push to confirm `release-android.yml`'s removal actually stops that
  workflow from triggering (check the Actions tab after the next push
  — there should be no new Android run).

  User's call on future reuse: the current single-app Capacitor setup
  (now dormant on the archive branch) is meant to be **preserved and
  possibly reused for parts** of the future per-College mobile apps,
  not treated as a throwaway prototype — don't assume it'll be rebuilt
  fully from scratch without checking first.

- 2026-08-29 — **"Act as Lykodex" — real system account + session-swap
  toggle (`e6462f6`).** A genuine account (`profiles.username =
  'Lykodex'`, real `auth.users` row, email `system@lykodex.internal`,
  no real password anyone knows) now owns all 5 official College guilds
  (`guilds.created_by`) — it's the actual "leader," not Joshua's personal
  account anymore. `profiles.lykodex_delegate_user_id` on that account
  names the one real account (Joshua's) allowed to act as it.

  This is an app-wide session swap, not a client-side pretend-toggle —
  the user explicitly chose that scope, and RLS needs a genuine
  `auth.uid()` to enforce anything anywhere, so there wasn't a lighter
  correct option. New `lykodex-session` service merged into
  `api/pricing.js` (not its own file — `/api` was already at Vercel's
  Hobby-plan 12-function ceiling) verifies the caller's access token
  names the registered delegate, then uses the `service_role` key's
  admin API to mint and hand back a real Lykodex session.
  `AppContext.jsx`'s `actAsLykodex`/`returnToMyAccount` cache the
  personal session's tokens first so flipping back is instant, not a
  re-login. Toggle lives in Account Settings (reached via `useApp()`
  directly there, not threaded through `App.jsx`'s props — a deliberate,
  isolated exception since Header.jsx/App.jsx were mid-edit when this
  landed and this is exclusive to one account anyway). Gated on a
  narrow `am_i_lykodex_delegate()` RPC purely for UI visibility — the
  real authorization boundary is the server-side check on every session
  request, independent of what the toggle shows.

  **Needs one new Vercel env var before it works end-to-end:
  `SUPABASE_SERVICE_ROLE_KEY`** (Supabase dashboard → Settings → API →
  the `service_role` secret, never the anon/publishable one) — not yet
  confirmed added. Same "treat it like a master password" warning as
  the Discord bot's own README for the same key.

  Also same session: `profiles.selected_colleges` gaining a College now
  auto-joins that College's official guild via a new trigger
  (`auto_join_default_college_guilds`, verified end-to-end in a
  rolled-back transaction) — never auto-removes membership when a
  College is later deselected, that stays a separate real decision.

- 2026-08-29 — **Stock style chart pattern (documented; partial in app).**
  Overhaul reference for time-series charts — spline area lines, gradient
  fills, dashed horizontal grid, title/subtitle + dot legend, dual-series
  (actual vs target). Named **`stock-style`** in `DESIGN_TOKENS.md`.
  Early instances: `PriceHistoryChart.jsx`, `FriendMasteryChart.jsx`
  (`lightweight-charts` AreaSeries). Extend those for new charts.

- 2026-08-29 — **Sliding action bar pattern (documented, not built).**
  Overhaul reference from JARVIS v0 Integrations ("YOUR ENTIRE STACK.
  CONNECTED.") — full-bleed horizontal marquee of bordered chips beneath
  a section headline. Named **`sliding-action-bar`** in `DESIGN_TOKENS.md`
  (anatomy, motion, Lykodex colors, CSS sketch). Reference:
  https://v0-jarvis-ruby.vercel.app/#metrics . Distinct from `blockbar`.

- 2026-08-29 — **Blockbar pattern (documented, not built).** Overhaul
  reference for segmented vertical-block status/history strips — metric
  row + eyebrow + block track + range labels. Named **`blockbar`** in
  `DESIGN_TOKENS.md` (anatomy, semantic colors, CSS sketch, use cases).
  Say "blockbar" when implementing across hub screens.

- 2026-08-29 — **Overview page renovation (in progress).** Command-center
  hero stage (`overview-command`): split copy + `CollegeMorphHero`, Barlow
  Condensed headline, rotating stat carousel with **categorical accents**
  per College (gold reserved for vault total), morph hero syncs to the
  active slide via `focusCollegeId`. Signed-out state shows Sign in /
  Create account CTAs; loading uses a neutral skeleton (not gold).
  "Right now" lane uses `overview-tile` wrappers with accent strips
  (sky / gold / rose). College grid driven from `COLLEGES` with per-college
  corner folds, hover borders, and stat colors. Touch:
  `OverviewPage.jsx`, `CollegeMorphHero.jsx`, `index.css` (`.overview-*`;
  responsive blocks at end of file). Not yet verified: light theme, live
  browser check this session.

- 2026-08-29 — **Strategic direction: hub-first, mobile paused; College
  renames (labels only).** All development focus is on the hub (web +
  desktop/Tauri) until it hits the quality bar Joshua wants. Capacitor
  iOS/Android work is paused — no new mobile feature work. The product
  name stays **Lykodex** for now; a future hub rebrand (Citadel, Hub,
  Nexus, Relay, or keep Lykodex) is **not decided** — do not rename the
  product to any of those.

  **Future mobile strategy (document only — do not build yet):** not one
  monolithic Lykodex mobile app. Instead, separate siloed apps per
  College (better on-the-go UX), same account/login across all apps,
  each flavoured for its College, data still flowing back to the hub.
  First mobile app likely TCG (later). Keep APIs/data model ready for
  external per-College apps to sync into the hub — no separate repos or
  sub-projects yet.

  **College user-facing renames (implemented 2026-08-29):**

  | Internal ID (`selected_colleges`, routes, DB) | New label | Future app name |
  |---|---|---|
  | `gaming` | Gaming | Lykodex Gaming |
  | `tcg` | TCG | Lykodex TCG |
  | `entertainment` | Library | Lykodex Library |
  | `collectibles` | Loot | Lykodex Loot |
  | `tabletop` | Wartable | Lykodex Wartable |

  **IDs stayed stable** — only `label` / display copy changed in
  `src/data/colleges.js`, nav, headers, overview tiles, auth hero
  cycler/constellation nodes, command palette sublabels, and college
  home page titles. Hash routes (`college-entertainment`, etc.), file
  names (`EntertainmentHomePage.jsx`, `lib/entertainment.js`), component
  names, and Supabase table/column names were **not** renamed.

- 2026-08-27 — Auth + setup walkthrough: login/signup is a split stage
  (glass form left, CollectionConstellationBackground as the right-hand
  hero; on phones the constellation sits behind the form). Sign in /
  Create account tabs, Discord/Twitch first, Google/Apple/Microsoft as
  "soon". Post-signup onboarding is two steps (Colleges, then optional
  Steam/Discord/Twitch linking) — Dashfeed toggles and the welcome
  splash are out of that path. Skip/Continue both land on Overview.
  `OnboardingWelcomeStep.jsx` is deleted; `onboardingStep` now starts at
  `"college-picker"`. `src/lib/auth.js` / `oauthRedirect.js` were not
  touched — the disable-if-not-enabled check still gates the buttons.
  All four gate surfaces (page, panel, popover, and the one-off
  signed-out block in `FriendsPage.jsx`) now share
  `.auth-form__submit` + `.auth-form__secondary`, so
  `dash-header__login-btn` / `linking-row__connect` are no longer used
  as gate buttons. The auth/onboarding phone rules had to move to the
  very end of `src/index.css` — see the flat-file `@media` cascade gotcha
  above; they were silently losing to their own later base rules.
  Verified live at desktop and 360px: tab toggle, signup confirm-password
  field, both onboarding steps, Skip/Continue to Overview. Lint + build
  clean. Not yet verified: a real signup round-trip through Supabase
  (needs credentials), and packaged-app OAuth wait state.

  **Cinematic pass (same day, on top of the above).** The hero caption
  is now the loud element: `.auth-hero__title` is `clamp(44px, 6.4vw,
  96px)` uppercase condensed at 700 / `line-height: 0.88` /
  `letter-spacing: -0.025em`, split into a solid line ("Five Colleges.")
  and a hollow one ("One vault.") via `.auth-hero__title-line--ghost`.
  Body copy stays 13px in a 34ch measure — the extreme scale contrast
  with nothing sized in between is the whole point, so don't "balance"
  those two later. Also added: an 80px `--border`-tinted square grid on
  `.auth-hero::before` (z-index 0, under the constellation, which moved
  to z-index 1 and the overlay to 2); a fine scanline on
  `.auth-page::after` / `.onboarding-shell::after`; the mono eyebrow
  tightened from 10.5px/0.12em to 11px/0.19em; and `HeroCycler` in
  `LoginPage.jsx`, a crossfading College name.

  Two brand decisions worth not re-litigating:
  - **Condensed face is hero-only.** New `--font-display-condensed`
    (Barlow Condensed, added to the existing Google Fonts `@import`, not
    a second one). Bricolage stays the display face for every other
    heading — the condensed face exists so one headline can hit that
    scale without leaking into ordinary UI. Radii were deliberately left
    alone; the reference this came from is `border-radius: 0` throughout
    and we are not copying that.
  - **The cycling word uses the categorical section accents, not gold.**
    Gold `--accent` is interactive-only per `DESIGN_TOKENS.md` and can't
    be display text, and gold-on-near-black is a weaker contrast than
    the reference's blue-on-navy anyway. So each College gets a hue:
    gaming→`--sky`, tcg→`--violet`, entertainment→`--rose`,
    collectibles→`--amber`, tabletop→`--lime`. **No canonical
    per-College colour mapping existed anywhere in the repo before
    this** — `data/colleges.js` and `CollegeIcon.jsx` carry no hue — so
    this is the first one. If a real mapping gets defined later, make
    these `.auth-hero__cycler-word--*` rules follow it rather than
    inventing a second scheme.

  The cycler renders all 5 words stacked in one `inline-grid` cell, so
  the box is always as wide as the longest label and the word can change
  length without shifting anything. Under `prefers-reduced-motion:
  reduce` it clears its interval and freezes on the first College (it
  listens for `change`, so it reacts live, not just at mount). Verified
  frozen for 12s under CDP `Emulation.setEmulatedMedia`, and cycling
  again once cleared. The scanline sits above the form at z-index 3 with
  `pointer-events: none` — `document.elementFromPoint` on every control
  (inputs, submit, OAuth buttons, tabs) returns the control itself, and
  typing/clicking were exercised live. Nothing global was added: no
  `body::before`, and `.auth-page` / `.onboarding-shell` don't exist on
  `#/overview`. Scoping note: the `@media` for the reduced-motion
  transition sits next to its base rule mid-file, which is safe because
  it's not a width override and nothing later redeclares it — the phone
  block at the end of the file was not touched.

  Not verified in this pass: light theme (`html[data-mode="light"]`) —
  the ghost stroke and scanline are token-driven but were only looked at
  in dark; the non-`-webkit-text-stroke` fallback path (guarded by
  `@supports`, but every engine tested supports the property, so the
  fallback branch was never actually rendered); and packaged-app
  (Capacitor/Tauri) rendering.

  **Composition pass (same day, on top of the cinematic pass).** Two
  things were fighting: the caption plate was an opaque rounded card
  pinned to the bottom of the hero, which buried Entertainment and
  Collectibles behind it while the headline said "Five Colleges."; and
  the field was sparse enough that the upper 60% read as empty black
  rather than deep space. Fixed together:
  - `NODE_POSITIONS` in `CollectionConstellationBackground.jsx` is no
    longer a generated centred pentagon — it's five explicit fractional
    points squashed into the upper ~55% of the hero (`y` 0.12–0.53), so
    all five sit clear of the caption. If the caption ever gets taller,
    re-check these; the lowest node centre lands ~75px above the top of
    the caption gradient at 1920×1080.
  - `.auth-hero__overlay` is now a full-bleed bottom gradient scrim
    (`--bg` fading to transparent over ~190px) instead of a bordered,
    shadowed, `backdrop-filter`-blurred card. The blur was deliberately
    dropped, not merely not-added: a blurred band over a full-size
    animated canvas is the classic Android WebView stutter.
  - The field is now a triangulated mesh. Particles are seeded on a
    **jittered grid** (not pure random — random left bald patches) from
    a fixed-seed `mulberry32`, so the composition is identical every
    load, which is what makes the `prefers-reduced-motion` single frame
    a deliberate layout rather than a lucky roll. Each particle carries
    a `depth` driving size, alpha and speed together, so the near layer
    drifts visibly faster than the far one — that differential *is* the
    parallax; there is no separate parallax transform.
  - Node spokes are drawn in each College's own categorical accent
    (same `--sky`/`--violet`/`--rose`/`--amber`/`--lime` mapping as the
    cycler, now also held on the `COLLEGES` array in the component as
    `cssVar`). No new hue was introduced.

  Performance shape matters more than the raw counts here. Counts:
  ~`(w*h)/8200` particles clamped to 40–150 (138 at a 1089×1038 hero),
  `LINK_DISTANCE` 118 with `MAX_EDGES_PER_PARTICLE` 3,
  `NODE_LINK_DISTANCE` 190 with `MAX_EDGES_PER_NODE` 6. The old O(n²)
  double loop is gone: particles are bucketed into a uniform spatial
  hash sized to the link radius and only checked against the 9
  surrounding cells, and particle links are accumulated into 4 alpha
  buckets so the whole mesh costs 4 `stroke()` calls per frame rather
  than one per segment. **Don't "simplify" that back into per-segment
  strokes** — it's the reason the count could go up at all. Measured
  ~82fps sustained on desktop; not profiled on a real Android device.

  The centre glow on `.auth-hero .constellation-bg__scrim` dropped from
  `--accent` 14% to 7% and moved to `50% 32%`; at the old strength it
  read as a smudge once the mesh was carrying the depth.

  Verified live at 1920×1080 in both Sign in and Create account modes:
  all five nodes visible and unoccluded, `elementFromPoint` still
  returns the real control for tabs/inputs/submit/OAuth, typing works,
  and the canvas is pixel-identical across 4 samples over 2.1s when
  the page is loaded under CDP `Emulation.setEmulatedMedia`
  `prefers-reduced-motion: reduce`. Note the component listens for
  `change` on the media query too, but **that live flip could not be
  verified** — `setEmulatedMedia` on an already-loaded page doesn't
  fire the `change` event in this Chromium, so only the on-load path is
  proven. The `@media (max-width: 860px)` rule hiding
  `.auth-hero__overlay` and the nodes on phones was left exactly as is
  (a decision on that is still pending); 360px was re-checked and is
  unchanged. Lint + build clean.
- 2026-08-27 — Reset to a single starting point: V0 chats archived, stalled
  `v0/runtime-error-resolution-baf343a0` branch deleted unmerged (Commander
  View work is gone — next UI pass is a fresh isolated V0 screen, not a
  port of that branch). `DESIGN_TOKENS.md` is what V0 should be given.
- 2026-08-26 — Finished the Tailwind integration properly (packages +
  vite.config.js + CSS all in one commit, `f07d642`) after the earlier
  accidental partial-commit broke CI. Confirmed working on both release
  builds.
- 2026-08-25/26 — Google OAuth: web-side code is complete and working;
  Google itself still needs enabling in Supabase's dashboard with a real
  Google Cloud OAuth Client ID/Secret (external step, not blocked on
  code). See gotchas above for the native-app flow that's already built.
- 2026-08-25/26 — Overview hero rebuilt twice: first from a particle/
  "constellation" point-morph system (abandoned — a handful of points
  can't draw a recognizable icon) to real vector icons
  (`CollegeIcon.jsx`), then restyled again to a glossy 3D-badge look
  matching a reference the user liked. If asked to touch the College
  icons again, this file is the one shared component behind nav
  tabs/pickers/hero/sign-in background — a change here is global.
- 2026-08-25/26 — Added rotating banners (`SlidingBanner.jsx`, reused by
  `SteamPresenceCard.jsx` and `GuildPulseCard.jsx`) and a TradingView-style
  friend Mastery Score chart (`FriendMasteryChart.jsx`, on the Friends
  page) using `lightweight-charts` (already in the project via
  `PriceHistoryChart.jsx` — same up/down color convention, reuse it).
