"""End-to-end runs of `kef-scrape` against the offline fake fetcher."""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from conftest import MINIMAL_PAGE, FakeFetcher, store_list_sample
from kef_scraper.cli import EXIT_ERROR, EXIT_OK, EXIT_SANITY, main
from kef_scraper.fetch import FetchError

MONDAY = dt.datetime(2026, 10, 5, 6, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TUESDAY = MONDAY + dt.timedelta(days=1)


def _run(fetcher: FakeFetcher, out: Path, *extra_args: str, now: dt.datetime = MONDAY) -> int:
    args = ["--out", str(out), "--delay", "0", *extra_args]
    return main(args, fetcher=fetcher, now=now)


@pytest.fixture
def full_list(make_store_record: Callable[[str], dict[str, Any]]) -> list[dict[str, Any]]:
    """Sample stores plus filler stores, enough to pass the 700-store check."""
    return store_list_sample() + [make_store_record(f"DE9{i:03d}") for i in range(700)]


def test_full_scan_writes_outputs(
    tmp_path: Path,
    pages: dict[str, str],
    full_list: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    out = tmp_path / "data"
    summary = tmp_path / "summary.md"
    fetcher = FakeFetcher(full_list, pages, default=MINIMAL_PAGE)
    assert _run(fetcher, out, "--summary", str(summary)) == EXIT_OK

    extra = json.loads((out / "extra.json").read_text())
    assert extra["store_count"] == 705
    assert [s["id"] for s in extra["stores"]] == ["DE4453", "DE8530"]
    assert (out / "snapshots" / "2026-10-05.json").exists()
    assert len((out / "history.csv").read_text().splitlines()) == 3
    assert "2 stores with 2 Extra leaflets" in capsys.readouterr().out
    assert summary.read_text().startswith("## ✅ Scan accepted")


def test_second_run_diffs_against_previous(
    tmp_path: Path,
    pages: dict[str, str],
    full_list: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    prev = tmp_path / "data-branch"
    assert _run(FakeFetcher(full_list, pages, default=MINIMAL_PAGE), prev) == EXIT_OK
    capsys.readouterr()

    # Tuesday: DE8530 lost its Extra leaflet, DE4443 gained DE4453's.
    pages2 = {**pages, "DE8530": pages["DE1300"], "DE4443": pages["DE4453"]}
    out = tmp_path / "out"
    fetcher = FakeFetcher(full_list, pages2, default=MINIMAL_PAGE)
    assert _run(fetcher, out, "--previous", str(prev), now=TUESDAY) == EXIT_OK

    report = capsys.readouterr().out
    assert "+1 / -1 leaflets, +1 / -1 stores" in report
    assert "+ Karlsruhe-Oststadt (76137)" in report
    assert "- Karlsruhe-Grünwinkel (76185)" in report
    history = (out / "history.csv").read_text().splitlines()
    assert len(history) == 4  # header + 2 from Monday + DE4443 from Tuesday
    assert history[-1].startswith("2026-10-06,DE4443,")


def test_sanity_failure_writes_nothing(
    tmp_path: Path, pages: dict[str, str], full_list: list[dict[str, Any]]
) -> None:
    out = tmp_path / "data"
    failing = {f"DE9{i:03d}": FetchError("HTTP 503") for i in range(40)}
    fetcher = FakeFetcher(full_list, {**pages, **failing}, default=MINIMAL_PAGE)
    summary = tmp_path / "not-yet-created" / "summary.md"
    assert _run(fetcher, out, "--summary", str(summary)) == EXIT_SANITY
    assert not out.exists()
    assert "Scan rejected" in summary.read_text()
    assert "40/705 stores failed (5.7% > 5%)" in summary.read_text()


def test_too_few_stores(tmp_path: Path, pages: dict[str, str]) -> None:
    out = tmp_path / "data"
    assert _run(FakeFetcher(store_list_sample(), pages), out) == EXIT_SANITY
    assert not out.exists()


def test_stores_subset_skips_store_count_check(tmp_path: Path, pages: dict[str, str]) -> None:
    out = tmp_path / "data"
    fetcher = FakeFetcher(store_list_sample(), pages)
    assert _run(fetcher, out, "--stores", "DE4453, DE1300") == EXIT_OK
    assert sorted(fetcher.requested) == ["DE1300", "DE4453"]
    extra = json.loads((out / "extra.json").read_text())
    assert extra["store_count"] == 2


def test_unknown_store_id(tmp_path: Path, pages: dict[str, str]) -> None:
    fetcher = FakeFetcher(store_list_sample(), pages)
    assert _run(fetcher, tmp_path, "--stores", "DE4453,DE0000") == EXIT_ERROR
    assert fetcher.requested == []


def test_broken_store_list(tmp_path: Path, pages: dict[str, str]) -> None:
    assert _run(FakeFetcher({"error": "maintenance"}, pages), tmp_path / "data") == EXIT_ERROR


@pytest.mark.parametrize("workers", ["0", "5"])
def test_workers_are_capped(tmp_path: Path, pages: dict[str, str], workers: str) -> None:
    with pytest.raises(SystemExit) as exc:
        _run(FakeFetcher(store_list_sample(), pages), tmp_path, "--workers", workers)
    assert exc.value.code == 2


def test_network_is_blocked() -> None:
    import socket

    with pytest.raises(RuntimeError, match="network access is not allowed"):
        socket.create_connection(("filiale.kaufland.de", 443))
