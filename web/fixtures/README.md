# Frontend fixtures

Two sets of **real scraper output**, with real viewer, PDF and store links. Links point to the
leaflets of that week and stop working once Kaufland removes them; for current data run the
scraper and use `KEF_EXTRA_JSON` / `KEF_CARDS_JSON`.

## Dev server (`fixtures/`)

Used by `npm run dev`; the dev server shifts all dates by whole weeks so the data always looks
current.

- `extra.json`: the full scan of Monday 2026-11-02 from the `data` branch, content unmodified
  (formatted with Prettier): 45 stores with Extra leaflets valid Monday 02.11. to Saturday
  07.11.2026 (Kaufland's offer week runs Monday to Saturday since 12.10.2026). Every store has its
  own PDF; some PDFs name a different store (e.g. Karlsruhe-Grünwinkel's names Karlsruhe-Oststadt).
- `cards.json`: the offer scan of the same run, filtered with the current trading-card rule
  (`is_card` in `scraper/src/kef_scraper/offers.py`): 4 Pokémon products in 49 stores. The raw file
  also listed an album for cards in 784 stores, which the rule leaves out since #47.

## Unit tests (`test/fixtures/`)

Frozen so the tests do not change with the dev data:

- `extra-2026-10-05.json`: the stores DE4313, DE4443, DE4453, DE4733, DE5443 and DE8530 from the
  full scan on 2026-10-05 (clusters reduced to these stores), from the old Thursday-to-Wednesday
  week. The three Karlsruhe stores share one Extra leaflet whose PDF names only
  Karlsruhe-Oststadt, so Beiertheim-Bulach and Grünwinkel are flagged (`pdf_store_match: false`).
  Edge cases (two validity periods, closure days, special hours, Monday-to-Saturday leaflets) are
  derived from this file in `test/helpers.ts`.
- `cards-2026-10-06.json`: trading-card offers of six stores from the offer scan on 2026-10-06.
