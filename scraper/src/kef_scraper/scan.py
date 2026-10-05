"""Scan stores concurrently through a `Fetcher` and classify their leaflets."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor

from kef_scraper.fetch import MAX_WORKERS, Fetcher, FetchError
from kef_scraper.models import Leaflet, ScanResult, Store, StoreResult, Tile
from kef_scraper.parse import ParseError, is_extra, is_standard, parse_tiles, to_leaflet

log = logging.getLogger(__name__)


def scan_store(fetcher: Fetcher, store: Store) -> StoreResult:
    """Fetch and classify one store. Never raises for expected failures; sets `error` instead."""
    try:
        tiles = parse_tiles(fetcher.leaflet_page(store.id))
        if not tiles:
            # Every store has standard leaflets; an empty page means a block or a layout change.
            raise ParseError("no leaflet tiles found")
        leaflets: dict[tuple[str, str], Leaflet] = {}
        unusual: list[Tile] = []
        for tile in tiles:
            if is_extra(tile):
                leaflet = to_leaflet(tile)
                leaflets[(leaflet.cluster, leaflet.valid_from.isoformat())] = leaflet
            elif not is_standard(tile):
                unusual.append(tile)
    except (FetchError, ParseError) as e:
        log.warning("%s: %s", store.id, e)
        return StoreResult(store=store, error=str(e))
    ordered = sorted(leaflets.values(), key=lambda lf: (lf.valid_from, lf.cluster))
    return StoreResult(store=store, leaflets=tuple(ordered), unusual=tuple(unusual))


def scan(
    fetcher: Fetcher,
    stores: list[Store],
    *,
    workers: int = MAX_WORKERS,
    full_scan: bool,
    list_errors: tuple[str, ...] = (),
) -> ScanResult:
    workers = max(1, min(workers, MAX_WORKERS))
    log.info("Scanning %d stores with %d workers ...", len(stores), workers)
    t0 = time.monotonic()
    with ThreadPoolExecutor(workers) as pool:
        results = tuple(pool.map(lambda s: scan_store(fetcher, s), stores))
    return ScanResult(
        results=results,
        full_scan=full_scan,
        list_errors=list_errors,
        duration_s=time.monotonic() - t0,
    )
