"""Snapshots, history.csv, diffs against the previous run, and atomic file writes."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kef_scraper.build import SCHEMA_VERSION
from kef_scraper.models import ScanResult
from kef_scraper.pdfcheck import PARSER_VERSION, PdfCheck

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
        k: PdfCheck(store_line=v["store_line"])
        for k, v in checks.items()
        if isinstance(v, dict) and isinstance(v.get("store_line"), str)
    }


def render_pdf_checks(checks: dict[str, PdfCheck]) -> str:
    """Only successful checks are cached (failed downloads are retried next run)."""
    ok = {k: {"store_line": c.store_line} for k, c in sorted(checks.items()) if c.store_line}
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
    stores_before = {s["id"] for s in previous.get("stores", [])}
    stores_after = {s["id"] for s in current["stores"]}
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
    headline = (
        f"{len(extra['stores'])} stores with {leaflet_count} Extra leaflets "
        f"({len(extra['clusters'])} distinct PDFs); scanned {result.store_count}, "
        f"failed {result.failed_count}, {result.duration_s:.0f}s"
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


def render_report(result: ScanResult, extra: dict[str, Any], diff: Diff | None) -> str:
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
    if result.failed_count:
        out += ["", "Failures:", *(f"  {r.store.id}: {r.error}" for r in result.failures)]
        out += [f"  store list: {e}" for e in result.list_errors]
    return "\n".join(out) + "\n"


def render_summary_md(
    result: ScanResult, extra: dict[str, Any], diff: Diff | None, problems: list[str]
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
    return "\n".join(out) + "\n"
