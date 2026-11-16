# Test fixtures

Captured from `filiale.kaufland.de` on 2026-10-05 unless noted. Tests never touch the network.

| File | Source | Notes |
|---|---|---|
| `robots.txt` | `GET /robots.txt`, 2026-11-16 | Unmodified. Disallows `/*.klstorefinder*`, the store list the scraper read until then. |
| `sitemap_sample.xml` | `GET /.sitemap.xml`, 2026-11-16 | 10 of 6314 entries, unmodified: six store pages (one with a double hyphen) and four other pages. |
| `filiale_DE4453.html` | `GET /service/filiale/kassel-wesertor-4453.html`, 2026-11-16 | Store page with an Extra leaflet (`Hyper1`, valid 15.11.–21.11.2026). |
| `filiale_DE1300.html` | `GET /service/filiale/ahaus-1300.html`, 2026-11-16 | Store page without an Extra leaflet; one special opening day (closed on 22.11.2026). |
| `klstorefinder_sample.json` | `GET /.klstorefinder.json` (no longer requested) | 5 of 788 store records, unmodified. DE1530 has special opening days (`sod`). The tests build store pages from these records (`conftest.store_page`). |
| `prospekte_DE4453.html` | `GET /prospekte.html`, cookie `x-aem-variant=DE4453` | Has an Extra leaflet (`Hyper1`, valid 08.10.–14.10.2026). The store pages carry the same leaflet section; the tests use these files as that section. |
| `prospekte_DE8530.html` | same, `x-aem-variant=DE8530` | Has an Extra leaflet with a different PDF (different cluster). |
| `prospekte_DE4453_2026-10-11.html` | same, `x-aem-variant=DE4453`, 2026-10-11 | First week of Kaufland's Mon–Sat rhythm: the old Extra leaflet (`Hyper1`, 08.10.–14.10.) and the new one (`Hyper2`, Mon 12.10.–Sat 17.10.) overlap. |
| `prospekte_DE1300.html` | same, `x-aem-variant=DE1300` | No Extra leaflet. |
| `angebote_DE4443.html` | `GET /angebote/uebersicht.html`, cookie `x-aem-variant=DE4443`, 2026-10-06 | Offer overview with both Pokémon offers (one announced, one next week, the latter in two categories), a FUNKO calendar that mentions Pokémon only in its description, a few other offers and one without a title. |

## Trimming

The full pages are ~225 KB each. Only the `<div data-t-name="FlyerOverviewRedux">` element (which
contains every `FlyerTile`) is kept, wrapped in a minimal HTML document. Its content is unmodified.

The store pages are ~350 KB each. Kept are the opening tag of `<div data-t-name="StoreDetails">`
(it has the store id) and, inside it, the elements `<div data-t-name="StoreInfo">` and
`<div data-t-name="FlyerOverviewRedux">`, each unmodified.

The offer overview is ~5 MB; its offers are JSON in `window.SSR[...] = {"component":"OfferTemplate",…}`.
The fixture keeps that one `<script>` with `weekData` and every cycle, but only the categories and
offers listed above; each kept category and offer object is unmodified.

## Refreshing

Fetch a handful of stores only (never a full scan), e.g. with
`curl https://filiale.kaufland.de/service/filiale/kassel-wesertor-4453.html`, then trim as above.
Update the expectations in the tests if the leaflet dates or PDF ids change.
