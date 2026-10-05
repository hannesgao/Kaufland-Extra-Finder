from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from conftest import FakeFetcher, store_list_sample
from kef_scraper.build import SCHEMA_VERSION, build_extra, sanity_problems
from kef_scraper.fetch import FetchError
from kef_scraper.models import ScanResult, Store, StoreResult
from kef_scraper.parse import parse_stores
from kef_scraper.scan import scan, scan_store

NOW = dt.datetime(2026, 10, 6, 6, 31, 12, tzinfo=ZoneInfo("Europe/Berlin"))


def _stores() -> dict[str, Store]:
    stores, _ = parse_stores(store_list_sample())
    return {s.id: s for s in stores}


def _two_week_page(page: str) -> str:
    """The DE4453 page plus next week's Extra leaflet (Monday-Wednesday situation)."""
    return page.replace(
        "</body>",
        '<div data-t-name="FlyerTile" data-subcategory="Hyper1" '
        'data-aa-detail="15.10.2026 - 21.10.2026_Extra-Angebote" '
        'data-offer-start-date="2026-10-15" '
        'data-download-url="https://assets.leaflets.schwarz/leaflets/pdfs/'
        '11111111-2222-3333-4444-555555555555/Extra.pdf">'
        '<a href="https://leaflets.kaufland.com/next">x</a></div></body>',
    )


