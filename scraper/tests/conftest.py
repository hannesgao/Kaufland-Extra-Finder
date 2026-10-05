from __future__ import annotations

import json
import socket
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, NoReturn

import pytest

from kef_scraper.fetch import FetchError

FIXTURES = Path(__file__).parent / "fixtures"


# A store page with only standard leaflets; much cheaper to parse than a real fixture,
# which matters when filling a scan up to the 700-store minimum.
MINIMAL_PAGE = (
    '<html><body><div data-t-name="FlyerTile" data-subcategory="KDZ1" '
    'data-aa-detail="01.10.2026 - 07.10.2026_Prospekt"></div></body></html>'
)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any test that tries to open a network connection."""

    def guard(*args: object, **kwargs: object) -> NoReturn:
        raise RuntimeError("network access is not allowed in tests")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket.socket, "connect_ex", guard)
    monkeypatch.setattr(socket, "create_connection", guard)
    monkeypatch.setattr(socket, "getaddrinfo", guard)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def store_list_sample() -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads(fixture_text("klstorefinder_sample.json"))
    return data


class FakeFetcher:
    """Offline stand-in for `HttpFetcher`, serving fixtures."""

    def __init__(
        self,
        stores: object,
        pages: Mapping[str, str | Exception],
        default: str | Exception | None = None,
    ) -> None:
        self._stores = stores
        self._pages = dict(pages)
        self._default = default
        self.requested: list[str] = []

    def preflight(self) -> None:
        return None

    def store_list(self) -> object:
        return self._stores

    def leaflet_page(self, store_id: str) -> str:
        self.requested.append(store_id)
        page = self._pages.get(store_id, self._default)
        if page is None:
            raise FetchError(f"no fixture for {store_id}")
        if isinstance(page, Exception):
            raise page
        return page


@pytest.fixture
def pages() -> dict[str, str]:
    return {sid: fixture_text(f"prospekte_{sid}.html") for sid in ("DE4453", "DE8530", "DE1300")}


@pytest.fixture
def make_store_record() -> Callable[[str], dict[str, Any]]:
    template = store_list_sample()[0]

    def make(store_id: str) -> dict[str, Any]:
        return {**template, "n": store_id, "cn": f"Kaufland Test {store_id}"}

    return make
