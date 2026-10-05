# `data` branch — generated scraper output

This orphan branch is written **only** by the `scrape-and-deploy` GitHub Actions workflow.

- **Do not edit files here manually.** Changes will be overwritten by the next scheduled run.
- **Never merge this branch into `main`** (or `main` into this branch). The two branches share no history.

## Contents

| Path          | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `extra.json`  | Current stores with an Extra-Angebote leaflet; consumed by the web frontend. |
| `history.csv` | Append-only log: first time each store × leaflet combination was seen.      |
| `snapshots/`  | One JSON snapshot per scan day, used for diffs.                             |

Store and leaflet data: © Kaufland, retrieved from public web pages. Not covered by the
repository's MIT license. Code and documentation live on the `main` branch.
