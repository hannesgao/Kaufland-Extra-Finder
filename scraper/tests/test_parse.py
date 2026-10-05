from __future__ import annotations

import datetime as dt

import pytest

from conftest import fixture_text, store_list_sample
from kef_scraper.models import Tile
from kef_scraper.parse import (
    ParseError,
    is_extra,
    is_standard,
    parse_stores,
    parse_tiles,
    parse_validity,
    pdf_id,
    to_leaflet,
)

EXTRA_DE4453 = "01a0e6b0-7f24-7ff4-89fd-aa2e11127632"
EXTRA_DE8530 = "01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8"


def _tile(**overrides: str | None) -> Tile:
    base: dict[str, str | None] = {
        "subcategory": "Hyper1",
        "title": "08.10.2026 - 14.10.2026_Extra-Angebote",
        "start": "2026-10-08",
        "pdf": f"https://assets.leaflets.schwarz/leaflets/pdfs/{EXTRA_DE4453}/Extra.pdf",
        "viewer": "https://leaflets.kaufland.com/de-DE/DE_de_Hyper1_4453_D41-H/ar/4453",
    }
    base.update(overrides)
    return Tile(**base)


class TestParseStores:
    def test_sample(self) -> None:
        stores, errors = parse_stores(store_list_sample())
        assert errors == []
        by_id = {s.id: s for s in stores}
        assert set(by_id) == {"DE1300", "DE1530", "DE4443", "DE4453", "DE8530"}
        s = by_id["DE4443"]
        assert s.name == "Karlsruhe-Oststadt"
        assert (s.plz, s.city, s.street) == ("76137", "Karlsruhe", "Durlacher Allee 111")
        assert s.lat == pytest.approx(49.0039646)
        assert s.lng == pytest.approx(8.4493277)

    def test_not_a_list(self) -> None:
        with pytest.raises(ParseError, match="JSON array"):
            parse_stores({"stores": []})

    @pytest.mark.parametrize(
        ("patch", "message"),
        [
            ({"lat": ""}, "invalid coordinates"),
            ({"lat": None}, "invalid coordinates"),
            ({"lat": "0", "lng": "0"}, "outside Germany"),
            ({"pc": "1234"}, "invalid PLZ"),
        ],
    )
    def test_invalid_record_is_reported_not_fatal(
        self, patch: dict[str, object], message: str
    ) -> None:
        raw = store_list_sample()
        raw[0] = {**raw[0], **patch}
        stores, errors = parse_stores(raw)
        assert len(stores) == len(raw) - 1
        assert len(errors) == 1
        assert message in errors[0]

    def test_missing_field(self) -> None:
        raw = store_list_sample()
        del raw[1]["sn"]
        _, errors = parse_stores(raw)
        assert errors == ["store #1: missing field 'sn'"]


class TestParseTiles:
    def test_store_with_extra(self) -> None:
        tiles = parse_tiles(fixture_text("prospekte_DE4453.html"))
        assert [t.subcategory for t in tiles] == [
            "KDZ2",
            "KDZ1",
            "Leaflet1",
            "Leaflet2",
            "KDZ1",
            "Hyper1",
        ]
        extra = [t for t in tiles if is_extra(t)]
        assert len(extra) == 1
        assert extra[0].title == "08.10.2026 - 14.10.2026_Extra-Angebote"
        assert extra[0].start == "2026-10-08"
        assert (
            extra[0].viewer == "https://leaflets.kaufland.com/de-DE/DE_de_Hyper1_4453_D41-H/ar/4453"
        )
        assert extra[0].pdf is not None
        assert pdf_id(extra[0].pdf) == EXTRA_DE4453

    def test_store_without_extra(self) -> None:
        tiles = parse_tiles(fixture_text("prospekte_DE1300.html"))
        assert len(tiles) == 5
        assert not any(is_extra(t) for t in tiles)
        assert all(is_standard(t) for t in tiles)

    def test_empty_page(self) -> None:
        assert parse_tiles("<html><body><p>Wartungsarbeiten</p></body></html>") == []


class TestClassification:
    def test_extra_by_subcategory(self) -> None:
        assert is_extra(_tile(subcategory="Hyper2", title="something"))

    def test_extra_by_title(self) -> None:
        assert is_extra(_tile(subcategory="Special", title="01.10.2026 - 07.10.2026_EXTRA"))

    def test_standard_is_not_extra(self) -> None:
        tile = _tile(subcategory="KDZ1", title="01.10.2026 - 07.10.2026_Prospekt")
        assert not is_extra(tile)
        assert is_standard(tile)

    def test_missing_attributes(self) -> None:
        tile = Tile(subcategory=None, title=None, start=None, pdf=None, viewer=None)
        assert not is_extra(tile)
        assert not is_standard(tile)


class TestParseValidity:
    def test_ok(self) -> None:
        assert parse_validity("08.10.2026 - 14.10.2026_Extra-Angebote") == (
            dt.date(2026, 10, 8),
            dt.date(2026, 10, 14),
        )

    def test_year_boundary(self) -> None:
        assert parse_validity("29.12.2026-04.01.2027_Extra") == (
            dt.date(2026, 12, 29),
            dt.date(2027, 1, 4),
        )

    @pytest.mark.parametrize(
        "title",
        [
            "Dauerhaft im Preis gesenkt_Dauerhaft im Preis gesenkt",
            "NEU ab 12.10.: Angebote von Mo.-Sa._NEU ab 12.10.: Angebote von Mo.-Sa.",
            "08.10. - 14.10._Extra-Angebote",
            "08.10.2026 - 14.10.2026 Extra-Angebote",
            "",
        ],
    )
    def test_unparseable(self, title: str) -> None:
        with pytest.raises(ParseError, match="cannot parse validity"):
            parse_validity(title)

    def test_impossible_date(self) -> None:
        with pytest.raises(ParseError, match="invalid date"):
            parse_validity("31.02.2026 - 06.03.2026_Extra")

    def test_reversed(self) -> None:
        with pytest.raises(ParseError, match="ends before it starts"):
            parse_validity("14.10.2026 - 08.10.2026_Extra")


class TestToLeaflet:
    def test_ok(self) -> None:
        lf = to_leaflet(_tile())
        assert lf.valid_from == dt.date(2026, 10, 8)
        assert lf.valid_to == dt.date(2026, 10, 14)
        assert lf.cluster == EXTRA_DE4453

    def test_start_mismatch(self) -> None:
        with pytest.raises(ParseError, match="does not match"):
            to_leaflet(_tile(start="2026-10-01"))

    def test_missing_start_is_accepted(self) -> None:
        assert to_leaflet(_tile(start=None)).valid_from == dt.date(2026, 10, 8)

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"title": None}, "without title"),
            ({"pdf": None}, "no PDF URL"),
            ({"pdf": "https://assets.leaflets.schwarz/leaflets/x.pdf"}, "no PDF id"),
            ({"viewer": None}, "no viewer link"),
        ],
    )
    def test_incomplete(self, overrides: dict[str, str | None], message: str) -> None:
        with pytest.raises(ParseError, match=message):
            to_leaflet(_tile(**overrides))
