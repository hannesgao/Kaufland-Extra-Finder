"""Scan stores concurrently through a `Fetcher` and classify their leaflets."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from kef_scraper.fetch import MAX_WORKERS, Fetcher, FetchError
from kef_scraper.models import Leaflet, Offer, ScanResult, Store, StoreRef, StoreResult, Tile
from kef_scraper.offers import is_card, is_card_like, is_extra_offer, parse_offers
from kef_scraper.parse import ParseError, is_extra, is_standard, parse_store_page, to_leaflet
from kef_scraper.pdfcheck import PdfCheck, check_pdf

log = logging.getLogger(__name__)


def _unknown(ref: StoreRef) -> Store:
    """Stands in for a store whose page could not be read: only its id is known."""
    return Store(id=ref.id, name=ref.slug, plz="", city="", street="", lat=0.0, lng=0.0)


def _leaflets(fetcher: Fetcher, ref: StoreRef) -> StoreResult:
    """Fetch one store's page and classify its leaflets. Sets `error` instead of raising."""
    store = _unknown(ref)
    try:
        store, tiles = parse_store_page(fetcher.store_page(ref.slug), ref)
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


def _with_offers(
    fetcher: Fetcher, result: StoreResult, shared: dict[Offer, Offer] | None = None
) -> StoreResult:
    """Add the store's offers. Independent of the store's leaflets.

    Most offers are identical in hundreds of stores: `shared` keeps one object per distinct offer
    for the whole scan instead of one per store.
    """
    store = result.store
    try:
        offers = parse_offers(fetcher.offers_page(store.id))
    except (FetchError, ParseError) as e:
        log.warning("%s offers: %s", store.id, e)
        return replace(result, offers_scanned=True, offers_error=str(e))
    if offers is None:
        return replace(result, offers_scanned=True, no_offer_page=True)
    if shared is not None:
        offers = [shared.setdefault(o, o) for o in offers]
    return replace(
        result,
        offers_scanned=True,
        cards=tuple(o for o in offers if is_card(o)),
        card_like=tuple(o for o in offers if is_card_like(o)),
        extra_offers=tuple(o for o in offers if is_extra_offer(o)),
        offers=tuple(offers),
    )


def scan_store(
    fetcher: Fetcher,
    ref: StoreRef,
    *,
    with_offers: bool = False,
    shared: dict[Offer, Offer] | None = None,
) -> StoreResult:
    """Fetch and classify one store. Never raises for expected failures; sets errors instead."""
    result = _leaflets(fetcher, ref)
    if not with_offers:
        return result
    if result.store == _unknown(ref):
        # Without the store's page there is no name, address or position to publish offers under.
        return replace(result, offers_scanned=True, offers_error="store page could not be read")
    return _with_offers(fetcher, result, shared)


def scan(
    fetcher: Fetcher,
    stores: list[StoreRef],
    *,
    workers: int = MAX_WORKERS,
    full_scan: bool,
    list_errors: tuple[str, ...] = (),
    with_offers: bool = False,
) -> ScanResult:
    workers = max(1, min(workers, MAX_WORKERS))
    what = "leaflets and offers" if with_offers else "leaflets"
    log.info("Scanning %s of %d stores with %d workers ...", what, len(stores), workers)
    t0 = time.monotonic()
    shared: dict[Offer, Offer] = {}
    with ThreadPoolExecutor(workers) as pool:
        results = tuple(
            pool.map(
                lambda s: scan_store(fetcher, s, with_offers=with_offers, shared=shared), stores
            )
        )
    return ScanResult(
        results=results,
        full_scan=full_scan,
        list_errors=list_errors,
        duration_s=time.monotonic() - t0,
    )


PDF_DELAY_S = 5.0  # between PDF downloads (~6 MB each); the CDN answers 503 when hurried
PDF_RETRY_PAUSE_S = 60.0  # before the second pass over PDFs whose download failed
PDF_RETRY_DELAY_S = 15.0  # between downloads in the second pass (no 503 seen at this pace)


def check_pdfs(
    fetcher: Fetcher,
    result: ScanResult,
    cache: dict[str, PdfCheck],
    *,
    delay: float = PDF_DELAY_S,
    retry_pause: float = PDF_RETRY_PAUSE_S,
    retry_delay: float = PDF_RETRY_DELAY_S,
) -> dict[str, PdfCheck]:
    """Read the store line of every Extra PDF not in `cache`, one download at a time.

    Failed downloads get a second, slower pass after a pause. Returns checks for all PDFs of this
    scan. Errors are reported but not cached, so the PDF is tried again on the next run.
    """
    pdfs = {lf.cluster: lf.pdf for r in result.extra for lf in r.leaflets}
    checks = {cluster: cache[cluster] for cluster in pdfs if cluster in cache}
    todo = sorted(set(pdfs) - set(checks))
    log.info("Checking %d new PDFs (%d cached) ...", len(todo), len(checks))
    failed = _check_each(fetcher, pdfs, todo, checks, delay)
    if failed:
        log.info("Retrying %d failed PDFs in %.0f s ...", len(failed), retry_pause)
        time.sleep(retry_pause)
        failed = _check_each(fetcher, pdfs, failed, checks, retry_delay)
    if failed:
        log.warning("%d PDFs could not be downloaded; retried next run", len(failed))
    return checks


def _check_each(
    fetcher: Fetcher,
    pdfs: dict[str, str],
    clusters: list[str],
    checks: dict[str, PdfCheck],
    delay: float,
) -> list[str]:
    """Check `clusters` one at a time into `checks`; returns those whose download failed."""
    failed = []
    for i, cluster in enumerate(clusters):
        if i:
            time.sleep(delay)
        try:
            checks[cluster] = check_pdf(fetcher.pdf(pdfs[cluster]))
        except FetchError as e:
            log.warning("PDF %s: %s", cluster, e)
            checks[cluster] = PdfCheck(store_line=None, error=str(e))
            failed.append(cluster)
            continue
        if checks[cluster].error:  # unreadable PDF: a second download would not help
            log.warning("PDF %s: %s", cluster, checks[cluster].error)
    return failed
