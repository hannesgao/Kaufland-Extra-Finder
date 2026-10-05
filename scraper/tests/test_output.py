from __future__ import annotations

import copy
import datetime as dt
from pathlib import Path
from typing import Any

import pytest

from kef_scraper.models import ScanResult
from kef_scraper.output import (
    HISTORY_FIELDS,
    diff_extra,
    read_history,
    render_history,
    render_summary_md,
    update_history,
    write_text_atomic,
)

TODAY = dt.date(2026, 10, 6)


def _extra(*stores: tuple[str, list[tuple[str, str]]]) -> dict[str, Any]:
    """Minimal extra.json: (store id, [(cluster, valid_from), ...])."""
    clusters: dict[str, list[str]] = {}
    out = []
    for sid, leaflets in stores:
        for cluster, _ in leaflets:
            clusters.setdefault(cluster, []).append(sid)
        out.append(
            {
                "id": sid,
                "name": f"Store {sid}",
                "plz": "76137",
                "leaflets": [
                    {
                        "valid_from": vf,
                        "valid_to": "2026-10-14",
                        "cluster": c,
                        "viewer": "",
                        "pdf": "",
                    }
                    for c, vf in leaflets
                ],
            }
        )
    return {
        "schema_version": 1,
        "generated_at": "2026-10-05T06:30:00+02:00",
        "stores": out,
        "clusters": clusters,
    }


class TestWriteAtomic:
    def test_creates_parents_and_replaces(self, tmp_path: Path) -> None:
        target = tmp_path / "a" / "b.json"
        write_text_atomic(target, "one")
        write_text_atomic(target, "two")
        assert target.read_text() == "two"
        assert [p.name for p in target.parent.iterdir()] == ["b.json"]


class TestHistory:
    def test_appends_only_new_rows(self) -> None:
        first = update_history([], _extra(("DE1", [("c1", "2026-10-08")])), TODAY)
        assert first == [
            {
                "first_seen": "2026-10-06",
                "store_id": "DE1",
                "name": "Store DE1",
                "plz": "76137",
                "valid_from": "2026-10-08",
                "valid_to": "2026-10-14",
                "cluster": "c1",
                "cluster_size": "1",
            }
        ]
        later = dt.date(2026, 10, 9)
        extra = _extra(
            ("DE1", [("c1", "2026-10-08"), ("c2", "2026-10-15")]), ("DE2", [("c2", "2026-10-15")])
        )
        second = update_history(first, extra, later)
        assert second[0] == first[0]
        assert [
            (r["store_id"], r["cluster"], r["first_seen"], r["cluster_size"]) for r in second[1:]
        ] == [
            ("DE1", "c2", "2026-10-09", "2"),
            ("DE2", "c2", "2026-10-09", "2"),
        ]

    def test_roundtrip(self, tmp_path: Path) -> None:
        rows = update_history([], _extra(("DE1", [("c1", "2026-10-08")])), TODAY)
        path = tmp_path / "history.csv"
        path.write_text(render_history(rows))
        assert path.read_text().splitlines()[0] == ",".join(HISTORY_FIELDS)
        assert read_history(path) == rows

    def test_missing_file(self, tmp_path: Path) -> None:
        assert read_history(tmp_path / "history.csv") == []

    def test_unexpected_columns(self, tmp_path: Path) -> None:
        path = tmp_path / "history.csv"
        path.write_text("first_seen,store_id,name,plz,title,pdf_id,cluster_size\n")
        with pytest.raises(ValueError, match="unexpected columns"):
            read_history(path)


class TestDiff:
    def test_added_and_removed(self) -> None:
        before = _extra(("DE1", [("c1", "2026-10-01")]), ("DE2", [("c2", "2026-10-01")]))
        after = _extra(
            ("DE1", [("c1", "2026-10-01"), ("c3", "2026-10-08")]), ("DE3", [("c3", "2026-10-08")])
        )
        diff = diff_extra(before, after)
        assert diff is not None
        assert [(c.store_id, c.cluster) for c in diff.added] == [("DE1", "c3"), ("DE3", "c3")]
        assert [(c.store_id, c.cluster) for c in diff.removed] == [("DE2", "c2")]
        assert diff.stores_added == {"DE3"}
        assert diff.stores_removed == {"DE2"}
        assert diff.previous_generated_at == "2026-10-05T06:30:00+02:00"

    def test_no_change(self) -> None:
        extra = _extra(("DE1", [("c1", "2026-10-01")]))
        diff = diff_extra(copy.deepcopy(extra), extra)
        assert diff is not None
        assert (diff.added, diff.removed) == ((), ())

    @pytest.mark.parametrize(
        "previous", [None, {"stores": []}, {"schema_version": 0, "stores": []}]
    )
    def test_no_comparable_previous(self, previous: dict[str, Any] | None) -> None:
        assert diff_extra(previous, _extra()) is None


class TestSummary:
    def test_rejected_scan(self) -> None:
        result = ScanResult(results=(), full_scan=True)
        md = render_summary_md(
            result, _extra(), None, ["only 0 stores in the store list (minimum 700)"]
        )
        assert md.startswith("## ❌ Scan rejected\n")
        assert "- **only 0 stores in the store list (minimum 700)**" in md
