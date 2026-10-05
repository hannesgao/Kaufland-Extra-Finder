"""Second check of Extra PDFs, with synthetic PDFs (no Kaufland content in the repo)."""

from __future__ import annotations

import pytest

from conftest import make_pdf
from kef_scraper.models import Store
from kef_scraper.pdfcheck import (
    PdfCheck,
    PdfCheckError,
    check_pdf,
    extract_store_line,
    matches_store,
)

# Layout like the real page 1: offers, then the store line, then a footer code that does NOT
# identify the store (real example: "NUR IN KARLSRUHE-OSTSTADT" next to code "..._8530_TS").
PAGE = [
    "EXTRA",
    "ANGEBOTE",
    "VON DONNERSTAG, 08.10.2026",
    "BIS MITTWOCH, 14.10.2026",
    "KNÜLLER",
    "nur",
    "NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER",
    "1_D41-H_8530_TS kaufland.de",
]


def _store(name: str, street: str) -> Store:
    return Store(id="DE1", name=name, plz="76131", city="Karlsruhe", street=street, lat=49, lng=8.4)


class TestExtract:
    def test_store_line(self) -> None:
        assert extract_store_line(make_pdf(PAGE)) == "KARLSRUHE-OSTSTADT, IM DURLACH CENTER"

    def test_lowercase_nur_is_not_the_store_line(self) -> None:
        with pytest.raises(PdfCheckError, match='no "NUR IN" line'):
            extract_store_line(make_pdf(["KNÜLLER", "nur", "nur in Aktion"]))

    def test_block_wrapping_over_lines(self) -> None:
        pdf = make_pdf(
            [
                "nur",
                "NUR IN PADERBORN, IM SÜDRING-CENTER,",
                "HUSENER STRASSE 121",
                "1_D41-H_1560_TS kaufland.de",
                "*Aktionsware",
            ]
        )
        assert extract_store_line(pdf) == "PADERBORN, IM SÜDRING-CENTER, HUSENER STRASSE 121"

    def test_several_stores(self) -> None:
        pdf = make_pdf(
            [
                "NUR IN GÖ-WESTSTADT, ELLIEHÄUSER WEG 23 •",
                "GÖ-GRONE, IM KAUF PARK • GÖ-WEENDE, GROSSE BREITE 6",
                "1_D41-H_5060_TS kaufland.de",
            ]
        )
        assert extract_store_line(pdf) == (
            "GÖ-WESTSTADT, ELLIEHÄUSER WEG 23 • GÖ-GRONE, IM KAUF PARK • GÖ-WEENDE, GROSSE BREITE 6"
        )

    def test_whitespace_is_normalised(self) -> None:
        pdf = make_pdf(["NUR IN   KASSEL-WESERTOR,  FRANZGRABEN 40-42  "])
        assert extract_store_line(pdf) == "KASSEL-WESERTOR, FRANZGRABEN 40-42"

    def test_not_a_pdf(self) -> None:
        with pytest.raises(PdfCheckError, match="unreadable PDF"):
            extract_store_line(b"<html>error</html>")

    def test_check_pdf_reports_errors_instead_of_raising(self) -> None:
        assert check_pdf(make_pdf(PAGE)) == PdfCheck("KARLSRUHE-OSTSTADT, IM DURLACH CENTER")
        result = check_pdf(b"%PDF-broken")
        assert result.store_line is None
        assert result.error is not None