class TestScanStore:
    def test_extra(self, pages: dict[str, str]) -> None:
        r = scan_store(FakeFetcher([], pages), _stores()["DE4453"])
        assert r.error is None
        assert [(lf.valid_from.isoformat(), lf.cluster[:13]) for lf in r.leaflets] == [
            ("2026-10-08", "01a0e6b0-7f24")
        ]
        assert r.unusual == ()

    def test_no_extra(self, pages: dict[str, str]) -> None:
        r = scan_store(FakeFetcher([], pages), _stores()["DE1300"])
        assert r.error is None
        assert r.leaflets == ()

    def test_two_validity_periods(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher([], {"DE4453": _two_week_page(pages["DE4453"])})
        r = scan_store(fetcher, _stores()["DE4453"])
        assert [lf.valid_from.isoformat() for lf in r.leaflets] == ["2026-10-08", "2026-10-15"]

    def test_duplicate_tiles_collapse(self, pages: dict[str, str]) -> None:
        page = pages["DE4453"].replace("</body>", pages["DE4453"].split("<body>")[1])
        r = scan_store(FakeFetcher([], {"DE4453": page}), _stores()["DE4453"])
        assert len(r.leaflets) == 1

    def test_unusual_tiles_are_kept(self, pages: dict[str, str]) -> None:
        page = pages["DE1300"].replace('data-subcategory="Leaflet2"', 'data-subcategory="Opening1"')
        r = scan_store(FakeFetcher([], {"DE1300": page}), _stores()["DE1300"])
        assert [t.subcategory for t in r.unusual] == ["Opening1"]

    def test_fetch_error(self) -> None:
        fetcher = FakeFetcher([], {"DE4453": FetchError("HTTP 503")})
        r = scan_store(fetcher, _stores()["DE4453"])
        assert r.error == "HTTP 503"

    def test_empty_page_is_failure(self) -> None:
        r = scan_store(FakeFetcher([], {"DE4453": "<html></html>"}), _stores()["DE4453"])
        assert r.error == "no leaflet tiles found"

    def test_bad_title_is_failure(self, pages: dict[str, str]) -> None:
        page = pages["DE4453"].replace("08.10.2026 - 14.10.2026_Extra", "ab Donnerstag_Extra")
        r = scan_store(FakeFetcher([], {"DE4453": page}), _stores()["DE4453"])
        assert r.error is not None
        assert "cannot parse validity" in r.error


class TestScan:
    def test_scans_all_and_caps_workers(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher([], pages, default=pages["DE1300"])
        stores = list(_stores().values())
        result = scan(fetcher, stores, workers=50, full_scan=False)
        assert sorted(fetcher.requested) == sorted(s.id for s in stores)
        assert result.store_count == 5
        assert {r.store.id for r in result.extra} == {"DE4453", "DE8530"}


def _result(*results: StoreResult, full_scan: bool = True, **kw: Any) -> ScanResult:
    return ScanResult(results=results, full_scan=full_scan, **kw)


class TestBuildExtra:
    def test_schema(self, pages: dict[str, str]) -> None:
        # DE4443 gets the same page as DE4453 -> same PDF -> one cluster with two stores.
        pages = {**pages, "DE4443": pages["DE4453"]}
        result = scan(
            FakeFetcher([], pages, default=pages["DE1300"]),
            list(_stores().values()),
            full_scan=False,
        )
        extra = build_extra(result, NOW)
        assert extra["schema_version"] == SCHEMA_VERSION
        assert extra["generated_at"] == "2026-10-06T06:31:12+02:00"
        assert extra["store_count"] == 5
        assert extra["failed_count"] == 0
        assert [s["id"] for s in extra["stores"]] == ["DE4443", "DE4453", "DE8530"]
        assert extra["stores"][0] == {
            "id": "DE4443",
            "name": "Karlsruhe-Oststadt",
            "plz": "76137",
            "city": "Karlsruhe",
            "street": "Durlacher Allee 111",
            "lat": 49.0039646,
            "lng": 8.4493277,
            "url": "https://filiale.kaufland.de/service/filiale/karlsruhe-oststadt-4443.html",
            "leaflets": [
                {
                    "valid_from": "2026-10-08",
                    "valid_to": "2026-10-14",
                    "cluster": "01a0e6b0-7f24-7ff4-89fd-aa2e11127632",
                    "viewer": "https://leaflets.kaufland.com/de-DE/DE_de_Hyper1_4453_D41-H/ar/4453",
                    "pdf": "https://assets.leaflets.schwarz/leaflets/pdfs/"
                    "01a0e6b0-7f24-7ff4-89fd-aa2e11127632/Extra-Angebote-08-10-2026-14-10-2026-00.pdf",
                }
            ],
        }
        assert extra["clusters"] == {
            "01a0e6b0-7f24-7ff4-89fd-aa2e11127632": ["DE4443", "DE4453"],
            "01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8": ["DE8530"],
        }

    def test_special_days_only_from_today(self, pages: dict[str, str]) -> None:
        raw = store_list_sample()
        for rec in raw:
            if rec["n"] == "DE4453":
                rec["sod"] = [
                    "2026-10-05|00:00|00:00",
                    "2026-10-06|00:00|00:00",
                    "2026-12-24|07:00|13:30",
                ]
        stores, _ = parse_stores(raw)
        result = scan(
            FakeFetcher([], pages),
            [s for s in stores if s.id in {"DE4453", "DE8530"}],
            full_scan=False,
        )
        extra = build_extra(result, NOW)  # NOW is 2026-10-06
        by_id = {s["id"]: s for s in extra["stores"]}
        assert by_id["DE4453"]["special_days"] == [
            {"date": "2026-10-06", "closed": True},
            {"date": "2026-12-24", "open": "07:00", "close": "13:30"},
        ]
        assert "special_days" not in by_id["DE8530"]

    def test_naive_timestamp_rejected(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            build_extra(_result(), dt.datetime(2026, 10, 6))  # noqa: DTZ001


class TestSanity:
    @pytest.fixture
    def many(self, make_store_record: Callable[[str], dict[str, Any]]) -> list[Store]:
        stores, _ = parse_stores([make_store_record(f"DE{i:04d}") for i in range(1000)])
        return stores

    def test_ok(self, many: list[Store]) -> None:
        result = _result(*(StoreResult(store=s) for s in many[:700]))
        assert sanity_problems(result) == []

    def test_too_few_stores(self, many: list[Store]) -> None:
        result = _result(*(StoreResult(store=s) for s in many[:699]))
        assert sanity_problems(result) == ["only 699 stores in the store list (minimum 700)"]

    def test_too_few_stores_ignored_for_partial_scan(self, many: list[Store]) -> None:
        result = _result(*(StoreResult(store=s) for s in many[:2]), full_scan=False)
        assert sanity_problems(result) == []

    def test_failure_rate_boundary(self, many: list[Store]) -> None:
        ok = [StoreResult(store=s) for s in many[:950]]
        failed = [StoreResult(store=s, error="HTTP 503") for s in many[950:]]
        assert sanity_problems(_result(*ok, *failed)) == []  # exactly 5 %
        failed.append(StoreResult(store=many[0], error="HTTP 503"))
        assert sanity_problems(_result(*ok, *failed)) == ["51/1001 stores failed (5.1% > 5%)"]

    def test_store_list_errors_count_as_failures(self, many: list[Store]) -> None:
        ok = [StoreResult(store=s) for s in many[:900]]
        result = _result(*ok, list_errors=tuple(f"store #{i}: bad" for i in range(100)))
        assert result.store_count == 1000
        assert sanity_problems(result) == ["100/1000 stores failed (10.0% > 5%)"]
