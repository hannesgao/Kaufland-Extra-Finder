# Frontend fixtures

`extra.json` is **real scraper output**: the stores DE4313, DE4443, DE4453, DE4733, DE5443 and DE8530
taken unmodified from a full scan on 2026-10-05 (clusters reduced to these stores): real viewer, PDF and store links, and real clusters (the three Karlsruhe
stores share one Extra leaflet). Links point to that week's leaflets and stop working once Kaufland
removes them; for current data run the scraper and use `KEF_EXTRA_JSON`.

It includes the PDF check: the Karlsruhe PDF names only Karlsruhe-Oststadt, so Beiertheim-Bulach
and Grünwinkel are flagged (`pdf_store_match: false`).

The dev server shifts all dates by whole weeks so the sample always looks current. Edge cases
(two validity periods, closure days, special hours) are derived from this file inside the tests.
