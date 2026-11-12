"""Snapshots, history.csv, diffs against the previous run, and atomic file writes."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kef_scraper.build import SCHEMA_VERSION, named_clusters
from kef_scraper.models import Offer, ScanResult
from kef_scraper.offers import EXTRA_SECTION
from kef_scraper.pdfcheck import PARSER_VERSION, PdfCheck, offer_in_pdf

HISTORY_FIELDS = (
    "first_seen",
    "store_id",
    "name",
    "plz",
    "valid_from",
    "valid_to",
    "cluster",
    "cluster_size",
)


def write_text_atomic(path: Path, text: str) -> None:
    """Write via a temp file + rename so readers never see a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        Path(tmp).chmod(0o644)  # mkstemp creates 0600; outputs are published as-is
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def dump_json(obj: object, *, indent: int = 2) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent) + "\n"


def build_snapshot(
    result: ScanResult, extra: dict[str, Any], scanned_at: dt.datetime
) -> dict[str, Any]:
    """Everything worth keeping from one scan, including failures and non-standard leaflets."""
    failures = [{"id": r.store.id, "error": r.error} for r in result.failures]
    failures += [{"id": None, "error": e} for e in result.list_errors]
    unusual = [
        {
            "id": r.store.id,
            "name": r.store.name,
            "plz": r.store.plz,
            "subcategory": t.subcategory,
            "title": t.title,
            "start": t.start,
            "pdf": t.pdf,
            "viewer": t.viewer,
        }
        for r in sorted(result.results, key=lambda r: r.store.id)
        for t in r.unusual
    ]
    return {
        "scanned_at": scanned_at.isoformat(timespec="seconds"),
        "duration_s": round(result.duration_s, 1),
        "full_scan": result.full_scan,
        "store_count": result.store_count,
        "failed_count": result.failed_count,
        "failures": failures,
        "extra": extra["stores"],
        "clusters": extra["clusters"],
        "unusual": unusual,
    }


