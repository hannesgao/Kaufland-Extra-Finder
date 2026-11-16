"""HttpFetcher behaviour with `requests` stubbed out; no real network."""

from __future__ import annotations

from typing import Any

import pytest
import requests

from conftest import fixture_text
from kef_scraper.fetch import USER_AGENT, FetchError, HttpFetcher
from kef_scraper.robots import parse_rules


def _response(
    status: int, text: str = "", headers: dict[str, str] | None = None
) -> requests.Response:
    resp = requests.Response()
    resp.status_code = status
    resp._content = text.encode()
    resp.encoding = "utf-8"
    resp.headers.update(headers or {})
    return resp


class Stub:
    """Replaces `requests.Session.get`, returning queued responses and recording calls."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, *responses: requests.Response | Exception):
        self.queue = list(responses)
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.sleeps: list[float] = []
        monkeypatch.setattr(requests.Session, "get", self._get)
        monkeypatch.setattr("time.sleep", self.sleeps.append)
        monkeypatch.setattr("random.uniform", lambda a, b: 0.0)

    def _get(self, url: str, **kwargs: Any) -> requests.Response:
        self.calls.append((url, kwargs))
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _fetcher(robots: str | None = "") -> HttpFetcher:
    """A fetcher that has read `robots` as the site's robots.txt (None: has not looked yet)."""
    fetcher = HttpFetcher(delay=0.25, retries=3, backoff=2.0)
    if robots is not None:
        fetcher._rules = parse_rules(robots, USER_AGENT)
    return fetcher


def test_store_page_needs_no_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(200, "<html/>"))
    assert _fetcher().store_page("kassel-wesertor-4453") == "<html/>"
    url, kwargs = stub.calls[0]
    assert url == "https://filiale.kaufland.de/service/filiale/kassel-wesertor-4453.html"
    assert kwargs["cookies"] is None
    assert stub.sleeps == [0.25]  # politeness delay only


def test_sitemap(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(200, "<urlset/>"))
    assert _fetcher().sitemap() == "<urlset/>"
    assert stub.calls[0][0] == "https://filiale.kaufland.de/.sitemap.xml"


def test_offers_page_sends_store_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(200, "<html/>"))
    assert _fetcher().offers_page("DE4453") == "<html/>"
    url, kwargs = stub.calls[0]
    assert url == "https://filiale.kaufland.de/angebote/uebersicht.html"
    assert kwargs["cookies"] == {"x-aem-variant": "DE4453"}


def test_retries_with_exponential_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(
        monkeypatch,
        requests.ConnectionError("reset"),
        _response(503),
        _response(200, "ok"),
    )
    assert _fetcher().store_page("kassel-wesertor-4453") == "ok"
    assert len(stub.calls) == 3
    assert stub.sleeps == [0.25, 2.0, 0.25, 4.0, 0.25]


def test_honours_retry_after_with_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(
        monkeypatch,
        _response(429, headers={"Retry-After": "10"}),
        _response(429, headers={"Retry-After": "3600"}),
        _response(200, "ok"),
    )
    _fetcher().store_page("kassel-wesertor-4453")
    assert stub.sleeps == [0.25, 10.0, 0.25, 60.0, 0.25]


def test_gives_up_after_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    Stub(monkeypatch, _response(502), _response(502), _response(502))
    with pytest.raises(FetchError, match="HTTP 502"):
        _fetcher().store_page("kassel-wesertor-4453")


def test_no_retry_on_client_error(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(403))
    with pytest.raises(FetchError, match="HTTP 403"):
        _fetcher().store_page("kassel-wesertor-4453")
    assert len(stub.calls) == 1


ROBOTS_OK = "User-agent: *\nDisallow: /etc.clientlibs/\nDisallow: /angebote/naechste-woche/detail\n"


@pytest.mark.parametrize(
    "robots",
    [_response(200, ROBOTS_OK), _response(200, fixture_text("robots.txt")), _response(404)],
    ids=["allowed", "kaufland", "missing"],
)
def test_preflight_passes(monkeypatch: pytest.MonkeyPatch, robots: requests.Response) -> None:
    stub = Stub(monkeypatch, robots, _response(200, "<html/>"))
    fetcher = _fetcher(robots=None)
    fetcher.preflight()
    assert stub.calls[0][0] == "https://filiale.kaufland.de/robots.txt"
    assert fetcher.store_page("kassel-wesertor-4453") == "<html/>"


@pytest.mark.parametrize(
    "rule", ["Disallow: /", "Disallow: /*.sitemap*", "Disallow: /angebote/uebersicht"]
)
def test_preflight_respects_disallow(monkeypatch: pytest.MonkeyPatch, rule: str) -> None:
    Stub(monkeypatch, _response(200, f"User-agent: *\n{rule}\n"))
    with pytest.raises(FetchError, match=r"robots\.txt disallows"):
        _fetcher(robots=None).preflight()


@pytest.mark.parametrize("rule", ["Disallow: /service/filiale/", "Disallow: /*-4453.html$"])
def test_disallowed_store_page_is_not_requested(monkeypatch: pytest.MonkeyPatch, rule: str) -> None:
    stub = Stub(monkeypatch)
    fetcher = _fetcher(f"User-agent: *\n{rule}\n")
    with pytest.raises(FetchError, match=r"robots\.txt disallows /service/filiale/kassel"):
        fetcher.store_page("kassel-wesertor-4453")
    assert stub.calls == []


def test_nothing_is_requested_before_the_robots_check(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch)
    fetcher = _fetcher(robots=None)
    for request in (fetcher.sitemap, lambda: fetcher.offers_page("DE4453")):
        with pytest.raises(FetchError, match="preflight"):
            request()
    assert stub.calls == []


def test_pdf_download(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(200, "%PDF-1.4"))
    assert _fetcher().pdf("https://assets.leaflets.schwarz/x.pdf") == b"%PDF-1.4"
    assert stub.calls[0][1]["timeout"] == 120.0


def test_pdf_retries_with_longer_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(503), _response(200, "%PDF-1.4"))
    assert _fetcher().pdf("https://assets.leaflets.schwarz/x.pdf") == b"%PDF-1.4"
    assert stub.sleeps == [0.25, 10.0, 0.25]


def test_pdf_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("kef_scraper.fetch.MAX_PDF_BYTES", 4)
    Stub(monkeypatch, _response(200, "%PDF-1.4"))
    with pytest.raises(FetchError, match="larger than 4 bytes"):
        _fetcher().pdf("https://assets.leaflets.schwarz/x.pdf")
