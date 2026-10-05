# Kaufland Extra Finder

Find Kaufland stores near your postcode (PLZ) that currently publish an **Extra-Angebote** leaflet —
the store-specific offers that mydealz users call "Kaufland Extra Filialen".

> **Unofficial project.** Not affiliated with, endorsed by, or connected to Kaufland.
> "Kaufland" is a trademark of its respective owner. Data may be incomplete or outdated —
> always check the official leaflet before shopping.

## How it works

1. A scheduled GitHub Actions job scans every store's leaflet page on `filiale.kaufland.de`
   (a few times per week, low concurrency).
2. Stores with an Extra leaflet are written to `extra.json` on the `data` branch.
3. A static frontend (GitHub Pages) loads that JSON and filters by distance from your PLZ —
   entirely in your browser. No tracking, no cookies, no backend.

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

| Option | Default | Meaning |
|---|---|---|
| `--out DIR` | `data` | Where `extra.json`, `history.csv` and `snapshots/` are written. |
| `--previous DIR` | `--out` | Previous run's output (CI: the `data` branch checkout), used for `history.csv` and the diff. |
| `--stores IDS` | all | Comma-separated store ids; skips the minimum-store-count check. |
| `--workers N` | 4 | Concurrent requests, 1–4. |
| `--delay S` | 0.25 | Pause before each request. |
| `--summary FILE` | – | Append a Markdown report (e.g. `$GITHUB_STEP_SUMMARY`). |
| `--skip-pdf-check` | off | Don't download new Extra PDFs for the PDF check (see below). |

Exit codes: `0` success, `1` error (store list unavailable, unknown store id, …),
`2` sanity check failed (fewer than 700 stores or more than 5 % failures) — nothing is written.

### `extra.json` format

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-10-06T06:31:12+02:00",   // Europe/Berlin
  "store_count": 788,                              // stores scanned
  "failed_count": 0,
  "stores": [                                      // only stores with an Extra leaflet
    {
      "id": "DE4453", "name": "Kassel-Wesertor", "plz": "34125", "city": "Kassel",
      "street": "Franzgraben 40-42", "lat": 51.321132, "lng": 9.517428,
      "url": "https://filiale.kaufland.de/service/filiale/kassel-wesertor-4453.html",  // optional
      "leaflets": [                                // Mon–Wed often current + next week
        { "valid_from": "2026-10-08", "valid_to": "2026-10-14",
          "cluster": "<PDF uuid>", "viewer": "https://leaflets.kaufland.com/…", "pdf": "https://…pdf",
          "pdf_store": "KARLSRUHE-OSTSTADT, IM DURLACH CENTER",   // optional, see below
          "pdf_store_match": false }
      ],
      "special_days": [                            // optional; only today and later
        { "date": "2026-10-08", "closed": true },
        { "date": "2026-12-24", "open": "07:00", "close": "13:30" }
      ]
    }
  ],
  "clusters": { "<PDF uuid>": ["DE4453", "…"] }   // stores sharing the identical leaflet
}
```

Expired leaflets are not filtered by the scraper; consumers compare `valid_to` with today's date.

### PDF check

Page 1 of every Extra PDF names the store(s) it is valid in ("NUR IN KARLSRUHE-OSTSTADT, IM DURLACH
CENTER"; several stores are separated by "•"). Kaufland also serves such a PDF to neighbouring
stores that the PDF does not name. The scraper downloads every **new** PDF once (2 s apart, ~6 MB
each), reads that block (`pypdf`) and sets `pdf_store` / `pdf_store_match` per leaflet. Results are
cached per PDF in `pdf_checks.json` next to `extra.json`; failed downloads are retried on the next
run and leave both fields out. `--skip-pdf-check` disables the downloads (cached results are still
used). The footer code in the PDF ("1_D41-H_8530_TS") does not identify the store reliably.

### Postcode coordinates (`web/public/plz.json`)

`plz.json` maps every German PLZ to one coordinate: `{"76137":[49.0019,8.4287], …}`, one PLZ per
line, ~87 KB gzipped. It rarely changes and is committed to `main`. To regenerate it:

```sh
uv run scripts/build_plz.py                   # downloads GeoNames DE.zip, writes web/public/plz.json
uv run scripts/build_plz.py --source DE.zip   # or use a local DE.zip / DE.txt
```

GeoNames has one row per PLZ *and place*, so a PLZ covering several villages has several rows; each
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
- The page makes no third-party request until the first search; then the Leaflet chunk is loaded
  and map tiles come from `tile.openstreetmap.org`. No cookies, no storage, no external fonts.
- Search state lives in the URL (`?plz=76137&r=50`); geolocation results never put coordinates
  into the URL.
- XSS: all data is rendered through `h()` (`src/dom.ts`), which only creates text nodes and refuses
  `on*` attributes and non-http(s) URLs; ESLint forbids `innerHTML` & co. Leaflet tooltips get DOM
  nodes, not strings. A CSP meta tag (production build) allows only same-origin resources plus OSM
  tiles.
- `impressum.html` and `datenschutz.html` are placeholders to be filled in by the site owner.
- Look and feel follow Material Design 3 (hand-written CSS with M3 colour roles, shape, elevation
  and state layers; no component library). Icons are Material Symbols path data built with
  `createElementNS` (`src/icons.ts`).
- `fixtures/extra.json` is real scraper output for 6 stores; edge cases (two validity periods,
  closure days) are derived from it in the tests.

## Data & attribution

- Store and leaflet data: © Kaufland, retrieved from public web pages. Not covered by this repository's license.
- Postcode coordinates: `web/public/plz.json` is derived from the
  [GeoNames](https://www.geonames.org/) postal code dataset
  ([download](https://download.geonames.org/export/zip/)) by GeoNames, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: rows aggregated to one
  coordinate per PLZ (median of all places), rounded to 4 decimals. The derived file is likewise
  available under CC BY 4.0, not under this repository's MIT license.
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Icons: [Material Symbols](https://github.com/google/material-design-icons) by Google,
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## License

Code: [MIT](LICENSE)
