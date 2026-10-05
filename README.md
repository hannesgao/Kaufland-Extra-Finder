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
      "leaflets": [                                // Mon–Wed often current + next week
        { "valid_from": "2026-10-08", "valid_to": "2026-10-14",
          "cluster": "<PDF uuid>", "viewer": "https://leaflets.kaufland.com/…", "pdf": "https://…pdf" }
      ]
    }
  ],
  "clusters": { "<PDF uuid>": ["DE4453", "…"] }   // stores sharing the identical leaflet
}
```

Expired leaflets are not filtered by the scraper; consumers compare `valid_to` with today's date.

## Data & attribution

- Store and leaflet data: © Kaufland, retrieved from public web pages. Not covered by this repository's license.
- Postcode coordinates: [GeoNames](https://www.geonames.org/), CC BY 4.0.
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

Code: [MIT](LICENSE)
