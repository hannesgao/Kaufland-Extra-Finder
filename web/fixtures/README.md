# Frontend fixtures

Two sets of **real scraper output**, with real viewer, PDF and store links. Links point to the
leaflets of that week and stop working once Kaufland removes them; for current data run the
scraper and use `KEF_EXTRA_JSON` / `KEF_CARDS_JSON` / `KEF_DEALS_JSON`.

## Dev server (`fixtures/`)

Used by `npm run dev`; the dev server shifts all dates by whole weeks so the data always looks
current.

- `extra.json` and `deals.json`: the scan of Thursday 2026-11-12 (21:15) from the `data` branch,
  unmodified (formatted with Prettier).
  - `extra.json`: 103 stores with Extra leaflets valid Monday 09.11. to Saturday 14.11.2026
    (Kaufland's offer week runs Monday to Saturday since 12.10.2026) in 45 PDFs; 51 stores are
    named by their PDF, 52 are not (e.g. Karlsruhe-Grünwinkel's names Karlsruhe-Oststadt). Every
    store has a current leaflet, so the section "Derzeit ohne Extra-Prospekt" is empty; `past`
    leaflets go back to 2026-10-06.
  - `deals.json`: 72 offers valid 08.11. to 14.11.2026 in the 51 stores named by their Extra PDF.
- `cards.json`: the offer scan of Monday 2026-11-02, filtered with the current trading-card rule
  (`is_card` in `scraper/src/kef_scraper/offers.py`): 4 Pokémon products in 49 stores. It is older
  than the other two because the scan of 2026-11-12 found no trading cards; each file is shifted
  by its own date. The raw file also listed an album for cards in 784 stores, which the rule
  leaves out since #47.

## Unit tests (`test/fixtures/`)

Frozen so the tests do not change with the dev data:

- `extra-2026-10-05.json`: the stores DE4313, DE4443, DE4453, DE4733, DE5443 and DE8530 from the
  full scan on 2026-10-05 (clusters reduced to these stores), from the old Thursday-to-Wednesday
  week. The three Karlsruhe stores share one Extra leaflet whose PDF names only
  Karlsruhe-Oststadt, so Beiertheim-Bulach and Grünwinkel are flagged (`pdf_store_match: false`).
  Edge cases (two validity periods, closure days, special hours, Monday-to-Saturday leaflets) are
  derived from this file in `test/helpers.ts`.
- `cards-2026-10-06.json`: trading-card offers of six stores from the offer scan on 2026-10-06.
- `deals-2026-11-12.json`: the stores DE1480, DE1600, DE2560, DE4443 and DE4453 from the same
  `deals.json` as the dev fixture (products reduced to theirs, `extra_store_count` set to 5). One
  offer has another price in two stores, and one is listed without its title in the PDF.