def read_pdf_checks(path: Path) -> dict[str, PdfCheck]:
    """Cached store lines per PDF id (`pdf_checks.json`); unreadable files are ignored."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict) or raw.get("parser") != PARSER_VERSION:
        return {}  # older parser: recompute everything
    checks = raw.get("checks")
    if not isinstance(checks, dict):
        return {}
    return {
        k: PdfCheck(
            store_line=v["store_line"], text=v["text"] if isinstance(v.get("text"), str) else None
        )
        for k, v in checks.items()
        if isinstance(v, dict) and isinstance(v.get("store_line"), str)
    }


def render_pdf_checks(checks: dict[str, PdfCheck]) -> str:
    """Only successful checks are cached (failed downloads are retried next run)."""
    ok = {
        k: {"store_line": c.store_line} | ({"text": c.text} if c.text else {})
        for k, c in sorted(checks.items())
        if c.store_line
    }
    return dump_json({"parser": PARSER_VERSION, "checks": ok})


def pdf_mismatches(extra: dict[str, Any]) -> list[str]:
    """One line per store whose Extra PDF names a different store."""
    return [
        f"{s['name']} ({s['plz']}): PDF says NUR IN {lf['pdf_store']}"
        for s in extra["stores"]
        for lf in s["leaflets"]
        if lf.get("pdf_store_match") is False
    ]


def read_history(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != HISTORY_FIELDS:
            raise ValueError(f"{path}: unexpected columns {reader.fieldnames}")
        return list(reader)


def update_history(
    rows: list[dict[str, str]], extra: dict[str, Any], today: dt.date
) -> list[dict[str, str]]:
    """Append one row per store x leaflet that has not been seen before."""
    seen = {(r["store_id"], r["cluster"], r["valid_from"]) for r in rows}
    sizes = {k: len(v) for k, v in extra["clusters"].items()}
    new = list(rows)
    for s in extra["stores"]:
        for lf in s["leaflets"]:
            key = (s["id"], lf["cluster"], lf["valid_from"])
            if key in seen:
                continue
            seen.add(key)
            new.append(
                {
                    "first_seen": today.isoformat(),
                    "store_id": s["id"],
                    "name": s["name"],
                    "plz": s["plz"],
                    "valid_from": lf["valid_from"],
                    "valid_to": lf["valid_to"],
                    "cluster": lf["cluster"],
                    "cluster_size": str(sizes[lf["cluster"]]),
                }
            )
    return new


def render_history(rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=HISTORY_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


@dataclass(frozen=True, slots=True)
class LeafletChange:
    store_id: str
    store: str
    valid_from: str
    valid_to: str
    cluster: str


@dataclass(frozen=True, slots=True)
class Diff:
    previous_generated_at: str | None
    added: tuple[LeafletChange, ...]
    removed: tuple[LeafletChange, ...]
    # Stores that newly have / no longer have any Extra leaflet.
    stores_added: frozenset[str]
    stores_removed: frozenset[str]


def _changes(extra: dict[str, Any]) -> dict[tuple[str, str, str], LeafletChange]:
    out = {}
    for s in extra.get("stores", []):
        for lf in s["leaflets"]:
            change = LeafletChange(
                store_id=s["id"],
                store=f"{s['name']} ({s['plz']})",
                valid_from=lf["valid_from"],
                valid_to=lf["valid_to"],
                cluster=lf["cluster"],
            )
            out[(s["id"], lf["cluster"], lf["valid_from"])] = change
    return out


def diff_extra(previous: dict[str, Any] | None, current: dict[str, Any]) -> Diff | None:
    """Leaflet-level diff. None when there is no comparable previous run."""
    if previous is None or previous.get("schema_version") != SCHEMA_VERSION:
        return None
    before, after = _changes(previous), _changes(current)
    # Stores with a listed leaflet; stores without one stay in extra.json (history).
    stores_before = {s["id"] for s in previous.get("stores", []) if s.get("leaflets")}
    stores_after = {s["id"] for s in current["stores"] if s["leaflets"]}
    return Diff(
        previous_generated_at=previous.get("generated_at"),
        added=tuple(after[k] for k in sorted(after.keys() - before.keys())),
        removed=tuple(before[k] for k in sorted(before.keys() - after.keys())),
        stores_added=frozenset(stores_after - stores_before),
        stores_removed=frozenset(stores_before - stores_after),
    )


def _summary_lines(
    result: ScanResult, extra: dict[str, Any], diff: Diff | None
) -> tuple[str, str, list[str]]:
    """(headline, diff status line, one line per changed leaflet)."""
    leaflet_count = sum(len(s["leaflets"]) for s in extra["stores"])
    with_leaflets = sum(1 for s in extra["stores"] if s["leaflets"])
    without = len(extra["stores"]) - with_leaflets
    headline = (
        f"{with_leaflets} stores with {leaflet_count} Extra leaflets "
        f"({len(extra['clusters'])} distinct PDFs)"
        + (f", {without} more without a current one" if without else "")
        + f"; scanned {result.store_count}, failed {result.failed_count}, "
        f"{result.duration_s:.0f}s"
    )
    if diff is None:
        return headline, "No comparable previous extra.json; diff skipped.", []
    status = (
        f"vs {diff.previous_generated_at}: +{len(diff.added)} / -{len(diff.removed)} leaflets, "
        f"+{len(diff.stores_added)} / -{len(diff.stores_removed)} stores"
    )
    changes = [f"+ {c.store} {c.valid_from}..{c.valid_to} {c.cluster}" for c in diff.added]
    changes += [f"- {c.store} {c.valid_from}..{c.valid_to} {c.cluster}" for c in diff.removed]
    return headline, status, changes


def cards_lines(result: ScanResult, cards: dict[str, Any] | None, problems: list[str]) -> list[str]:
    """Report lines about trading-card offers; empty when no offer overview was scanned."""
    if not result.offers_scanned:
        return []
    scanned = sum(1 for r in result.results if r.offers_scanned)
    out = [
        f"Offer overviews: {scanned} scanned, {len(result.offers_failures)} failed, "
        f"{len(result.no_offer_pages)} without offer data"
    ]
    if problems or cards is None:
        out += [f"cards.json NOT updated: {p}" for p in problems]
        return out
    counts: dict[str, int] = {}
    for s in cards["stores"]:
        for key in s["products"]:
            counts[key] = counts.get(key, 0) + 1
    out.append(
        f"Trading-card offers ({', '.join(cards['keywords'])}): "
        f"{len(cards['products'])} in {len(cards['stores'])} stores"
    )
    for key, p in cards["products"].items():
        sale = f", sale {p['sales_from']}..{p['sales_to']}" if "sales_from" in p else ""
        out.append(
            f"  {p['title']} {p['subtitle']} ({p['kl_nr']}) {p.get('price', '?')}: "
            f"shown {p['shown_from']}..{p['shown_to']}{sale}, {counts.get(key, 0)} stores"
        )
    like: dict[tuple[str, str, str], int] = {}
    for r in result.results:
        for o in r.card_like:
            k = (o.kl_nr, o.title, o.subtitle)
            like[k] = like.get(k, 0) + 1
    if like:
        out.append("Possible trading cards not in cards.json (check CARD_KEYWORDS in offers.py):")
        out += [f"  {t} {st} ({k}): {n} stores" for (k, t, st), n in sorted(like.items())]
    return out


_FOUND = {
    (True, True): "title and price",
    (True, False): "title only",
    (False, True): "price only",
    (False, False): "neither",
}
BASELINE_SHARE = 0.9  # an "Extra offer" in this share of all stores is not an Extra offer
_TOP_EXTRA_OFFERS = 40


def extra_offer_lines(
    result: ScanResult,
    extra: dict[str, Any],
    pdf_checks: Mapping[str, PdfCheck] | None = None,
    deals: dict[str, Any] | None = None,
) -> list[str]:
    """Report lines about the section "Extra-Angebote" of the offer overviews and `deals.json`.

    Compares stores named by their Extra PDF with the other stores, and the offers with the text
    of the store's PDF. Empty when no offer overview was scanned.
    """
    scanned = [r for r in result.results if r.offers_scanned and not r.offers_error]
    scanned = [r for r in scanned if not r.no_offer_page]
    if not scanned:
        return []
    pdf_checks = pdf_checks or {}
    named = named_clusters(extra)
    listed = {s["id"] for s in extra["stores"] if s["leaflets"]} - named.keys()
    groups: dict[str, list[int]] = {"named by their PDF": [], "other Extra": [], "no Extra": []}
    stores_of: dict[str, set[str]] = {}
    sample: dict[str, Offer] = {}
    for r in scanned:
        sid = r.store.id
        group = "no Extra" if sid not in named and sid not in listed else "other Extra"
        groups["named by their PDF" if sid in named else group].append(len(r.extra_offers))
        for o in r.extra_offers:
            stores_of.setdefault(o.kl_nr, set()).add(sid)
            sample.setdefault(o.kl_nr, o)
    out = [f'Extra offers (section "{EXTRA_SECTION}" of the offer overview):']
    if deals is not None:
        unconfirmed = sum(len(s.get("unconfirmed", ())) for s in deals["stores"])
        out.append(
            f"  deals.json: {len(deals['products'])} offers in {len(deals['stores'])} stores; "
            f"{unconfirmed} listed without their title in the PDF (no other store has them), "
            f"{deals['left_out']} left out (not in the PDF, other stores have them)"
        )
    for group, counts in groups.items():
        if counts:
            counts.sort()
            out.append(
                f"  {len(counts)} stores {group}: {counts[0]} / {counts[len(counts) // 2]} / "
                f"{counts[-1]} offers (min / median / max)"
            )
    baseline = {k for k, v in stores_of.items() if len(v) >= BASELINE_SHARE * len(scanned)}
    products = {k: v & named.keys() for k, v in stores_of.items() if k not in baseline}
    products = {k: v for k, v in products.items() if v}
    common = sum(1 for v in products.values() if 2 * len(v) >= len(named))
    out.append(
        f"  {len(baseline)} offers in at least {BASELINE_SHARE:.0%} of all stores (not Extra); "
        f"{len(products)} others in named stores, {common} of them in at least half"
    )
    # Cross-check with the PDFs: per offer and named store, are title and price in the PDF text?
    tally = dict.fromkeys([*_FOUND.values(), "no PDF text"], 0)
    in_pdf: dict[str, list[int]] = {}  # kl_nr -> [title found, checked]
    base_found = base_checked = 0
    for r in scanned:
        if r.store.id not in named:
            continue
        checks = (pdf_checks.get(c) for c in named[r.store.id])
        texts = [c.text for c in checks if c and c.text]
        for o in r.extra_offers:
            if not texts:
                tally["no PDF text"] += o.kl_nr not in baseline
                continue
            hits = [offer_in_pdf(t, o.title, o.price) for t in texts]
            title, price = any(h[0] for h in hits), any(h[1] for h in hits)
            if o.kl_nr in baseline:
                base_found += title
                base_checked += 1
                continue
            tally[_FOUND[title, price]] += 1
            pair = in_pdf.setdefault(o.kl_nr, [0, 0])
            pair[0] += title
            pair[1] += 1
    out.append("  In the PDF of the store: " + ", ".join(f"{k} {v}" for k, v in tally.items()))
    out.append(f"  Baseline offers with their title in the PDF: {base_found} of {base_checked}")
    ranked = sorted(products, key=lambda k: (-len(products[k]), sample[k].title, k))
    for k in ranked[:_TOP_EXTRA_OFFERS]:
        o = sample[k]
        found, checked = in_pdf.get(k, [0, 0])
        old = f" (was {o.old_price})" if o.old_price else ""
        out.append(
            f"  {len(products[k]):3} named, {len(stores_of[k] - named.keys()):3} other, "
            f"title in PDF {found}/{checked}: {o.title} {o.subtitle} ({k}) "
            f"{o.price or '?'}{old} {o.shown_from}..{o.shown_to}"
        )
    if len(ranked) > _TOP_EXTRA_OFFERS:
        out.append(f"  ... and {len(ranked) - _TOP_EXTRA_OFFERS} more")
    return out


def render_report(
    result: ScanResult,
    extra: dict[str, Any],
    diff: Diff | None,
    cards: dict[str, Any] | None = None,
    offers_problems: list[str] | None = None,
    pdf_checks: Mapping[str, PdfCheck] | None = None,
    deals: dict[str, Any] | None = None,
) -> str:
    headline, status, changes = _summary_lines(result, extra, diff)
    unusual = [
        f"  {r.store.name} ({r.store.plz}): {t.subcategory} {t.title}"
        for r in result.results
        for t in r.unusual
    ]
    mismatches = pdf_mismatches(extra)
    out = [headline, status, *changes]
    if mismatches:
        out += ["", "PDF names a different store:", *(f"  {m}" for m in mismatches)]
    if unusual:
        out += ["", "Other non-standard leaflets:", *unusual]
    card_lines = cards_lines(result, cards, offers_problems or [])
    if card_lines:
        out += ["", *card_lines]
    extra_lines = extra_offer_lines(result, extra, pdf_checks, deals)
    if extra_lines:
        out += ["", *extra_lines]
    if result.failed_count:
        out += ["", "Failures:", *(f"  {r.store.id}: {r.error}" for r in result.failures)]
        out += [f"  store list: {e}" for e in result.list_errors]
    return "\n".join(out) + "\n"


def render_summary_md(
    result: ScanResult,
    extra: dict[str, Any],
    diff: Diff | None,
    problems: list[str],
    cards: dict[str, Any] | None = None,
    offers_problems: list[str] | None = None,
    pdf_checks: Mapping[str, PdfCheck] | None = None,
    deals: dict[str, Any] | None = None,
) -> str:
    """Markdown for $GITHUB_STEP_SUMMARY."""
    headline, status, changes = _summary_lines(result, extra, diff)
    title = "❌ Scan rejected" if problems else "✅ Scan accepted"
    out = [f"## {title}", "", headline]
    if problems:
        out += ["", *(f"- **{p}**" for p in problems)]
    out += ["", status]
    if changes:
        out += ["", "```diff", *changes, "```"]
    mismatches = pdf_mismatches(extra)
    if mismatches:
        out += ["", f"**PDF names a different store ({len(mismatches)}):**", ""]
        out += [f"- {m}" for m in mismatches]
    card_lines = cards_lines(result, cards, offers_problems or [])
    if card_lines:
        title = "❌ Trading cards not updated" if offers_problems else "🃏 Trading cards"
        out += ["", f"### {title}", "", "```", *card_lines, "```"]
    extra_lines = extra_offer_lines(result, extra, pdf_checks, deals)
    if extra_lines:
        out += ["", "### 🛒 Extra offers", "", "```", *extra_lines, "```"]
    return "\n".join(out) + "\n"
