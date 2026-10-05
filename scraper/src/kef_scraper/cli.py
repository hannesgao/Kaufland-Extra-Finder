"""Command line entry point: `kef-scrape`."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from kef_scraper.build import MAX_FAILURE_RATE, MIN_STORES, build_extra, sanity_problems
from kef_scraper.fetch import MAX_WORKERS, Fetcher, FetchError, HttpFetcher
from kef_scraper.output import (
    build_snapshot,
    diff_extra,
    dump_json,
    read_history,
    read_pdf_checks,
    render_history,
    render_pdf_checks,
    render_report,
    render_summary_md,
    update_history,
    write_text_atomic,
)
from kef_scraper.parse import ParseError, parse_stores
from kef_scraper.scan import PDF_DELAY_S, check_pdfs, scan

log = logging.getLogger("kef_scraper")

TZ = ZoneInfo("Europe/Berlin")
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SANITY = 2


def _workers(value: str) -> int:
    n = int(value)
    if not 1 <= n <= MAX_WORKERS:
        raise argparse.ArgumentTypeError(f"must be between 1 and {MAX_WORKERS}")
    return n


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="kef-scrape",
        description="Find Kaufland stores that currently publish an Extra-Angebote leaflet.",
    )
    p.add_argument(
        "--out", type=Path, default=Path("data"), help="output directory (default: data)"
    )
    p.add_argument(
        "--previous",
        type=Path,
        help="directory with the previous run's extra.json and history.csv (default: --out)",
    )
    p.add_argument("--stores", help="comma-separated store ids to scan instead of all stores")
    p.add_argument(
        "--workers", type=_workers, default=MAX_WORKERS, help="concurrent requests (1-4)"
    )
    p.add_argument("--delay", type=float, default=0.25, help="seconds to wait before each request")
    p.add_argument("--summary", type=Path, help="append a Markdown summary to this file")
    p.add_argument(
        "--skip-pdf-check",
        action="store_true",
        help="do not download new Extra PDFs to check which store they name",
    )
    p.add_argument("--pdf-delay", type=float, default=PDF_DELAY_S, help=argparse.SUPPRESS)
    p.add_argument("--min-stores", type=int, default=MIN_STORES, help=argparse.SUPPRESS)
    p.add_argument(
        "--max-failure-rate", type=float, default=MAX_FAILURE_RATE, help=argparse.SUPPRESS
    )
    return p


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("ignoring unreadable %s: %s", path, e)
        return None
    return data if isinstance(data, dict) else None


def main(
    argv: Sequence[str] | None = None,
    *,
    fetcher: Fetcher | None = None,
    now: dt.datetime | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    fetcher = fetcher or HttpFetcher(delay=args.delay)
    out: Path = args.out
    previous_dir: Path = args.previous or out

    try:
        fetcher.preflight()
        stores, list_errors = parse_stores(fetcher.store_list())
    except (FetchError, ParseError) as e:
        log.error("cannot load store list: %s", e)
        return EXIT_ERROR

    full_scan = not args.stores
    if args.stores:
        wanted = {s.strip() for s in args.stores.split(",") if s.strip()}
        unknown = wanted - {s.id for s in stores}
        if unknown:
            log.error("unknown store ids: %s", ", ".join(sorted(unknown)))
            return EXIT_ERROR
        stores = [s for s in stores if s.id in wanted]
        list_errors = []

    result = scan(
        fetcher, stores, workers=args.workers, full_scan=full_scan, list_errors=tuple(list_errors)
    )
    now = now or dt.datetime.now(TZ)
    pdf_cache = read_pdf_checks(previous_dir / "pdf_checks.json")
    if args.skip_pdf_check:
        pdf_checks = pdf_cache
    else:
        pdf_checks = check_pdfs(fetcher, result, pdf_cache, delay=args.pdf_delay)
    extra = build_extra(result, now, pdf_checks)
    diff = diff_extra(_load_json(previous_dir / "extra.json"), extra)
    problems = sanity_problems(
        result, min_stores=args.min_stores, max_failure_rate=args.max_failure_rate
    )

    sys.stdout.write(render_report(result, extra, diff))
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        with args.summary.open("a", encoding="utf-8") as f:
            f.write(render_summary_md(result, extra, diff, problems))

    if problems:
        for p in problems:
            log.error("sanity check failed: %s", p)
        log.error("not writing any output; previous data stays in place")
        return EXIT_SANITY

    history = update_history(read_history(previous_dir / "history.csv"), extra, now.date())
    write_text_atomic(
        out / "snapshots" / f"{now.date().isoformat()}.json",
        dump_json(build_snapshot(result, extra, now), indent=1),
    )
    write_text_atomic(out / "history.csv", render_history(history))
    write_text_atomic(out / "pdf_checks.json", render_pdf_checks(pdf_checks))
    write_text_atomic(out / "extra.json", dump_json(extra))
    log.info("wrote %s", out / "extra.json")
    return EXIT_OK


def run() -> None:
    sys.exit(main())


if __name__ == "__main__":
    run()
