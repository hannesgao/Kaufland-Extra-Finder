"""Build the frontend's `extra.json` and decide whether a scan is trustworthy."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

from kef_scraper.models import Leaflet, Offer, ScanResult, SpecialDay, Store
from kef_scraper.pdfcheck import PdfCheck, matches_store

SCHEMA_VERSION = 1
MIN_STORES = 700
MAX_FAILURE_RATE = 0.05


def build_extra(
    result: ScanResult,
    generated_at: dt.datetime,
    pdf_checks: Mapping[str, PdfCheck] | None = None,
) -> dict[str, Any]:
    """Stores with at least one Extra leaflet, nested per store, plus PDF clusters.

    With `pdf_checks`, each leaflet gets `pdf_store` (the PDF's "NUR IN" line) and
    `pdf_store_match` (whether that line names this store). Both are omitted when unknown.
    """
    pdf_checks = pdf_checks or {}
    if generated_at.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    today = generated_at.date()
    clusters: defaultdict[str, set[str]] = defaultdict(set)
    stores = []
    for r in sorted(result.extra, key=lambda r: r.store.id):
        s = r.store
        for lf in r.leaflets:
            clusters[lf.cluster].add(s.id)
        leaflets = [_leaflet(lf, s, pdf_checks.get(lf.cluster)) for lf in r.leaflets]
        stores.append(_store_record(s, today, leaflets))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "store_count": result.store_count,
        "failed_count": result.failed_count,
        "stores": stores,
        "clusters": {k: sorted(v) for k, v in sorted(clusters.items())},
    }


def _store_record(s: Store, today: dt.date, leaflets: list[dict[str, Any]]) -> dict[str, Any]:
    store: dict[str, Any] = {
        "id": s.id,
        "name": s.name,
        "plz": s.plz,
        "city": s.city,
        "street": s.street,
        "lat": s.lat,
        "lng": s.lng,
        **({"url": s.url} if s.url else {}),
        "leaflets": leaflets,
    }
    special = [_special_day(d) for d in s.special_days if d.date >= today]
    if special:  # optional field, omitted when empty
        store["special_days"] = special
    return store


# What a past leaflet keeps: its links are dead once Kaufland removes the leaflet.
PAST_FIELDS = ("valid_from", "valid_to", "pdf_store", "pdf_store_match")


def with_history(
    extra: dict[str, Any],
    result: ScanResult,
    previous_stores: Iterable[Mapping[str, Any]],
    history_since: str,
) -> dict[str, Any]:
    """`extra` plus every store that had an Extra leaflet before, with its past leaflets.

    `previous_stores` are the store records of earlier runs, oldest first (the previous
    `extra.json`, and once the snapshots before it). A leaflet of an earlier run that this scan
    no longer lists, or that has expired, becomes a `past` entry (newest first). A store whose
    page could not be read keeps the leaflets that are still valid. A store that is no longer in
    Kaufland's store list (closed) is dropped after a full scan.
    """
    today = dt.date.fromisoformat(extra["generated_at"][:10]).isoformat()
    scanned = {r.store.id: r for r in result.results}
    failed = {r.store.id for r in result.failures}
    current = {s["id"]: s for s in extra["stores"]}
    clusters = {k: set(v) for k, v in extra["clusters"].items()}
    earlier: dict[str, Mapping[str, Any]] = {}
    past: defaultdict[str, dict[tuple[str, str], dict[str, Any]]] = defaultdict(dict)
    carried: defaultdict[str, dict[tuple[str, str], dict[str, Any]]] = defaultdict(dict)
    for prev in previous_stores:
        sid = prev["id"]
        earlier[sid] = prev  # the latest record wins
        for p in prev.get("past", []):
            past[sid][(p["valid_from"], p["valid_to"])] = {k: p[k] for k in PAST_FIELDS if k in p}
        for lf in prev.get("leaflets", []):
            key = (lf["valid_from"], lf["valid_to"])
            past[sid][key] = {k: lf[k] for k in PAST_FIELDS if k in lf}
            if lf["valid_to"] >= today:
                carried[sid][key] = dict(lf)
    stores = []
    for sid in sorted(current.keys() | earlier.keys()):
        if sid in current:
            record = dict(current[sid])
        elif sid in scanned:
            record = _store_record(scanned[sid].store, dt.date.fromisoformat(today), [])
        elif not result.full_scan:
            record = {k: v for k, v in earlier[sid].items() if k != "past"}
            record["leaflets"] = []
        else:
            continue  # no longer in the store list
        # Not looked at (failed, or outside --stores): its leaflets may well still be listed.
        unknown = sid in failed or sid not in scanned
        if unknown and not record["leaflets"]:
            record["leaflets"] = list(carried[sid].values())
            for lf in record["leaflets"]:
                clusters.setdefault(lf["cluster"], set()).add(sid)
        listed = {(lf["valid_from"], lf["valid_to"]) for lf in record["leaflets"]}
        entries = [p for key, p in past[sid].items() if key not in listed]
        if entries:
            record["past"] = sorted(entries, key=lambda p: p["valid_from"], reverse=True)
        stores.append(record)
    return {
        **extra,
        "history_since": history_since,
        "stores": stores,
        "clusters": {k: sorted(v) for k, v in sorted(clusters.items())},
    }


def _leaflet(lf: Leaflet, store: Store, check: PdfCheck | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "valid_from": lf.valid_from.isoformat(),
        "valid_to": lf.valid_to.isoformat(),
        "cluster": lf.cluster,
        "viewer": lf.viewer,
        "pdf": lf.pdf,
    }
    if check and check.store_line:
        out["pdf_store"] = check.store_line
        out["pdf_store_match"] = matches_store(check.store_line, store)
    return out


def _special_day(day: SpecialDay) -> dict[str, Any]:
    if day.closed:
        return {"date": day.date.isoformat(), "closed": True}
    return {"date": day.date.isoformat(), "open": day.opens, "close": day.closes}


def sanity_problems(
    result: ScanResult,
    *,
    min_stores: int = MIN_STORES,
    max_failure_rate: float = MAX_FAILURE_RATE,
) -> list[str]:
    """Reasons to distrust this scan. An empty list means the output may be published."""
    problems = []
    if result.full_scan and result.store_count < min_stores:
        problems.append(
            f"only {result.store_count} stores in the store list (minimum {min_stores})"
        )
    if result.failure_rate > max_failure_rate:
        problems.append(
            f"{result.failed_count}/{result.store_count} stores failed "
            f"({result.failure_rate:.1%} > {max_failure_rate:.0%})"
        )
    return problems


CARDS_SCHEMA_VERSION = 1


def offer_key(offer: Offer) -> str:
    """Stable id of an offer across stores: article number and first day it is shown."""
    return f"{offer.kl_nr}|{offer.shown_from.isoformat()}"


def _card_offer(offer: Offer) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kl_nr": offer.kl_nr,
        "title": offer.title,
        "subtitle": offer.subtitle,
        "price": offer.price,
        "unit": offer.unit,
        "shown_from": offer.shown_from.isoformat(),
        "shown_to": offer.shown_to.isoformat(),
        "category": offer.category,
        "week": offer.week,
    }
    if offer.sales_from and offer.sales_to:  # announced offers only
        out["sales_from"] = offer.sales_from.isoformat()
        out["sales_to"] = offer.sales_to.isoformat()
    if offer.thumbnail:
        out["thumbnail"] = offer.thumbnail
    if offer.thumbnail_2x:
        out["thumbnail_2x"] = offer.thumbnail_2x
    return {k: v for k, v in out.items() if v is not None}


def build_cards(
    result: ScanResult, generated_at: dt.datetime, keywords: tuple[str, ...]
) -> dict[str, Any]:
    """Trading-card offers (`cards.json`): each offer once, and the stores that have them."""
    if generated_at.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    products: dict[str, dict[str, Any]] = {}
    stores = []
    for r in sorted(result.card_stores, key=lambda r: r.store.id):
        keys = []
        for offer in r.cards:
            key = offer_key(offer)
            products.setdefault(key, _card_offer(offer))
            keys.append(key)
        s = r.store
        stores.append(
            {
                "id": s.id,
                "name": s.name,
                "plz": s.plz,
                "city": s.city,
                "street": s.street,
                "lat": s.lat,
                "lng": s.lng,
                **({"url": s.url} if s.url else {}),
                "products": sorted(set(keys)),
            }
        )
    scanned = [r for r in result.results if r.offers_scanned and not r.offers_error]
    return {
        "schema_version": CARDS_SCHEMA_VERSION,
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "keywords": list(keywords),
        # Stores whose offer overview was read (stores without offer data included).
        "store_count": len(scanned),
        "products": dict(sorted(products.items())),
        "stores": stores,
    }


def offers_problems(result: ScanResult, *, max_failure_rate: float = MAX_FAILURE_RATE) -> list[str]:
    """Reasons not to publish `cards.json`. A few closed stores without offer data are normal;
    many of them mean the page has changed."""
    total = sum(1 for r in result.results if r.offers_scanned)
    if not total:
        return ["no offer overview was scanned"]
    problems = []
    for label, count in (
        ("offer overviews failed", len(result.offers_failures)),
        ("offer overviews had no offer data", len(result.no_offer_pages)),
    ):
        if count / total > max_failure_rate:
            problems.append(
                f"{count}/{total} {label} ({count / total:.1%} > {max_failure_rate:.0%})"
            )
    return problems
