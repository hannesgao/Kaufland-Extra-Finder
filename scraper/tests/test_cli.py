"""End-to-end runs of `kef-scrape` against the offline fake fetcher."""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from conftest import MINIMAL_PAGE, FakeFetcher, make_pdf, store_list_sample
from kef_scraper.cli import EXIT_ERROR, EXIT_OK, EXIT_SANITY, main
from kef_scraper.fetch import FetchError
from kef_scraper.pdfcheck import PARSER_VERSION

MONDAY = dt.datetime(2026, 10, 5, 6, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TUESDAY = MONDAY + dt.timedelta(days=1)


NO_PDF_PAUSES = ("--pdf-delay", "0", "--pdf-retry-pause", "0", "--pdf-retry-delay", "0")


class FlakyPdfFetcher(FakeFetcher):
    """Answers the first download of every PDF with a 503, like the CDN when hurried."""

    def pdf(self, url: str) -> bytes:
        if url not in self.pdf_requests:
            self.pdf_requests.append(url)
            raise FetchError("HTTP 503")
        return super().pdf(url)


def _run(fetcher: FakeFetcher, out: Path, *extra_args: str, now: dt.datetime = MONDAY) -> int:
    args = ["--out", str(out), "--delay", "0", *NO_PDF_PAUSES, *extra_args]
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


DE4453_PDF = (
    "https://assets.leaflets.schwarz/leaflets/pdfs/01a0e6b0-7f24-7ff4-89fd-aa2e11127632/"
    "Extra-Angebote-08-10-2026-14-10-2026-00.pdf"
)
DE8530_PDF = (
    "https://assets.leaflets.schwarz/leaflets/pdfs/01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8/"
    "Extra-Angebote-08-10-2026-14-10-2026-00.pdf"
)


def _leaflet(out: Path, store_id: str) -> dict[str, Any]:
    extra = json.loads((out / "extra.json").read_text())
    store = next(s for s in extra["stores"] if s["id"] == store_id)
    leaflet: dict[str, Any] = store["leaflets"][0]
    return leaflet


def test_pdf_check_flags_mismatches_and_caches(
    tmp_path: Path, pages: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    pdfs: dict[str, bytes | Exception] = {
        DE4453_PDF: make_pdf(["NUR IN KASSEL-WESERTOR, FRANZGRABEN 40-42"]),
        DE8530_PDF: make_pdf(["NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER"]),
    }
    out = tmp_path / "data"
    summary = tmp_path / "summary.md"
    fetcher = FakeFetcher(store_list_sample(), pages, pdfs=pdfs)
    args = ("--stores", "DE4453,DE8530", "--summary", str(summary))
    assert _run(fetcher, out, *args) == EXIT_OK

    assert _leaflet(out, "DE4453")["pdf_store"] == "KASSEL-WESERTOR, FRANZGRABEN 40-42"
    assert _leaflet(out, "DE4453")["pdf_store_match"] is True
    assert _leaflet(out, "DE8530")["pdf_store"] == "KARLSRUHE-OSTSTADT, IM DURLACH CENTER"
    assert _leaflet(out, "DE8530")["pdf_store_match"] is False
    report = capsys.readouterr().out
    assert "Karlsruhe-Grünwinkel (76185): PDF says NUR IN KARLSRUHE-OSTSTADT" in report
    assert "**PDF names a different store (1):**" in summary.read_text()
    cache = json.loads((out / "pdf_checks.json").read_text())
    assert cache["parser"] == PARSER_VERSION
    assert cache["checks"]["01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8"] == {
        "store_line": "KARLSRUHE-OSTSTADT, IM DURLACH CENTER"
    }

    # Second run reuses the cache: no PDF is downloaded again.
    again = FakeFetcher(store_list_sample(), pages, pdfs={})
    assert _run(again, out, "--stores", "DE4453,DE8530", now=TUESDAY) == EXIT_OK
    assert again.pdf_requests == []
    assert _leaflet(out, "DE8530")["pdf_store_match"] is False


def test_pdf_failures_do_not_fail_the_scan(tmp_path: Path, pages: dict[str, str]) -> None:
    pdfs: dict[str, bytes | Exception] = {
        DE4453_PDF: FetchError("HTTP 503"),
        DE8530_PDF: b"not a pdf",
    }
    out = tmp_path / "data"
    fetcher = FakeFetcher(store_list_sample(), pages, pdfs=pdfs)
    assert _run(fetcher, out, "--stores", "DE4453,DE8530") == EXIT_OK
    # The failed download is tried twice; the unreadable PDF is not downloaded again.
    assert sorted(fetcher.pdf_requests) == sorted([DE4453_PDF, DE4453_PDF, DE8530_PDF])
    for store_id in ("DE4453", "DE8530"):
        assert "pdf_store" not in _leaflet(out, store_id)
        assert "pdf_store_match" not in _leaflet(out, store_id)
    cache = json.loads((out / "pdf_checks.json").read_text())
    assert cache == {"parser": PARSER_VERSION, "checks": {}}  # retried next run


def test_failed_pdf_downloads_get_a_second_slower_pass(
    tmp_path: Path, pages: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr("kef_scraper.scan.time.sleep", sleeps.append)
    pdfs: dict[str, bytes | Exception] = {
        DE4453_PDF: make_pdf(["NUR IN KASSEL-WESERTOR, FRANZGRABEN 40-42"]),
        DE8530_PDF: make_pdf(["NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER"]),
    }
    fetcher = FlakyPdfFetcher(store_list_sample(), pages, pdfs=pdfs)
    out = tmp_path / "data"
    args = ["--out", str(out), "--delay", "0", "--stores", "DE4453,DE8530"]
    pauses = ["--pdf-delay", "5", "--pdf-retry-pause", "60", "--pdf-retry-delay", "15"]
    assert main([*args, *pauses], fetcher=fetcher, now=MONDAY) == EXIT_OK
    assert sorted(fetcher.pdf_requests) == sorted([DE4453_PDF, DE8530_PDF] * 2)
    assert sleeps == [5.0, 60.0, 15.0]  # first pass, pause, second pass
    assert _leaflet(out, "DE4453")["pdf_store_match"] is True
    assert _leaflet(out, "DE8530")["pdf_store_match"] is False
    assert len(json.loads((out / "pdf_checks.json").read_text())["checks"]) == 2


def test_cache_from_an_older_parser_is_ignored(tmp_path: Path, pages: dict[str, str]) -> None:
    out = tmp_path / "data"
    out.mkdir()
    old = {"01a0e6b0-7f24-7ff4-89fd-aa2e11127632": {"store_line": "SOMEWHERE ELSE"}}
    (out / "pdf_checks.json").write_text(json.dumps(old))
    pdfs: dict[str, bytes | Exception] = {
        DE4453_PDF: make_pdf(["NUR IN KASSEL-WESERTOR, FRANZGRABEN 40-42"])
    }
    fetcher = FakeFetcher(store_list_sample(), pages, pdfs=pdfs)
    assert _run(fetcher, out, "--stores", "DE4453") == EXIT_OK
    assert fetcher.pdf_requests == [DE4453_PDF]
    assert _leaflet(out, "DE4453")["pdf_store_match"] is True


def test_skip_pdf_check(tmp_path: Path, pages: dict[str, str]) -> None:
    fetcher = FakeFetcher(store_list_sample(), pages)
    out = tmp_path / "data"
    assert _run(fetcher, out, "--stores", "DE4453", "--skip-pdf-check") == EXIT_OK
    assert fetcher.pdf_requests == []
