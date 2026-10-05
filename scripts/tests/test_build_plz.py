from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import NoReturn

import pytest

from build_plz import (
    EXIT_ERROR,
    EXIT_OK,
    EXIT_SANITY,
    SourceError,
    aggregate,
    distance_km,
    main,
    parse_rows,
    read_source,
    render,
    spread_km,
)

SAMPLE = Path(__file__).parent / "fixtures" / "DE_sample.txt"


def _sample_lines() -> list[str]:
    return SAMPLE.read_text(encoding="utf-8").splitlines()


@pytest.fixture
def sample_zip(tmp_path: Path) -> Path:
    path = tmp_path / "DE.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.write(SAMPLE, "DE.txt")
        zf.writestr("readme.txt", "GeoNames readme")
    return path


class TestParseRows:
    def test_sample(self) -> None:
        parsed = parse_rows(_sample_lines())
        assert parsed.errors == []
        assert parsed.row_count == 42
        assert {k: len(v) for k, v in parsed.points.items()} == {
            "76137": 1,
            "34125": 1,
            "01814": 4,
            "10875": 36,
        }

    @pytest.mark.parametrize(
        ("line", "message"),
        [
            ("DE\t7613\tX\t\t\t\t\t\t\t49.0\t8.4\t", "invalid PLZ"),
            ("DE\tABCDE\tX\t\t\t\t\t\t\t49.0\t8.4\t", "invalid PLZ"),
            ("DE\t76137\tX\t\t\t\t\t\t\t\t8.4\t", "invalid coordinates"),
            ("DE\t76137\tX\t\t\t\t\t\t\t0\t0\t", "outside Germany"),
            ("DE\t76137\tX", "at least 11 columns"),
        ],
    )
    def test_invalid_rows_are_collected(self, line: str, message: str) -> None:
        parsed = parse_rows([*_sample_lines(), line])
        assert parsed.row_count == 43
        assert len(parsed.errors) == 1
        assert message in parsed.errors[0]
        assert parsed.errors[0].startswith("line 43:")

    def test_quotes_are_not_special(self) -> None:
        line = 'DE\t76137\t"Karlsruhe\t\t\t\t\t\t\t49.0\t8.4\t'
        parsed = parse_rows([line])
        assert parsed.errors == []
        assert parsed.points == {"76137": [(49.0, 8.4)]}

    def test_blank_lines_are_ignored(self) -> None:
        assert parse_rows(["", *_sample_lines(), ""]).row_count == 42


class TestAggregate:
    def test_single_row_unchanged(self) -> None:
        plz = aggregate(parse_rows(_sample_lines()).points)
        assert plz["76137"] == (49.0019, 8.4287)
        assert plz["34125"] == (51.3195, 9.5163)

    def test_even_count_uses_middle_mean(self) -> None:
        # 01814: Bad Schandau, Porschdorf, Rathmannsdorf, Reinhardtsdorf-Schöna
        assert aggregate(parse_rows(_sample_lines()).points)["01814"] == (50.9237, 14.1486)

    def test_median_resists_far_away_rows(self) -> None:
        # Company PLZ 10875: most rows in Berlin, some in Stuttgart. The mean would land in
        # Thuringia; the median stays in Berlin.
        lat, lng = aggregate(parse_rows(_sample_lines()).points)["10875"]
        assert (lat, lng) == (52.5064, 13.3731)

    def test_rounding(self) -> None:
        assert aggregate({"12345": [(52.123456, 13.987654)]}) == {"12345": (52.1235, 13.9877)}
        assert aggregate({"12345": [(52.123456, 13.987654)]}, decimals=3) == {
            "12345": (52.123, 13.988)
        }

    def test_sorted_by_plz(self) -> None:
        assert list(aggregate(parse_rows(_sample_lines()).points)) == [
            "01814",
            "10875",
            "34125",
            "76137",
        ]


