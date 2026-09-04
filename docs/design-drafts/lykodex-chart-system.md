# Chart scrub + high/low — decision record

Full spec + live demo: https://claude.ai/code/artifact/aed78f70-2861-4aaf-b02e-0a448ac3dacf

That draft started from a different app's card-price chart (One Piece TCG,
with RAW/GRADED/POP tabs and PRO-gated ranges). Checked against this repo
before building anything:

- No PSA/grading or population data exists anywhere in this codebase —
  Lykodex's price feature is MTG pricing via Scryfall + Card Kingdom
  (`lib/tcgPricing.js`, `MtgPriceHistoryModal.jsx`). So RAW/GRADED/POP
  doesn't map to anything real here and was dropped.
- No PRO/premium tier exists yet, so range-gating was dropped too.
- The engine stays `lightweight-charts` per `DESIGN_TOKENS.md`'s
  `stock-style` pattern — nothing here introduces a second chart library.

What actually shipped, scoped to what's real (see `PriceHistoryChart.jsx`):

- **Scrub pill** — press/hover snaps to the nearest real point and shows
  its date + price, via `chart.subscribeCrosshairMove`. Full mode only.
- **Real high/low lines** — two dashed price lines at the actual max/min
  of whatever range is currently plotted, via `series.createPriceLine`
  (axis-labelled by the library itself, not custom-drawn).

Headline value + change already existed (`PriceChangeBadge` in
`MtgPriceHistoryModal.jsx`) and wasn't touched. Range selection (7d/30d/90d)
also already existed there and wasn't touched.

Not done in this pass, left for later if wanted: a real Normal/Foil
segmented control using the existing multi-source snapshot shape.
