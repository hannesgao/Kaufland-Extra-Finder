from __future__ import annotations

import html
import json
import socket
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, NoReturn

import pytest

from kef_scraper.fetch import FetchError
from kef_scraper.models import Store, StoreRef
from kef_scraper.parse import STORE_PAGE_BASE, parse_store_page

FIXTURES = Path(__file__).parent / "fixtures"


# The leaflets of a store with only standard ones; much cheaper to parse than a real fixture,
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


def store_ref(record: Mapping[str, Any]) -> StoreRef:
    return StoreRef(id=str(record["n"]), slug=str(record["friendlyUrl"]))


def sample_refs() -> dict[str, StoreRef]:
    return {ref.id: ref for ref in map(store_ref, store_list_sample())}


def sample_stores() -> dict[str, Store]:
    """The sample stores as the scraper reads them from their pages."""
    records = {str(r["n"]): r for r in store_list_sample()}
    return {
        sid: parse_store_page(store_page(records[sid]), ref)[0]
        for sid, ref in sample_refs().items()
    }


def store_page(record: Mapping[str, Any], leaflets: str = "") -> str:
    """A store page with the markup the scraper reads, filled from a store record.

    `leaflets` is the page's leaflet section: a fragment or a whole document, whose body then
    gets the store details in front.
    """

    def attr(key: str) -> str:
        return html.escape(str(record[key]), quote=True) if key in record else ""

    def prop(name: str, key: str) -> str:
        return f'<span itemprop="{name}" content="{attr(key)}"></span>' if key in record else ""

    hours = json.dumps({"specialOpeningDay": record.get("sod") or [], "weekdayOpeningDay": []})
    details = (
        f'<div data-t-name="StoreDetails" data-force-store-change="{attr("n")}">'
        f'<div data-t-name="StoreInfo" data-lat="{attr("lat")}" data-lng="{attr("lng")}">'
        + prop("name", "cn")
        + prop("streetAddress", "sn")
        + prop("addressLocality", "t")
        + prop("postalCode", "pc")
        + f'<script class="m-store-open-status__data" type="application/json">{hours}</script>'
        "</div></div>"
    )
    if "<body>" in leaflets:
        return leaflets.replace("<body>", f"<body>{details}", 1)
    return f"<html><body>{details}{leaflets}</body></html>"


def sitemap(records: list[dict[str, Any]]) -> str:
    urls = "".join(
        f"<url><loc>{STORE_PAGE_BASE}{r['friendlyUrl']}.html</loc></url>" for r in records
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset>{urls}</urlset>'


class FakeFetcher:
    """Offline stand-in for `HttpFetcher`.

    `stores` are store records (see `store_list_sample`); the sitemap and the store pages are
    made from them. `pages` holds each store's leaflet section by store id.
    """

    def __init__(
        self,
        stores: list[dict[str, Any]] | Exception,
        pages: Mapping[str, str | Exception],
        default: str | Exception | None = None,
        pdfs: Mapping[str, bytes | Exception] | None = None,
        offer_pages: Mapping[str, str | Exception] | None = None,
        offer_default: str | Exception | None = None,
    ) -> None:
        self._stores = stores
        self._pages = dict(pages)
        self._default = default
        self._pdfs = dict(pdfs or {})
        self._offer_pages = dict(offer_pages or {})
        self._offer_default = offer_default
        self.requested: list[str] = []
        self.pdf_requests: list[str] = []
        self.offer_requests: list[str] = []

    def preflight(self) -> None:
        return None

    def sitemap(self) -> str:
        if isinstance(self._stores, Exception):
            raise self._stores
        return sitemap(self._stores)

    def store_page(self, slug: str) -> str:
        assert not isinstance(self._stores, Exception)
        record = next(r for r in self._stores if r["friendlyUrl"] == slug)
        store_id = str(record["n"])
        self.requested.append(store_id)
        page = self._pages.get(store_id, self._default)
        if page is None:
            raise FetchError(f"no fixture for {store_id}")
        if isinstance(page, Exception):
            raise page
        return store_page(record, page)

    def offers_page(self, store_id: str) -> str:
        self.offer_requests.append(store_id)
        page = self._offer_pages.get(store_id, self._offer_default)
        if page is None:
            raise FetchError(f"no offer page fixture for {store_id}")
        if isinstance(page, Exception):
            raise page
        return page

    def pdf(self, url: str) -> bytes:
        self.pdf_requests.append(url)
        pdf = self._pdfs.get(url)
        if pdf is None:
            raise FetchError(f"no PDF fixture for {url}")
        if isinstance(pdf, Exception):
            raise pdf
        return pdf


# An offer overview without offer data, as for a closed store.
NO_OFFERS_PAGE = "<html><body><div class='m-offer-tile-empty'></div></body></html>"


@pytest.fixture
def offer_page() -> str:
    return fixture_text("angebote_DE4443.html")


@pytest.fixture
def pages() -> dict[str, str]:
    return {sid: fixture_text(f"prospekte_{sid}.html") for sid in ("DE4453", "DE8530", "DE1300")}


@pytest.fixture
def make_store_record() -> Callable[[str], dict[str, Any]]:
    template = store_list_sample()[0]

    def make(store_id: str) -> dict[str, Any]:
        return {
            **template,
            "n": store_id,
            "cn": f"Kaufland Test {store_id}",
            "friendlyUrl": f"test-{store_id[2:]}",
        }

    return make


def make_pdf(lines: list[str]) -> bytes:
    """A minimal one-page PDF with the given text lines (Helvetica, WinAnsi), for PDF checks."""

    def esc(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stream = "BT /F1 10 Tf 12 TL 40 800 Td " + " ".join(f"({esc(t)}) Tj T*" for t in lines) + " ET"
    body = stream.encode("cp1252")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)