class TestDistance:
    def test_known_distance(self) -> None:
        # Karlsruhe (76137) to Kassel (34125): about 270 km as the crow flies.
        assert distance_km((49.0019, 8.4287), (51.3195, 9.5163)) == pytest.approx(270, abs=10)

    def test_spread(self) -> None:
        points = parse_rows(_sample_lines()).points
        assert spread_km(points["76137"]) == 0.0
        assert spread_km(points["01814"]) == pytest.approx(7.3, abs=0.1)
        assert spread_km(points["10875"]) > 300


class TestRender:
    def test_one_plz_per_line_and_valid_json(self) -> None:
        text = render({"76137": (49.0019, 8.4287), "01814": (50.9237, 14.1486)})
        assert text == '{\n"01814":[50.9237,14.1486],\n"76137":[49.0019,8.4287]\n}\n'
        assert json.loads(text) == {"01814": [50.9237, 14.1486], "76137": [49.0019, 8.4287]}

    def test_empty(self) -> None:
        assert json.loads(render({})) == {}


class TestReadSource:
    def test_zip(self, sample_zip: Path) -> None:
        assert read_source(str(sample_zip)).splitlines() == _sample_lines()

    def test_txt(self) -> None:
        assert read_source(str(SAMPLE)).splitlines() == _sample_lines()

    def test_zip_without_de_txt(self, tmp_path: Path) -> None:
        path = tmp_path / "DE.zip"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("other.txt", "")
        with pytest.raises(SourceError, match=r"not a GeoNames DE\.zip"):
            read_source(str(path))

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(SourceError, match="cannot read"):
            read_source(str(tmp_path / "nope.zip"))

    def test_download_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fail(*args: object, **kwargs: object) -> NoReturn:
            raise urllib.error.URLError("unreachable")

        monkeypatch.setattr("urllib.request.urlopen", fail)
        with pytest.raises(SourceError, match=r"download of https://\S+ failed: .*unreachable"):
            read_source("https://download.geonames.org/export/zip/DE.zip")

    def test_download(self, monkeypatch: pytest.MonkeyPatch, sample_zip: Path) -> None:
        seen: list[urllib.request.Request] = []

        def fake_urlopen(req: urllib.request.Request, timeout: float) -> io.BytesIO:
            seen.append(req)
            return io.BytesIO(sample_zip.read_bytes())

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
        text = read_source("https://download.geonames.org/export/zip/DE.zip")
        assert text.splitlines() == _sample_lines()
        assert seen[0].get_header("User-agent", "").startswith("kaufland-extra-finder")


class TestMain:
    def test_writes_output(
        self, sample_zip: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        out = tmp_path / "web" / "public" / "plz.json"
        code = main(["--source", str(sample_zip), "--out", str(out), "--min-plz", "4"])
        assert code == EXIT_OK
        assert out.stat().st_mode & 0o777 == 0o644
        assert json.loads(out.read_text()) == {
            "01814": [50.9237, 14.1486],
            "10875": [52.5064, 13.3731],
            "34125": [51.3195, 9.5163],
            "76137": [49.0019, 8.4287],
        }
        report = capsys.readouterr().out
        assert "rows: 42, invalid: 0" in report
        assert "PLZ: 4 (2 with several rows)" in report
        assert "more than 25 km apart (1):" in report
        assert "10875 (" in report

    def test_too_few_plz_writes_nothing(self, sample_zip: Path, tmp_path: Path) -> None:
        out = tmp_path / "plz.json"
        assert main(["--source", str(sample_zip), "--out", str(out)]) == EXIT_SANITY
        assert not out.exists()

    def test_too_many_invalid_rows(self, tmp_path: Path) -> None:
        src = tmp_path / "DE.txt"
        src.write_text("\n".join([*_sample_lines(), "DE\tbroken"]) + "\n")
        out = tmp_path / "plz.json"
        assert main(["--source", str(src), "--out", str(out), "--min-plz", "1"]) == EXIT_SANITY
        assert not out.exists()

    def test_unreadable_source(self, tmp_path: Path) -> None:
        assert main(["--source", str(tmp_path / "missing.zip")]) == EXIT_ERROR
