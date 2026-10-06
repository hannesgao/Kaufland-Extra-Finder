# Test fixtures

Captured once from `filiale.kaufland.de` on 2026-10-05. Tests never touch the network.

| File | Source | Notes |
|---|---|---|
| `klstorefinder_sample.json` | `GET /.klstorefinder.json` | 5 of 788 store records, unmodified. DE1530 has special opening days (`sod`). |
| `prospekte_DE4453.html` | `GET /prospekte.html`, cookie `x-aem-variant=DE4453` | Has an Extra leaflet (`Hyper1`, valid 08.10.–14.10.2026). |
| `prospekte_DE8530.html` | same, `x-aem-variant=DE8530` | Has an Extra leaflet with a different PDF (different cluster). |
| `prospekte_DE1300.html` | same, `x-aem-variant=DE1300` | No Extra leaflet. |
| `angebote_DE4443.html` | `GET /angebote/uebersicht.html`, cookie `x-aem-variant=DE4443`, 2026-10-06 | Offer overview with both Pokémon offers (one announced, one next week, the latter in two categories), a FUNKO calendar that mentions Pokémon only in its description, a few other offers and one without a title. |

## Trimming

The full pages are ~225 KB each. Only the `<div data-t-name="FlyerOverviewRedux">` element (which
contains every `FlyerTile`) is kept, wrapped in a minimal HTML document. Its content is unmodified.

The offer overview is ~5 MB; its offers are JSON in `window.SSR[...] = {"component":"OfferTemplate",…}`.
The fixture keeps that one `<script>` with `weekData` and every cycle, but only the categories and
offers listed above; each kept category and offer object is unmodified.

## Refreshing

Fetch a handful of stores only (never a full scan), e.g. with
`curl -b "x-aem-variant=DE4453" https://filiale.kaufland.de/prospekte.html`, then trim as above.
Update the expectations in the tests if the leaflet dates or PDF ids change.
