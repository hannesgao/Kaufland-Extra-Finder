#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Build `web/public/plz.json` (PLZ -> [lat, lng]) from the GeoNames postal code dump for Germany.

GeoNames lists one row per postal code *and place*, so a PLZ covering several villages (or a
company PLZ with addresses in several cities) has several rows. Each PLZ is reduced to the
median latitude/longitude of its rows, which is robust against a few far-away rows.

Data: GeoNames (https://www.geonames.org/), CC BY 4.0.

Usage:
  uv run scripts/build_plz.py                     # download DE.zip, write web/public/plz.json
  uv run scripts/build_plz.py --source DE.zip     # use a local DE.zip or DE.txt instead
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import os
import re
import statistics
import sys
import tempfile
import urllib.request
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

SOURCE_URL = "https://download.geonames.org/export/zip/DE.zip"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "plz.json"
USER_AGENT = (
    "kaufland-extra-finder build_plz.py (+https://github.com/hannesgao/Kaufland-Extra-Finder)"
)

DECIMALS = 4
MIN_PLZ = 8000  # Germany has ~8,200 delivery PLZ plus company PLZ; fewer means a broken dump.
MAX_INVALID_SHARE = 0.01
SPREAD_REPORT_KM = 25.0
GZIP_BUDGET = 100_000

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SANITY = 2

_PLZ_RE = re.compile(r"\d{5}")
# Same generous bounding box as the scraper.
_LAT_RANGE = (47.0, 55.5)
_LNG_RANGE = (5.5, 15.5)

Point = tuple[float, float]


class SourceError(RuntimeError):
    """The GeoNames dump could not be downloaded or opened."""


@dataclass(frozen=True, slots=True)
class Parsed:
    points: dict[str, list[Point]]
    row_count: int
    errors: list[str]


def parse_rows(lines: Iterable[str]) -> Parsed:
    """Parse GeoNames' tab-separated rows; invalid rows are collected, not fatal."""
    points: dict[str, list[Point]] = {}
    errors: list[str] = []
    row_count = 0
    for lineno, row in enumerate(csv.reader(lines, delimiter="\t", quoting=csv.QUOTE_NONE), 1):
        if not row:
            continue
        row_count += 1
        if len(row) < 11:
            errors.append(f"line {lineno}: expected at least 11 columns, got {len(row)}")
            continue
        plz = row[1]
        if not _PLZ_RE.fullmatch(plz):
            errors.append(f"line {lineno}: invalid PLZ {plz!r}")
            continue
        try:
            lat, lng = float(row[9]), float(row[10])
        except ValueError:
            errors.append(f"line {lineno}: invalid coordinates for {plz}")
            continue
        if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LNG_RANGE[0] <= lng <= _LNG_RANGE[1]):
            errors.append(f"line {lineno}: coordinates {lat},{lng} for {plz} outside Germany")
            continue
        points.setdefault(plz, []).append((lat, lng))
    return Parsed(points=points, row_count=row_count, errors=errors)


def aggregate(points: dict[str, list[Point]], decimals: int = DECIMALS) -> dict[str, Point]:
    """One coordinate per PLZ: median latitude and median longitude of all its rows."""
    return {
        plz: (
            round(statistics.median(p[0] for p in pts), decimals),
            round(statistics.median(p[1] for p in pts), decimals),
        )
        for plz, pts in sorted(points.items())
    }


def distance_km(a: Point, b: Point) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def spread_km(pts: Sequence[Point]) -> float:
    """Largest distance between any two rows of one PLZ."""
    return max((distance_km(a, b) for i, a in enumerate(pts) for b in pts[i + 1 :]), default=0.0)


def render(plz: dict[str, Point]) -> str:
    """JSON object with one PLZ per line, so regenerations produce readable diffs."""
    lines = [f"{json.dumps(k)}:[{lat},{lng}]" for k, (lat, lng) in sorted(plz.items())]
    return "{\n" + ",\n".join(lines) + "\n}\n"


def read_source(source: str) -> str:
    """Return the text of DE.txt from a URL, a local DE.zip, or a local DE.txt."""
    if source.startswith(("https://", "http://")):
        req = urllib.request.Request(source, headers={"User-Agent": USER_AGENT})  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                data: bytes = resp.read()
        except OSError as e:
            raise SourceError(f"download of {source} failed: {e}") from e
        return _text_from_zip(data, source)
    path = Path(source)
    try:
        data = path.read_bytes()
    except OSError as e:
        raise SourceError(f"cannot read {path}: {e}") from e
    if path.suffix.lower() == ".zip":
        return _text_from_zip(data, source)
    return data.decode("utf-8")


def _text_from_zip(data: bytes, source: str) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return zf.read("DE.txt").decode("utf-8")
    except (zipfile.BadZipFile, KeyError) as e:
        raise SourceError(f"{source}: not a GeoNames DE.zip ({e})") from e


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        Path(tmp).chmod(0o644)  # mkstemp creates 0600; the file is served publicly
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    p.add_argument(
        "--source", default=SOURCE_URL, help=f"URL or local path (default: {SOURCE_URL})"
    )
    p.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help="output file (default: %(default)s)"
    )
    p.add_argument("--min-plz", type=int, default=MIN_PLZ, help=argparse.SUPPRESS)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        text = read_source(args.source)
    except SourceError as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_ERROR

    parsed = parse_rows(text.splitlines())
    plz = aggregate(parsed.points)
    out_text = render(plz)
    gz_size = len(gzip.compress(out_text.encode("utf-8"), 9))
    multi = {k: v for k, v in parsed.points.items() if len(v) > 1}
    spread = sorted(
        ((spread_km(v), k) for k, v in multi.items() if spread_km(v) > SPREAD_REPORT_KM),
        reverse=True,
    )

    print(f"rows: {parsed.row_count}, invalid: {len(parsed.errors)}")
    print(f"PLZ: {len(plz)} ({len(multi)} with several rows)")
    print(f"size: {len(out_text.encode('utf-8'))} bytes, {gz_size} bytes gzipped")
    if gz_size > GZIP_BUDGET:
        print(
            f"warning: gzipped size exceeds {GZIP_BUDGET} bytes; consider splitting by PLZ prefix"
        )
    if spread:
        print(f"PLZ whose rows are more than {SPREAD_REPORT_KM:.0f} km apart ({len(spread)}):")
        print("  " + ", ".join(f"{k} ({d:.0f} km)" for d, k in spread))
    for err in parsed.errors[:20]:
        print(f"  {err}", file=sys.stderr)

    problems = []
    if len(plz) < args.min_plz:
        problems.append(f"only {len(plz)} PLZ (minimum {args.min_plz})")
    if parsed.row_count and len(parsed.errors) / parsed.row_count > MAX_INVALID_SHARE:
        problems.append(f"{len(parsed.errors)}/{parsed.row_count} rows invalid")
    if problems:
        for p in problems:
            print(f"error: sanity check failed: {p}; not writing {args.out}", file=sys.stderr)
        return EXIT_SANITY

    write_atomic(args.out, out_text)
    print(f"wrote {args.out}")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