class TestMatch:
    LINE = "KARLSRUHE-OSTSTADT, IM DURLACH CENTER"

    def test_same_store(self) -> None:
        assert matches_store(self.LINE, _store("Karlsruhe-Oststadt", "Durlacher Allee 111"))

    @pytest.mark.parametrize(
        ("name", "street"),
        [
            ("Karlsruhe-Grünwinkel", "Carl-Metz-Straße 7"),
            ("Karlsruhe-Beiertheim-Bulac", "Ortenbergstraße 8"),
        ],
    )
    def test_other_store(self, name: str, street: str) -> None:
        assert not matches_store(self.LINE, _store(name, street))

    # Real blocks (2026-10-08) and stores that were served the PDF.
    GOETTINGEN = (
        "GÖ-WESTSTADT, ELLIEHÄUSER WEG 23 • GÖ-GRONE, IM KAUF PARK • GÖ-WEENDE, GROSSE BREITE 6"
    )
    EICHE = "AHRENSFELDE-EICHE, IM KAUFPARK • BERLIN, IM BIESDORF-CENTER"
    NECKARSULM = "NECKARSULM, RÖTELSTRASSE 35"

    @pytest.mark.parametrize(
        ("line", "name", "street", "expected"),
        [
            (GOETTINGEN, "Göttingen-Grone", "Am Kauf Park 2", True),
            (GOETTINGEN, "Göttingen-Weende", "Große Breite 6", True),
            (GOETTINGEN, "Göttingen-Innenstadt", "Kurze-Geismar-Straße 26, 28, 30", False),
            (EICHE, "Eiche", "Landsberger Chaussee 17", True),
            (EICHE, "Berlin-Biesdorf", "Weißenhöher Straße 88-108", True),
            (EICHE, "Berlin-Lichtenberg", "Frankfurter Allee 113-117", False),
            (NECKARSULM, "Neckarsulm", "Rötelstraße 35", True),
            (NECKARSULM, "Heilbronn, Olgastr.", "Olgastraße 57", False),
            (NECKARSULM, "Weinsberg", "Haller Straße 59", False),
            (
                "MG-EICKEN, KREFELDER STR. 131 • MG, REYERHÜTTE 1",
                "Mönchengladbach-Pesch",
                "Reyerhütte 1",
                True,
            ),
            (
                "MG-EICKEN, KREFELDER STR. 131 • MG, REYERHÜTTE 1",
                "Mönchengladbach-Rheydt",
                "Moses-Stern-Straße 29",
                False,
            ),
            (
                "DREIEICH-SPRENDLINGEN, IM DREIEICH-NORDPARK",
                "Dreieich",
                "Robert-Bosch-Straße 15",
                True,
            ),
            (
                "FREIBURG I. BREISGAU-HASLACH, IM BREISGAU-CENTER",
                "Freiburg-Haslach",
                "St.-Georgener-Straße 2",
                True,
            ),
            (
                "FREIBURG I. BREISGAU-HASLACH, IM BREISGAU-CENTER",
                "Freiburg-Brühl",
                "Waldkircher Straße 57",
                False,
            ),
            (
                "MÜNCHEN-SCHWABING-FREIMANN, IM SUMA-CENTER",
                "München-Milbertshofen-Am H",
                "Schleißheimer Straße 506",
                False,
            ),
            (
                "LUDWIGSBURG, SCHWIEBERDINGER STRASSE 94",
                "Ludwigsburg, Friedrichstr.",
                "Friedrichstraße 124-126",
                False,
            ),
        ],
    )
    def test_real_blocks(self, line: str, name: str, street: str, expected: bool) -> None:
        assert matches_store(line, _store(name, street)) is expected

    @pytest.mark.parametrize(
        ("line", "name", "street"),
        [
            ("RASTATT, RAUENTALER STRASSE 65", "Rastatt", "Rauentaler Straße 65"),
            ("KARLSRUHE-GRÜNWINKEL", "Karlsruhe-Grünwinkel", "Carl-Metz-Straße 7"),
            ("KARLSRUHE-GRUENWINKEL", "Karlsruhe-Grünwinkel", "Carl-Metz-Straße 7"),
            # Kaufland truncates long names in its store list
            (
                "KARLSRUHE-BEIERTHEIM-BULACH, ORTENBERGSTR. 8",
                "Karlsruhe-Beiertheim-Bulac",
                "Ortenbergstraße 8",
            ),
            # different name, same street
            ("KASSEL CITY, FRANZGRABEN 40-42", "Kassel-Wesertor", "Franzgraben 40-42"),
        ],
    )
    def test_spelling_variants(self, line: str, name: str, street: str) -> None:
        assert matches_store(line, _store(name, street))
