# Kaufland Extra Finder

Find Kaufland stores near your postcode (PLZ) that currently publish an **Extra-Angebote** leaflet —
the store-specific offers that mydealz users call "Kaufland Extra Filialen".

**→ [hannesgao.github.io/Kaufland-Extra-Finder](https://hannesgao.github.io/Kaufland-Extra-Finder/)**
(German UI; data updated Mon–Wed 06:30 and Thu 05:30, Berlin time)

> **Unofficial project.** Not affiliated with, endorsed by, or connected to Kaufland.
> "Kaufland" is a trademark of its respective owner. Data may be incomplete or outdated —
> always check the official leaflet before shopping.

## How it works

1. A scheduled GitHub Actions job scans every store's leaflet page on `filiale.kaufland.de`
   (four times a week, low concurrency).
2. Stores with an Extra leaflet are written to `extra.json` on the `data` branch. Each new Extra
   PDF is downloaded once to read which store(s) it names ("NUR IN …"): Kaufland also shows such a
   leaflet to neighbouring stores it does not apply to.
3. A static frontend (GitHub Pages) loads that JSON and filters by distance from your PLZ —
   entirely in your browser. No tracking, no cookies, no backend. By default it lists only stores
   whose PDF names them.

## Development

### Scraper (`scraper/`)

Requires [uv](https://docs.astral.sh/uv/). Python 3.12 is installed by uv if needed.

```sh
cd scraper
uv sync                                   # create .venv with runtime + dev dependencies
uv run ruff check . && uv run ruff format --check .
uv run mypy                               # strict type check of src/ and tests/
uv run pytest                             # offline; tests never touch the network
uv run kef-scrape --stores DE4453,DE8530  # live check of a few stores, writes ./data/
```

Please don't run full scans locally; they run on a schedule in GitHub Actions.

`kef-scrape` options:

| Option             | Default | Meaning                                                                                         |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `--out DIR`        | `data`  | Where `extra.json`, `history.csv`, `snapshots/` (and with `--offers` `cards.json`) are written. |
| `--previous DIR`   | `--out` | Previous run's output (CI: the `data` branch checkout), used for `history.csv` and the diff.    |
| `--stores IDS`     | all     | Comma-separated store ids; skips the minimum-store-count check.                                 |
| `--workers N`      | 4       | Concurrent requests, 1–4.                                                                       |
| `--delay S`        | 0.25    | Pause before each request.                                                                      |
| `--summary FILE`   | –       | Append a Markdown report (e.g. `$GITHUB_STEP_SUMMARY`).                                         |
| `--skip-pdf-check` | off     | Don't download new Extra PDFs for the PDF check (see below).                                    |
| `--offers`         | off     | Also read every store's offer overview and write `cards.json` (trading cards, see below).       |

Exit codes: `0` success, `1` error (store list unavailable, unknown store id, …),
`2` sanity check failed (fewer than 700 stores or more than 5 % failures) — nothing is written.

### `extra.json` format

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-10-06T06:31:12+02:00", // Europe/Berlin
  "store_count": 788, // stores scanned
  "failed_count": 0,
  "stores": [
    // only stores with an Extra leaflet
    {
      "id": "DE4453",
      "name": "Kassel-Wesertor",
      "plz": "34125",
      "city": "Kassel",
      "street": "Franzgraben 40-42",
      "lat": 51.321132,
      "lng": 9.517428,
      "url": "https://filiale.kaufland.de/service/filiale/kassel-wesertor-4453.html", // optional
      "leaflets": [
        // Mon–Wed often current + next week
        {
          "valid_from": "2026-10-08",
          "valid_to": "2026-10-14",
          "cluster": "<PDF uuid>",
          "viewer": "https://leaflets.kaufland.com/…",
          "pdf": "https://…pdf",
          "pdf_store": "KARLSRUHE-OSTSTADT, IM DURLACH CENTER", // optional, see below
          "pdf_store_match": false,
        },
      ],
      "special_days": [
        // optional; only today and later
        { "date": "2026-10-08", "closed": true },
        { "date": "2026-12-24", "open": "07:00", "close": "13:30" },
      ],
    },
  ],
  "clusters": { "<PDF uuid>": ["DE4453", "…"] }, // stores sharing the identical leaflet
}
```

Expired leaflets are not filtered by the scraper; consumers compare `valid_to` with today's date.

### PDF check

Page 1 of every Extra PDF names the store(s) it is valid in ("NUR IN KARLSRUHE-OSTSTADT, IM DURLACH
CENTER"; several stores are separated by "•"). Kaufland also serves such a PDF to neighbouring
stores that the PDF does not name. The scraper downloads every **new** PDF once (5 s apart, ~6 MB
each), reads that block (`pypdf`) and sets `pdf_store` / `pdf_store_match` per leaflet. Results are
cached per PDF in `pdf_checks.json` next to `extra.json`. The PDF host answers 503 when hurried:
failed downloads get a second pass in the same run (after 60 s, 15 s apart); what still fails is
retried on the next run and leaves both fields out, which the web page shows as "PDF-Prüfung
ausstehend". `--skip-pdf-check` disables the downloads (cached results are still used). The footer code in the PDF ("1_D41-H_8530_TS") does not identify the store reliably.

### Trading-card offers (`cards.json`)

With `--offers`, the scraper also reads each store's offer overview
(`/angebote/uebersicht.html`, cookie `x-aem-variant=<store id>`). The page embeds every offer of
the current and the next week, plus announced offers ("Vorwerbung", advertised about a week
before the sale), as JSON; offers differ between stores. Offers whose title or subtitle contains
a keyword from `CARD_KEYWORDS` in `scraper/src/kef_scraper/offers.py` (accents and case ignored;
so far only `pokemon`) are written to `cards.json`. The report lists offers that look like
trading cards but match no keyword (Booster, TCG, Yu-Gi-Oh!, …), so a new brand shows up there.

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-10-06T06:30:00+02:00",
  "keywords": ["pokemon"],
  "store_count": 784, // offer overviews read (stores without offers included)
  "products": {
    "20973783|2026-10-04": {
      // article number | first day shown
      "kl_nr": "20973783",
      "title": "POKÉMON",
      "subtitle": "Sammelkartenspiel »Top-Trainer-Box«",
      "price": "55.00",
      "unit": "je",
      "shown_from": "2026-10-04",
      "shown_to": "2026-10-09", // advertised on kaufland.de
      "sales_from": "2026-10-12",
      "sales_to": "2026-10-17", // announced offers only: the sale
      "category": "Vorwerbung",
      "week": "current", // where the offer overview lists it
      "thumbnail": "https://kaufland.media.schwarz/…?…", // 150 px wide; thumbnail_2x: 322 px
      "thumbnail_2x": "https://kaufland.media.schwarz/…?…",
    },
  },
  "stores": [
    // only stores with at least one product
    {
      "id": "DE4443",
      "name": "Karlsruhe-Oststadt",
      "plz": "76137",
      "city": "Karlsruhe",
      "street": "…",
      "lat": 49.0,
      "lng": 8.4,
      "url": "https://filiale.kaufland.de/…",
      "products": ["20941886|2026-10-08", "20973783|2026-10-04"],
    },
  ],
}
```

A store whose page has no offer data (e.g. a closed store) counts as a store without offers. If
more than 5 % of the offer overviews fail or have no offer data, `cards.json` is not written (the
previous one stays) while `extra.json` is still updated. An offer means the store advertises it,
not that it is in stock.

### Postcode coordinates (`web/public/plz.json`)

`plz.json` maps every German PLZ to one coordinate: `{"76137":[49.0019,8.4287], …}`, one PLZ per
line, ~87 KB gzipped. It rarely changes and is committed to `main`. To regenerate it:

```sh
uv run scripts/build_plz.py                   # downloads GeoNames DE.zip, writes web/public/plz.json
uv run scripts/build_plz.py --source DE.zip   # or use a local DE.zip / DE.txt
```

GeoNames has one row per PLZ _and place_, so a PLZ covering several villages has several rows; each
PLZ is reduced to the median latitude/longitude of its rows. The script refuses to write the file if
fewer than 8,000 PLZ or more than 1 % invalid rows are found.

Checks for `scripts/` reuse the scraper's dev environment:

```sh
cd scripts
uv run --project ../scraper ruff check . && uv run --project ../scraper ruff format --check .
uv run --project ../scraper mypy
uv run --project ../scraper pytest
```

### Frontend (`web/`)

Vite + TypeScript (no framework), Leaflet for the map. Requires Node 24 (`.nvmrc`).

```sh
cd web
npm ci
npm run dev                                   # http://localhost:5173/Kaufland-Extra-Finder/
KEF_EXTRA_JSON=../scraper/data/extra.json npm run dev   # use a local scraper run instead
npm run lint && npm run typecheck && npm run format:check
npm test                                      # vitest, offline
KEF_EXTRA_JSON=fixtures/extra.json npm run build && npm run preview
```

- `data/extra.json` is served from `fixtures/extra.json` in development (a sample; dates are shifted
  by whole weeks so it always looks current). Production builds **require** `KEF_EXTRA_JSON`, so a
  fixture can never be deployed by accident; the deploy job passes the `data` branch's file.
- On page load the default PLZ 76131 (25 km) is searched, so the map and the store cards show
  right away. Map tiles therefore come from `tile.openstreetmap.org` on every visit of the search
  tab (the _Alle Extra-Filialen_ tab loads no map). No cookies, no storage, no external fonts.
- Three tabs: _Umkreissuche_ (radius search with map), _Alle Extra-Filialen_ (all stores with a
  current or upcoming Extra leaflet, sortable by PLZ) and _Pokémon-Angebote_ (stores near the
  PLZ with Pokémon offers, from `cards.json`; on narrow screens the tabs read _Umkreis_,
  _Extra-Filialen_, _Pokémon_). PLZ and radius are shared by both search forms. State lives in the
  URL (`?plz=76137&r=50&tab=all&sort=plz-desc`, `tab=cards`); geolocation results never put
  coordinates into it.
- _Pokémon-Angebote_: `data/cards.json` is loaded when the tab is first shown. It is
  optional: in development it is served from `fixtures/cards.json` (dates shifted like
  `extra.json`) or `KEF_CARDS_JSON`; a production build includes it only when `KEF_CARDS_JSON` is
  set, otherwise the tab says that no offers are available yet. Each store card lists its offers
  with a thumbnail (loaded from `kaufland.media.schwarz` without a referrer), price, "ab …" (not on
  sale yet) or "bis …" (on sale) and a link to Kaufland's offer overview for that store
  (`?kloffer-articleID=<article number>&storeName=<store id>`: Kaufland's page switches the
  visitor's selected store to it and adds category and week itself; without `storeName` the
  article may be missing in whatever store the visitor has selected).
  Above the store cards, one toggle per article (price, date, "in N Filialen", distance of the
  nearest store with it) filters the stores by that article (`p=<article number>`). A second view
  "Nach Artikeln" (`view=artikel`) shows one card per article, fewest stores first, with its stores
  sorted by distance (no radius; five at first, "Alle … anzeigen" for the rest).
- _Alle Extra-Filialen_ can export the list as shown (PDF switch, sort order) as HTML, PNG or PDF
  (`src/export/`), generated in the browser without libraries or network: a standalone HTML file
  with inline styles, a canvas-drawn PNG at 2×, and an A4 PDF written by hand (standard fonts
  Helvetica/Helvetica-Bold in WinAnsiEncoding, text measured with their AFM widths, header row
  and page numbers on every page). Columns: PLZ, store, street, validity, and "Im PDF genannt"
  when the PDF switch is off.
- The footer is one shared partial (`partials/footer.html`) included into every page at build time.
- Both tabs show a collapsed note "Woher stammen die Angaben?" (`partials/source-note.html`):
  data comes from Kaufland's store pages, Kaufland lists one Extra PDF at several neighbouring
  stores, and only the PDF's "NUR IN …" line says where it applies. The card of stores sharing a
  leaflet ("Dieser Extra-Prospekt ist auf kaufland.de auch bei diesen Filialen gelistet") marks
  each one as named or not named in the PDF.
- XSS: all data is rendered through `h()` (`src/dom.ts`), which only creates text nodes and refuses
  `on*` attributes and non-http(s) URLs; ESLint forbids `innerHTML` & co. Leaflet tooltips get DOM
  nodes, not strings. A CSP meta tag (production build) allows only same-origin resources plus OSM
  tiles and images from `kaufland.media.schwarz`.
- `impressum.html` and `datenschutz.html` (German) describe the actual data flows: GitHub Pages
  hosting, OSM tiles, product thumbnails from Kaufland, local-only geolocation, the PLZ in the URL,
  GitHub Sponsors as a plain link.
  Update them when a new external service or request is added.
- External links open in a new tab with `rel="noopener noreferrer"` (except `mailto:`).
- Look and feel follow Material Design 3 (hand-written CSS with M3 colour roles, shape, elevation
  and state layers; no component library). Icons are Material Symbols path data built with
  `createElementNS` (`src/icons.ts`).
- `fixtures/extra.json` is real scraper output for 6 stores; edge cases (two validity periods,
  closure days) are derived from it in the tests.

## CI/CD (`.github/workflows/`)

| Workflow                | Trigger                          | What it does                                                                                                                                                                                            |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | pull requests, push to `main`    | Scraper and scripts (ruff, mypy, pytest) and web (lint, typecheck, format, tests, build with the fixture). The job `ci` sums them up and is the required check for `main`.                              |
| `scrape-and-deploy.yml` | schedule, manual, push to `main` | Scrapes all stores, commits the output to the `data` branch and deploys the site to GitHub Pages. On push to `main`, and when run manually with `mode=deploy`, it only redeploys with the current data. |
| `release.yml`           | GitHub Release published, manual | Checks that the release tag matches the versions of web and scraper, then starts a deploy-only run so the footer shows the release date.                                                                |

**Schedule.** Mon–Wed 06:30 and Thu 05:30 Berlin time: next week's leaflets appear on Monday and
become valid on Thursday. GitHub cron runs in UTC, so every time is listed twice (CEST and CET);
a gate job keeps the entry that matches Berlin's current UTC offset. Scheduled runs can start late.
The Monday and Thursday runs also scan the offer overviews for trading cards (`--offers`, about
330 MB more and a few minutes): announced offers appear on Sundays about a week before the sale,
and the weekly offers start on Thursdays. Manual runs scan them unless `-f offers=false`.

**Data.** The scrape job reads the previous `extra.json`, `pdf_checks.json` and `history.csv` from
the `data` branch, so only new PDFs are downloaded. If the sanity check fails (exit code 2), the
job fails, nothing is committed and the site keeps the previous data. The report appears on the
run's summary page. Without `extra.json` on the `data` branch, deploy is skipped with a notice.

Run a scrape and deploy by hand:

```sh
gh workflow run scrape-and-deploy.yml                # scrape and deploy
gh workflow run scrape-and-deploy.yml -f mode=deploy # only rebuild and deploy
gh run watch
```

**60-day limit.** GitHub disables scheduled workflows in public repositories after 60 days without
repository activity and sends an e-mail beforehand. To re-enable: Actions → "Scrape and deploy" →
"Enable workflow", or `gh workflow enable scrape-and-deploy.yml`.

**Supply chain.** Only GitHub-owned actions, pinned to full commit SHAs (the repository requires
SHA pinning). uv is installed with `pip --require-hashes` from `.github/uv/requirements.txt`.
Dependabot updates actions, uv, the scraper's and the web's dependencies weekly. Every job gets
the minimal `permissions`: only the scrape job may push (to `data`), only the deploy job may
deploy to Pages.

## Releasing

Every merge to `main` deploys; a release marks a version worth naming. The footer shows the
version and when it was released (Berlin time): the deploy job looks up the GitHub Release
`v<version>` and passes its publish time to the build (`KEF_RELEASED_AT`). A version without a
release shows its build time instead ("Build: …").

1. Open a pull request that sets the same `version` in `web/package.json` and
   `scraper/pyproject.toml`, and merge it.
2. Publish a GitHub Release with the tag `v<version>` on `main`, named
   "Kaufland Extra Finder <version>", with notes (what changed, known limitations). Create the
   tag on GitHub (web UI or `gh release create v<version> --target main`), not locally.
3. Publishing runs `release.yml`: it fails if the tag does not match both versions, otherwise it
   starts a deploy-only run of `scrape-and-deploy.yml` on `main` (the Pages environment only
   deploys from `main`), and the footer switches to "Released: <date>". It can also be run by
   hand for an existing tag.

## Data & attribution

- Store, leaflet and offer data, product images: © Kaufland, retrieved from public web pages. Not
  covered by this repository's license.
- Postcode coordinates: `web/public/plz.json` is derived from the
  [GeoNames](https://www.geonames.org/) postal code dataset
  ([download](https://download.geonames.org/export/zip/)) by GeoNames, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: rows aggregated to one
  coordinate per PLZ (median of all places), rounded to 4 decimals. The derived file is likewise
  available under CC BY 4.0, not under this repository's MIT license.
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Icons: [Material Symbols](https://github.com/google/material-design-icons) by Google,
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Support

The project is private, non-commercial and open source. If it saves you a trip, you can support it
via [GitHub Sponsors](https://github.com/sponsors/hannesgao). Bugs and ideas:
[issues](https://github.com/hannesgao/Kaufland-Extra-Finder/issues).

## License

Code: [MIT](LICENSE)
