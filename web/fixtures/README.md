# Frontend fixtures

`extra.json` is **real scraper output** (`kef-scrape --stores DE4443,DE5443,DE8530,DE4733,DE4453,DE4313`,
2026-10-05), unmodified: real viewer, PDF and store links, and real clusters (the three Karlsruhe
stores share one Extra leaflet). Links point to that week's leaflets and stop working once Kaufland
removes them; for current data run the scraper and use `KEF_EXTRA_JSON`.

The dev server shifts all dates by whole weeks so the sample always looks current. Edge cases
(two validity periods, closure days, special hours) are derived from this file inside the tests.

`store_count` and `failed_count` reflect the 6-store run, not a full scan.
