# Test fixtures

Captured once from `filiale.kaufland.de` on 2026-10-05. Tests never touch the network.

| File | Source | Notes |
|---|---|---|
| `klstorefinder_sample.json` | `GET /.klstorefinder.json` | 5 of 788 store records, unmodified. DE1530 has special opening days (`sod`). |
| `prospekte_DE4453.html` | `GET /prospekte.html`, cookie `x-aem-variant=DE4453` | Has an Extra leaflet (`Hyper1`, valid 08.10.–14.10.2026). |
| `prospekte_DE8530.html` | same, `x-aem-variant=DE8530` | Has an Extra leaflet with a different PDF (different cluster). |
| `prospekte_DE1300.html` | same, `x-aem-variant=DE1300` | No Extra leaflet. |

## Trimming

The full pages are ~225 KB each. Only the `<div data-t-name="FlyerOverviewRedux">` element (which
contains every `FlyerTile`) is kept, wrapped in a minimal HTML document. Its content is unmodified.

## Refreshing

Fetch a handful of stores only (never a full scan), e.g. with
`curl -b "x-aem-variant=DE4453" https://filiale.kaufland.de/prospekte.html`, then trim as above.
Update the expectations in the tests if the leaflet dates or PDF ids change.
