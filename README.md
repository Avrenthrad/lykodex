# Lykodex

One place for everything you collect, across five Colleges:

| College | What it covers |
|---|---|
| **Gaming** | Game library (Steam, Xbox, PlayStation), wishlist prices across stores, backlog, achievements, release calendar |
| **TCG** | Card search, collections, binders, decks and prices for Pokémon, Magic: The Gathering, One Piece, Flesh and Blood and Yu-Gi-Oh! |
| **Library** | Movies, TV, anime, books and comics |
| **Loot** | Collectibles: Funko Pops, LEGO, vinyl, statues and more, with barcode scanning |
| **Wartable** | Tabletop campaigns, characters, armies and D&D 5e rules search |

Plus friends, guilds, direct messages, a user-to-user TCG marketplace,
Mastery scores and the Lykodex Discord bot.

Run by the Lykodex Team at Lykosoft.

## Stack

- **Web app:** React 19 + Vite, plain CSS (`src/index.css`, tokens in `DESIGN_TOKENS.md`)
- **Backend:** Supabase (auth, Postgres with row-level security, storage). Schema: `supabase/schema.sql`
- **Server functions:** Vercel, in `api/`. These are third-party API proxies and anything needing the service-role key
- **Desktop / mobile:** Tauri (`src-tauri/`) and Capacitor. See `PACKAGING.md`
- **Discord bot:** `discord-bot/`, a separate always-on Node process on Railway. See its README

## Running locally

```
npm install
cp .env.example .env   # fill in what you need; see the comments in that file
npm run dev
```

You need `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for
accounts. The other keys each power one integration (Steam, TMDB,
price services and so on).

`/api` functions only run under Vercel (`vercel dev`) or on a
deployment. Plain `npm run dev` serves the front end only.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | oxlint |
| `npm run preview` | Serve the built app |
| `npm run tauri:dev` / `tauri:build` | Desktop app |

## Docs

- `HANDOFF.md`: history and reasoning behind features
- `DESIGN_TOKENS.md`: colours, type and component styles
- `docs/COMPLIANCE.md`: privacy, legal and accessibility checklist
- `PACKAGING.md`: desktop and mobile builds
