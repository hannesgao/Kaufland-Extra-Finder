"""Offer overview parsing, trading-card matching, cards.json and the offer scan."""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import replace
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from conftest import NO_OFFERS_PAGE, FakeFetcher, store_list_sample
from kef_scraper.build import (
    CARDS_SCHEMA_VERSION,
    build_cards,
    offer_key,
    offers_problems,
)
from kef_scraper.cli import EXIT_OK, main
from kef_scraper.fetch import FetchError
from kef_scraper.models import Offer, ScanResult, Store, StoreResult
from kef_scraper.offers import CARD_KEYWORDS, is_card, is_card_like, parse_offers
from kef_scraper.parse import ParseError, parse_stores
from kef_scraper.scan import scan_store

NOW = dt.datetime(2026, 10, 6, 6, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TOP_TRAINER = "20973783"  # announced: shown 04.-09.10., sale 12.-17.10.
BOOSTER = "20941886"  # next week's offer, listed in two categories
FUNKO = "20849929"  # Advent calendar; "Pokémon" only in its description


def _by_nr(offers: list[Offer]) -> dict[str, Offer]:
    return {o.kl_nr: o for o in offers}


def _stores() -> dict[str, Store]:
    stores, _ = parse_stores(store_list_sample())
    return {s.id: s for s in stores}


class TestParseOffers:
    def test_reads_every_offer_once(self, offer_page: str) -> None:
        offers = parse_offers(offer_page)
        assert offers is not None
        nrs = [o.kl_nr for o in offers]
        assert (
            len(nrs) == len(set(nrs)) == 10
        )  # 11 entries; the booster's second category collapses
        assert {TOP_TRAINER, BOOSTER, FUNKO} <= set(nrs)

    def test_announced_offer(self, offer_page: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[TOP_TRAINER]
        assert offer.title == "POKÉMON"
        assert offer.subtitle == "Sammelkartenspiel »Top-Trainer-Box«"
        assert offer.price == "55.00"
        assert (offer.shown_from, offer.shown_to) == (dt.date(2026, 10, 4), dt.date(2026, 10, 9))
        assert (offer.sales_from, offer.sales_to) == (dt.date(2026, 10, 12), dt.date(2026, 10, 17))
        assert offer.category == "Vorwerbung"
        assert offer.week == "current"

    def test_next_week_offer(self, offer_page: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[BOOSTER]
        assert offer.price == "4.99"
        assert offer.sales_from is None
        assert offer.sales_to is None
        assert offer.week == "next"
        assert offer.category == "10_Elektro__Buero__Medien"  # first category wins

    def test_thumbnails_use_the_rendition_token(self, offer_page: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[TOP_TRAINER]
        base = "https://kaufland.media.schwarz/is/image/schwarz/196214144842_DE_V_2030-1"
        assert offer.thumbnail == f"{base}?JGstbGVnYWN5LW9uc2l0ZS0xJA=="
        assert offer.thumbnail_2x == f"{base}?JGstbGVnYWN5LW9uc2l0ZS0yJA=="

    def test_offer_without_title(self, offer_page: str) -> None:
        untitled = [o for o in parse_offers(offer_page) or [] if not o.title]
        assert len(untitled) == 1
        assert untitled[0].subtitle

    def test_page_without_offer_data(self) -> None:
        assert parse_offers(NO_OFFERS_PAGE) is None

    def test_broken_offer_data(self) -> None:
        page = '<script>window.SSR[\'x\'] = {"component":"OfferTemplate","props":{oops</script>'
        with pytest.raises(ParseError, match="unreadable offer data"):
            parse_offers(page)

    def test_missing_cycles(self) -> None:
        page = '<script>window.SSR[\'x\'] = {"component":"OfferTemplate","props":{}};</script>'
        with pytest.raises(ParseError, match="unreadable offer data"):
            parse_offers(page)


class TestMatching:
    def test_pokemon_offers_are_cards(self, offer_page: str) -> None:
        cards = [o.kl_nr for o in parse_offers(offer_page) or [] if is_card(o)]
        assert sorted(cards) == [BOOSTER, TOP_TRAINER]

    def test_description_does_not_count(self, offer_page: str) -> None:
        funko = _by_nr(parse_offers(offer_page) or [])[FUNKO]
        assert not is_card(funko)
        assert not is_card_like(funko)

    def test_keyword_ignores_accents_and_case(self, offer_page: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[BOOSTER]
        assert is_card(replace(offer, title="Pokemon"))
        assert is_card(replace(offer, title="", subtitle="Sammelkarten von pokémon"))

    @pytest.mark.parametrize(
        "title", ["YU-GI-OH!", "ONE PIECE Card Game", "Disney Lorcana", "Fußball-Sammelkarten"]
    )
    def test_other_trading_cards_are_reported(self, offer_page: str, title: str) -> None:
        offer = replace(_by_nr(parse_offers(offer_page) or [])[BOOSTER], title=title, subtitle="")
        assert not is_card(offer)
        assert is_card_like(offer)


class TestScanStore:
    def test_offers_are_added(self, pages: dict[str, str], offer_page: str) -> None:
        fetcher = FakeFetcher([], pages, offer_pages={"DE4453": offer_page})
        r = scan_store(fetcher, _stores()["DE4453"], with_offers=True)
        assert r.offers_scanned
        assert r.error is None
        assert r.leaflets
        assert sorted(o.kl_nr for o in r.cards) == [BOOSTER, TOP_TRAINER]
        assert r.card_like == ()

    def test_not_requested_without_flag(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher([], pages)
        r = scan_store(fetcher, _stores()["DE4453"])
        assert not r.offers_scanned
        assert fetcher.offer_requests == []

    def test_store_without_offer_data(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher([], pages, offer_default=NO_OFFERS_PAGE)
        r = scan_store(fetcher, _stores()["DE4453"], with_offers=True)
        assert r.no_offer_page
        assert r.offers_error is None
        assert r.cards == ()

    def test_offer_failure_keeps_leaflets(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher([], pages, offer_default=FetchError("HTTP 503"))
        r = scan_store(fetcher, _stores()["DE4453"], with_offers=True)
        assert r.offers_error == "HTTP 503"
        assert r.leaflets
        assert r.error is None

    def test_leaflet_failure_keeps_offers(self, offer_page: str) -> None:
        fetcher = FakeFetcher([], {"DE4453": FetchError("HTTP 503")}, offer_default=offer_page)
        r = scan_store(fetcher, _stores()["DE4453"], with_offers=True)
        assert r.error == "HTTP 503"
        assert len(r.cards) == 2


def _result(offer_page: str, n_without: int = 0, n_failed: int = 0) -> ScanResult:
    stores = list(_stores().values())
    offers = parse_offers(offer_page) or []
    results = []
    for i, s in enumerate(stores):
        if i < n_without:
            results.append(StoreResult(store=s, offers_scanned=True, no_offer_page=True))
        elif i < n_without + n_failed:
            results.append(StoreResult(store=s, offers_scanned=True, offers_error="HTTP 503"))
        else:
            cards = tuple(o for o in offers if is_card(o)) if s.id == "DE4453" else ()
            results.append(StoreResult(store=s, offers_scanned=True, cards=cards))
    return ScanResult(results=tuple(results), full_scan=False)


class TestBuildCards:
    def test_schema(self, offer_page: str) -> None:
        cards = build_cards(_result(offer_page), NOW, CARD_KEYWORDS)
        assert cards["schema_version"] == CARDS_SCHEMA_VERSION
        assert cards["generated_at"] == "2026-10-06T06:30:00+02:00"
        assert cards["keywords"] == ["pokemon"]
        assert cards["store_count"] == 5
        assert [s["id"] for s in cards["stores"]] == ["DE4453"]
        store = cards["stores"][0]
        assert set(store) == {
            "id",
            "name",
            "plz",
            "city",
            "street",
            "lat",
            "lng",
            "url",
            "products",
        }
        assert store["products"] == [f"{BOOSTER}|2026-10-08", f"{TOP_TRAINER}|2026-10-04"]
        top = cards["products"][f"{TOP_TRAINER}|2026-10-04"]
        assert top["sales_from"] == "2026-10-12"
        assert top["sales_to"] == "2026-10-17"
        assert top["thumbnail"].endswith("?JGstbGVnYWN5LW9uc2l0ZS0xJA==")
        booster = cards["products"][f"{BOOSTER}|2026-10-08"]
        assert "sales_from" not in booster
        assert booster["week"] == "next"
        json.dumps(cards)  # serialisable

    def test_offer_key(self, offer_page: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[TOP_TRAINER]
        assert offer_key(offer) == f"{TOP_TRAINER}|2026-10-04"

    def test_failed_stores_are_not_counted(self, offer_page: str) -> None:
        cards = build_cards(_result(offer_page, n_failed=1), NOW, CARD_KEYWORDS)
        assert cards["store_count"] == 4

    def test_naive_timestamp_rejected(self, offer_page: str) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            build_cards(_result(offer_page), dt.datetime(2026, 10, 6), CARD_KEYWORDS)  # noqa: DTZ001


class TestOffersProblems:
    def test_ok(self, offer_page: str) -> None:
        assert offers_problems(_result(offer_page)) == []

    def test_too_many_without_offer_data(self, offer_page: str) -> None:
        assert offers_problems(_result(offer_page, n_without=1), max_failure_rate=0.25) == []
        problems = offers_problems(_result(offer_page, n_without=2), max_failure_rate=0.25)
        assert problems == ["2/5 offer overviews had no offer data (40.0% > 25%)"]

    def test_too_many_failures(self, offer_page: str) -> None:
        problems = offers_problems(_result(offer_page, n_failed=2), max_failure_rate=0.25)
        assert problems == ["2/5 offer overviews failed (40.0% > 25%)"]

    def test_nothing_scanned(self) -> None:
        result = ScanResult(results=(StoreResult(store=_stores()["DE4453"]),), full_scan=False)
        assert offers_problems(result) == ["no offer overview was scanned"]


def _run(fetcher: FakeFetcher, out: Path, *extra: str) -> int:
    args = ["--out", str(out), "--delay", "0", "--skip-pdf-check", "--stores", "DE4453,DE8530"]
    return main([*args, *extra], fetcher=fetcher, now=NOW)


class TestCli:
    def test_offers_write_cards_json(
        self, tmp_path: Path, pages: dict[str, str], offer_page: str, capsys: Any
    ) -> None:
        fetcher = FakeFetcher(
            store_list_sample(), pages, offer_pages={"DE4453": offer_page, "DE8530": "<html/>"}
        )
        summary = tmp_path / "summary.md"
        # One of two stores without offer data is 50%: allow it in this tiny run.
        args = ("--offers", "--max-failure-rate", "0.5", "--summary", str(summary))
        assert _run(fetcher, tmp_path, *args) == EXIT_OK
        cards = json.loads((tmp_path / "cards.json").read_text())
        assert [s["id"] for s in cards["stores"]] == ["DE4453"]
        assert cards["store_count"] == 2
        report = capsys.readouterr().out
        assert "Offer overviews: 2 scanned, 0 failed, 1 without offer data" in report
        assert "Trading-card offers (pokemon): 2 in 1 stores" in report
        assert "Sammelkartenspiel »Top-Trainer-Box« (20973783) 55.00" in report
        assert "### 🃏 Trading cards" in summary.read_text()

    def test_without_flag_cards_json_is_untouched(
        self, tmp_path: Path, pages: dict[str, str]
    ) -> None:
        (tmp_path / "cards.json").write_text('{"old": true}')
        fetcher = FakeFetcher(store_list_sample(), pages)
        assert _run(fetcher, tmp_path) == EXIT_OK
        assert fetcher.offer_requests == []
        assert json.loads((tmp_path / "cards.json").read_text()) == {"old": True}
        assert (tmp_path / "extra.json").exists()

    def test_bad_offer_scan_keeps_previous_cards_but_writes_extra(
        self, tmp_path: Path, pages: dict[str, str], capsys: Any
    ) -> None:
        (tmp_path / "cards.json").write_text('{"old": true}')
        fetcher = FakeFetcher(store_list_sample(), pages, offer_default=FetchError("HTTP 503"))
        summary = tmp_path / "summary.md"
        assert _run(fetcher, tmp_path, "--offers", "--summary", str(summary)) == EXIT_OK
        assert json.loads((tmp_path / "cards.json").read_text()) == {"old": True}
        assert (tmp_path / "extra.json").exists()
        assert "cards.json NOT updated: 2/2 offer overviews failed" in capsys.readouterr().out
        assert "### ❌ Trading cards not updated" in summary.read_text()

    def test_card_like_offers_are_reported(
        self, tmp_path: Path, pages: dict[str, str], offer_page: str, capsys: Any
    ) -> None:
        page = offer_page.replace('"title":"LIVARNO®"', '"title":"YU-GI-OH!"')
        assert page != offer_page
        fetcher = FakeFetcher(store_list_sample(), pages, offer_default=page)
        assert _run(fetcher, tmp_path, "--offers") == EXIT_OK
        report = capsys.readouterr().out
        assert "Card-like offers matching no keyword" in report
        assert "YU-GI-OH!" in report
        assert "2 stores" in report
