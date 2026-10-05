"""Build the frontend's `extra.json` and decide whether a scan is trustworthy."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any

from kef_scraper.models import ScanResult, SpecialDay

SCHEMA_VERSION = 1
MIN_STORES = 700
MAX_FAILURE_RATE = 0.05


def build_extra(result: ScanResult, generated_at: dt.datetime) -> dict[str, Any]:
    """Stores with at least one Extra leaflet, nested per store, plus PDF clusters."""
    if generated_at.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    today = generated_at.date()
    clusters: defaultdict[str, set[str]] = defaultdict(set)
    stores = []
    for r in sorted(result.extra, key=lambda r: r.store.id):
        s = r.store
        for lf in r.leaflets:
            clusters[lf.cluster].add(s.id)
        store: dict[str, Any] = {
            "id": s.id,
            "name": s.name,
            "plz": s.plz,
            "city": s.city,
            "street": s.street,
            "lat": s.lat,
            "lng": s.lng,
            "leaflets": [
                {
                    "valid_from": lf.valid_from.isoformat(),
                    "valid_to": lf.valid_to.isoformat(),
                    "cluster": lf.cluster,
                    "viewer": lf.viewer,
                    "pdf": lf.pdf,
                }
                for lf in r.leaflets
            ],
        }
        special = [_special_day(d) for d in s.special_days if d.date >= today]
        if special:  # optional field, omitted when empty
            store["special_days"] = special
        stores.append(store)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "store_count": result.store_count,
        "failed_count": result.failed_count,
        "stores": stores,
        "clusters": {k: sorted(v) for k, v in sorted(clusters.items())},
    }


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
