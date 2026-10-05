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

_Setup instructions will be added as the project takes shape._

## Data & attribution

- Store and leaflet data: © Kaufland, retrieved from public web pages. Not covered by this repository's license.
- Postcode coordinates: [GeoNames](https://www.geonames.org/), CC BY 4.0.
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

Code: [MIT](LICENSE)
