"""Offer overview parsing, trading-card matching, cards.json and the offer scan."""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import replace
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from conftest import (
    MINIMAL_PAGE,
    NO_OFFERS_PAGE,
    FakeFetcher,
    sample_refs,
    sample_stores,
    store_list_sample,
)
from kef_scraper.build import (
    CARDS_SCHEMA_VERSION,
    build_cards,
    build_deals,
    build_offers,
    offer_key,
    offers_problems,
)
from kef_scraper.cli import EXIT_OK, main
from kef_scraper.fetch import FetchError
from kef_scraper.models import Offer, ScanResult, Store, StoreResult
from kef_scraper.offers import (
    CARD_KEYWORDS,
    EXTRA_SECTION,
    is_card,
    is_card_like,
    parse_offers,
)
from kef_scraper.output import extra_offer_lines
from kef_scraper.parse import ParseError
from kef_scraper.pdfcheck import PdfCheck
from kef_scraper.scan import scan, scan_store

NOW = dt.datetime(2026, 10, 6, 6, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TOP_TRAINER = "20973783"  # announced: shown 04.-09.10., sale 12.-17.10.
BOOSTER = "20941886"  # next week's offer, listed in two categories
FUNKO = "20849929"  # Advent calendar; "Pokémon" only in its description


def _by_nr(offers: list[Offer]) -> dict[str, Offer]:
    return {o.kl_nr: o for o in offers}


def _stores() -> dict[str, Store]:
    return sample_stores()


class TestParseOffers:
    def test_reads_every_offer_once(self, offer_page: str) -> None:
        offers = parse_offers(offer_page)
        assert offers is not None
        nrs = [o.kl_nr for o in offers]
        assert (
            len(nrs) == len(set(nrs)) == 10
        )  # 11 entries; the booster's second category collapses
        assert {TOP_TRAINER, BOOSTER, FUNKO} <= set(nrs)

    def test_keeps_every_section_and_the_old_price(self, offer_page: str) -> None:
        offers = _by_nr(parse_offers(offer_page) or [])
        assert offers[TOP_TRAINER].sections == ("Nächste Woche",)
        assert len(offers[BOOSTER].sections) == 2
        assert {o.old_price for o in offers.values()} > {None}

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
        assert is_card(replace(offer, title="", subtitle="SAMMELKARTEN von pokémon"))

    @pytest.mark.parametrize(
        ("title", "subtitle"),
        [
            ("KINDER", "Adventskalender »Pokémon« "),  # chocolate with stickers (2026-10-11)
            ("POKÉMON", "Plüschfigur Pikachu"),
            ("AK TRADE", "Sammelkarten-Album Pokémon"),  # album for cards (2026-11-01)
            ("POKÉMON", "Schutzhüllen für Sammelkarten"),
            ("POKÉMON", "Sammelkarten-Ordner"),
        ],
    )
    def test_non_cards_are_reported_not_listed(
        self, offer_page: str, title: str, subtitle: str
    ) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[BOOSTER]
        other = replace(offer, title=title, subtitle=subtitle)
        assert not is_card(other)
        assert is_card_like(other)

    @pytest.mark.parametrize(
        "subtitle",
        [
            "Sammelkartenspiel-Doppelpack ",
            "Boosterpack »Ewige Rivalen«",
            "Trading Card Game",
            "TCG",
            "Sammelkartenspiel »Top-Trainer-Box«",
            "Sammelkartenspiel »Mega-Glurak X«",  # real offer, 2026-11-01
        ],
    )
    def test_card_wording(self, offer_page: str, subtitle: str) -> None:
        offer = _by_nr(parse_offers(offer_page) or [])[BOOSTER]
        assert is_card(replace(offer, title="POKÉMON", subtitle=subtitle))

    @pytest.mark.parametrize(
        "title", ["YU-GI-OH!", "ONE PIECE Card Game", "Disney Lorcana", "Fußball-Sammelkarten"]
    )
    def test_other_trading_cards_are_reported(self, offer_page: str, title: str) -> None:
        offer = replace(_by_nr(parse_offers(offer_page) or [])[BOOSTER], title=title, subtitle="")
        assert not is_card(offer)
        assert is_card_like(offer)


class TestScanStore:
    def test_offers_are_added(self, pages: dict[str, str], offer_page: str) -> None:
        fetcher = FakeFetcher(store_list_sample(), pages, offer_pages={"DE4453": offer_page})
        r = scan_store(fetcher, sample_refs()["DE4453"], with_offers=True)
        assert r.offers_scanned
        assert r.error is None
        assert r.leaflets
        assert sorted(o.kl_nr for o in r.cards) == [BOOSTER, TOP_TRAINER]
        assert r.card_like == ()

    def test_not_requested_without_flag(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher(store_list_sample(), pages)
        r = scan_store(fetcher, sample_refs()["DE4453"])
        assert not r.offers_scanned
        assert fetcher.offer_requests == []

    def test_store_without_offer_data(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher(store_list_sample(), pages, offer_default=NO_OFFERS_PAGE)
        r = scan_store(fetcher, sample_refs()["DE4453"], with_offers=True)
        assert r.no_offer_page
        assert r.offers_error is None
        assert r.cards == ()

    def test_offer_failure_keeps_leaflets(self, pages: dict[str, str]) -> None:
        fetcher = FakeFetcher(store_list_sample(), pages, offer_default=FetchError("HTTP 503"))
        r = scan_store(fetcher, sample_refs()["DE4453"], with_offers=True)
        assert r.offers_error == "HTTP 503"
        assert r.leaflets
        assert r.error is None

    def test_leaflet_failure_keeps_offers(self, offer_page: str) -> None:
        fetcher = FakeFetcher(store_list_sample(), {"DE4453": ""}, offer_default=offer_page)
        r = scan_store(fetcher, sample_refs()["DE4453"], with_offers=True)
        assert r.error == "no leaflet tiles found"
        assert r.store.name == "Kassel-Wesertor"
        assert len(r.cards) == 2

    def test_store_page_failure_skips_offers(self, offer_page: str) -> None:
        """Without the store's page its name, address and position are unknown."""
        fetcher = FakeFetcher(
            store_list_sample(), {"DE4453": FetchError("HTTP 503")}, offer_default=offer_page
        )
        r = scan_store(fetcher, sample_refs()["DE4453"], with_offers=True)
        assert r.error == "HTTP 503"
        assert r.offers_error == "store page could not be read"
        assert r.offers == ()
        assert fetcher.offer_requests == []


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
        deals = json.loads((tmp_path / "deals.json").read_text())
        assert (deals["store_count"], deals["products"]) == (2, {})  # no PDF names a store here
        report = capsys.readouterr().out
        assert "deals.json: 0 offers in 0 stores" in report
        assert "Offer overviews: 2 scanned, 0 failed, 1 without offer data" in report
        assert "Trading-card offers (pokemon): 2 in 1 stores" in report
        assert "Sammelkartenspiel »Top-Trainer-Box« (20973783) 55.00" in report
        assert "### 🃏 Trading cards" in summary.read_text()
        assert "### 🧾 Offer catalog" in summary.read_text()
        # A partial scan writes its stores only: its catalog would not cover the other stores.
        store = json.loads((tmp_path / "offers" / "stores" / "DE4453.json").read_text())
        assert (store["id"], store["added"], store["missing"]) == ("DE4453", [], [])
        assert [p.name for p in (tmp_path / "offers").iterdir()] == ["stores"]

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
        assert not (tmp_path / "deals.json").exists()
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
        assert "Possible trading cards not in cards.json" in report
        assert "YU-GI-OH!" in report
        assert "2 stores" in report


def _extra_offer(kl_nr: str, title: str, price: str, old_price: str | None = None) -> Offer:
    day = dt.date(2026, 11, 9)
    return Offer(
        kl_nr=kl_nr,
        title=title,
        subtitle="",
        price=price,
        unit=None,
        shown_from=day,
        shown_to=day + dt.timedelta(days=5),
        sales_from=None,
        sales_to=None,
        category="97_Internetwerbung",
        week="current",
        old_price=old_price,
        sections=(EXTRA_SECTION,),
    )


class TestExtraOfferReport:
    """Offers of the section "Extra-Angebote", compared between stores and with the PDF."""

    BREAD = _extra_offer("1", "Krustenbrot", "1.39")
    MILK = _extra_offer("2", "MÜLLER Müllermilch", "0.59", "1.49")
    KOHLRABI = _extra_offer("3", "Dtsch. Kohlrabi, lose", "0.49")

    def _result(self) -> tuple[ScanResult, dict[str, Any]]:
        stores = list(_stores().values())
        named, listed, *others = stores  # the bread is in every store: baseline
        results = [
            StoreResult(
                named, offers_scanned=True, extra_offers=(self.BREAD, self.MILK, self.KOHLRABI)
            ),
            StoreResult(listed, offers_scanned=True, extra_offers=(self.BREAD,)),
            *(StoreResult(s, offers_scanned=True, extra_offers=(self.BREAD,)) for s in others),
        ]
        extra = {
            "stores": [
                {"id": named.id, "leaflets": [{"cluster": "a", "pdf_store_match": True}]},
                {"id": listed.id, "leaflets": [{"cluster": "a", "pdf_store_match": False}]},
            ]
        }
        return ScanResult(results=tuple(results), full_scan=False), extra

    def test_compares_stores_and_pdf(self) -> None:
        result, extra = self._result()
        text = "nur in soest mueller muellermilch 0 59 kohlrabi 0 49"
        lines = extra_offer_lines(result, extra, {"a": PdfCheck("SOEST", text=text)})
        report = "\n".join(lines)
        assert "1 stores named by their PDF: 3 / 3 / 3 offers" in report
        assert "1 stores other Extra: 1 / 1 / 1 offers" in report
        assert (
            "1 offers in at least 90% of all stores (not Extra); 2 others in named stores" in report
        )
        assert "title and price 1, title only 0, price only 1, neither 0, no PDF text 0" in report
        assert "Baseline offers with their title in the PDF: 0 of 1" in report
        assert "title in PDF 1/1: MÜLLER Müllermilch  (2) 0.59 (was 1.49)" in report
        assert "Krustenbrot" not in report

    def test_without_pdf_text(self) -> None:
        result, extra = self._result()
        report = "\n".join(extra_offer_lines(result, extra, {"a": PdfCheck("SOEST")}))
        assert "no PDF text 2" in report

    def test_nothing_without_an_offer_scan(self) -> None:
        stores = list(_stores().values())
        result = ScanResult(results=(StoreResult(stores[0]),), full_scan=False)
        assert extra_offer_lines(result, {"stores": []}) == []


class TestBuildDeals:
    """deals.json: offers of the Extra leaflets in stores named by their PDF."""

    BREAD = _extra_offer("1", "Krustenbrot", "1.39")
    MILK = _extra_offer("2", "MÜLLER Müllermilch", "0.59", "1.49")
    BEEF = _extra_offer("3", "US-Rinderentrecôte", "5.39")  # worded differently in the PDF
    TEXT = "nur in soest mueller muellermilch 0 59 rinder entrecote 5 39"

    def _deals(self, *, dear_milk: bool = False) -> dict[str, Any]:
        a, b, c, listed, other = list(_stores().values())
        milk = replace(self.MILK, price="0.69") if dear_milk else self.MILK
        results = (
            StoreResult(a, offers_scanned=True, extra_offers=(self.BREAD, self.MILK, self.BEEF)),
            StoreResult(b, offers_scanned=True, extra_offers=(self.BREAD, self.MILK)),
            StoreResult(c, offers_scanned=True, extra_offers=(self.BREAD, milk)),
            StoreResult(listed, offers_scanned=True, extra_offers=(self.BREAD,)),
            StoreResult(other, offers_scanned=True, extra_offers=(self.BREAD, self.MILK)),
        )
        extra = {
            "stores": [
                *(
                    {"id": s.id, "leaflets": [{"cluster": "a", "pdf_store_match": True}]}
                    for s in (a, b, c)
                ),
                {"id": listed.id, "leaflets": [{"cluster": "a", "pdf_store_match": False}]},
            ]
        }
        checks = {"a": PdfCheck("SOEST", text=self.TEXT)}
        return build_deals(ScanResult(results=results, full_scan=False), extra, checks, NOW)

    def test_lists_offers_printed_in_the_pdf(self) -> None:
        deals = self._deals()
        a, b, c, *_ = _stores()
        milk, beef = offer_key(self.MILK), offer_key(self.BEEF)
        assert list(deals["products"]) == [milk, beef]
        assert [s["id"] for s in deals["stores"]] == sorted([a, b, c])
        assert deals["products"][milk] == {
            "kl_nr": "2",
            "title": "MÜLLER Müllermilch",
            "subtitle": "",
            "price": "0.59",
            "old_price": "1.49",
            "shown_from": "2026-11-09",
            "shown_to": "2026-11-14",
            "week": "current",
            "sections": [],
            "other_stores": 1,  # a store that no Extra PDF names has it too
        }
        assert (deals["store_count"], deals["extra_store_count"]) == (5, 3)

    def test_bakery_offers_of_every_store_are_left_out(self) -> None:
        deals = self._deals()
        assert offer_key(self.BREAD) not in deals["products"]
        assert deals["left_out"] == 3

    def test_offer_of_named_stores_only_is_listed_without_its_title_in_the_pdf(self) -> None:
        deals = self._deals()
        beef = offer_key(self.BEEF)
        by_id = {s["id"]: s for s in deals["stores"]}
        a = next(iter(_stores()))
        assert by_id[a]["unconfirmed"] == [beef]
        assert deals["products"][beef]["other_stores"] == 0
        assert all("unconfirmed" not in s for sid, s in by_id.items() if sid != a)

    def test_store_with_another_price(self) -> None:
        deals = self._deals(dear_milk=True)
        milk = offer_key(self.MILK)
        c = list(_stores())[2]
        assert deals["products"][milk]["price"] == "0.59"  # the price most stores have
        assert {s["id"]: s.get("prices") for s in deals["stores"] if "prices" in s} == {
            c: {milk: "0.69"}
        }

    def test_no_store_named_by_a_pdf(self) -> None:
        stores = list(_stores().values())
        results = tuple(
            StoreResult(s, offers_scanned=True, extra_offers=(self.MILK,)) for s in stores
        )
        deals = build_deals(ScanResult(results=results, full_scan=False), {"stores": []}, {}, NOW)
        assert (deals["products"], deals["stores"], deals["extra_store_count"]) == ({}, [], 0)

    def test_needs_an_aware_timestamp(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            build_deals(
                ScanResult(results=(), full_scan=False),
                {"stores": []},
                {},
                NOW.replace(tzinfo=None),
            )


def _page(*categories: dict[str, Any]) -> str:
    """An offer overview with the given categories, as the website embeds it."""
    data = {
        "component": "OfferTemplate",
        "props": {"offerData": {"cycles": [{"categories": categories}]}},
    }
    return f"<script>window.SSR['x'] = {json.dumps(data, separators=(',', ':'))}</script>"


def _raw(kl_nr: str = "00424937", **fields: Any) -> dict[str, Any]:
    return {
        "klNr": kl_nr,
        "title": "KINDER",
        "subtitle": "Pingui ",
        "dateFrom": "2026-11-08",
        "dateTo": "2026-11-14",
        "salesFrom": "2026-11-12",
        "salesTo": "2026-11-14",
        "formattedPrice": "2.49",
        "formattedOldPrice": "3.29",
        "unit": "je 240-g-Packg.",
    } | fields


def _category(name: str, *offers: dict[str, Any], main: bool = False) -> dict[str, Any]:
    return {"name": name, "displayName": name, "main": main, "offers": list(offers)}


class TestOfferDetails:
    def test_prices_dates_and_description(self) -> None:
        raw = _raw(
            detailDescription="Schoko-Milch-Dessert, gekühlt",
            formattedBasePrice="(1 kg = 10.38)",
            loyaltyFormattedPrice="2.22*",
            loyaltyBasePrice="(1 kg = 9.25)",
            bbyMessage=["3 Stück", "entspr. pro Packg. 1.34"],
        )
        (offer,) = parse_offers(_page(_category("Molkerei", raw, main=True))) or []
        assert (offer.sales_from, offer.sales_to) == (dt.date(2026, 11, 12), dt.date(2026, 11, 14))
        assert offer.description == "Schoko-Milch-Dessert, gekühlt"
        assert (offer.base_price, offer.card_base_price) == ("(1 kg = 10.38)", "(1 kg = 9.25)")
        assert offer.card_price == "2.22"  # without Kaufland's footnote mark
        assert offer.multi_buy == ("3 Stück", "entspr. pro Packg. 1.34")

    def test_plain_offer_has_none_of_them(self) -> None:
        (offer,) = parse_offers(_page(_category("Molkerei", _raw()))) or []
        assert (offer.description, offer.base_price, offer.card_price) == (None, None, None)
        assert (offer.card_base_price, offer.multi_buy, offer.department) == (None, (), None)

    def test_department_is_the_first_assortment_category(self) -> None:
        page = _page(
            _category("Unsere Knüller", _raw()),
            _category("Molkerei", _raw(), main=True),
            _category("Tiefkühlkost", _raw(), main=True),
        )
        (offer,) = parse_offers(page) or []
        assert offer.department == "Molkerei"
        assert offer.sections == ("Unsere Knüller", "Molkerei", "Tiefkühlkost")


class TestBuildOffers:
    """Three stores: milk everywhere, bread in A and B, cheese in C only; milk is dearer in C."""

    def _offers(self) -> dict[str, Any]:
        stores = list(_stores().values())[:3]
        milk, bread, cheese = (
            _raw("1", title="Milch"),
            _raw("2", title="Brot"),
            _raw("3", title="Käse"),
        )
        dear = milk | {"formattedPrice": "2.99", "formattedOldPrice": None}
        pages = {
            stores[0].id: _page(_category("Alles", milk, bread, main=True)),
            stores[1].id: _page(_category("Alles", milk, bread, main=True)),
            stores[2].id: _page(_category("Alles", dear, cheese, main=True)),
        }
        self.ids = [s.id for s in stores]
        fetcher = FakeFetcher(store_list_sample(), {}, MINIMAL_PAGE, offer_pages=pages)
        refs = [sample_refs()[s.id] for s in stores]
        return build_offers(scan(fetcher, refs, full_scan=False, with_offers=True), NOW)

    def test_catalog_has_each_offer_once_as_most_stores_have_it(self) -> None:
        catalog = self._offers()["catalog"]
        key = "1|2026-11-08"
        assert list(catalog["products"]) == [key, "2|2026-11-08", "3|2026-11-08"]
        assert catalog["products"][key] == {
            "kl_nr": "1",
            "title": "Milch",
            "subtitle": "Pingui",
            "price": "2.49",
            "unit": "je 240-g-Packg.",
            "shown_from": "2026-11-08",
            "shown_to": "2026-11-14",
            "sales_from": "2026-11-12",
            "sales_to": "2026-11-14",
            "old_price": "3.29",
            "department": "Alles",
            "sections": ["Alles"],
        }
        assert catalog["common"] == [key, "2|2026-11-08"]  # in more than half of the stores

    def test_store_lists_its_differences_only(self) -> None:
        offers = self._offers()
        a, _, c = (offers["stores"][i] for i in self.ids)
        assert (a["added"], a["missing"], "overrides" in a) == ([], [], False)
        assert (c["added"], c["missing"]) == (["3|2026-11-08"], ["2|2026-11-08"])
        # null: this store has no comparison price for the milk
        assert c["overrides"] == {"1|2026-11-08": {"old_price": None, "price": "2.99"}}

    def test_index_lists_stores_with_their_offer_count(self) -> None:
        index = self._offers()["index"]
        assert [(s["id"], s["offers"]) for s in index["stores"]] == [(i, 2) for i in self.ids]
        assert index["generated_at"] == "2026-10-06T06:30:00+02:00"

    def test_store_without_offers_is_left_out(self) -> None:
        store = next(iter(_stores().values()))
        result = ScanResult(results=(StoreResult(store, offers_scanned=True),), full_scan=False)
        offers = build_offers(result, NOW)
        assert (offers["stores"], offers["index"]["stores"]) == ({}, [])

    def test_needs_an_aware_timestamp(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            build_offers(ScanResult(results=(), full_scan=False), NOW.replace(tzinfo=None))
