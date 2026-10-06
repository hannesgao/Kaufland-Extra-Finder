"""HttpFetcher behaviour with `requests` stubbed out; no real network."""

from __future__ import annotations

from typing import Any

import pytest
import requests

from kef_scraper.fetch import FetchError, HttpFetcher


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


def _fetcher() -> HttpFetcher:
    return HttpFetcher(delay=0.25, retries=3, backoff=2.0)


def test_leaflet_page_sends_store_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(200, "<html/>"))
    assert _fetcher().leaflet_page("DE4453") == "<html/>"
    url, kwargs = stub.calls[0]
    assert url == "https://filiale.kaufland.de/prospekte.html"
    assert kwargs["cookies"] == {"x-aem-variant": "DE4453"}
    assert stub.sleeps == [0.25]  # politeness delay only


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
    assert _fetcher().leaflet_page("DE4453") == "ok"
    assert len(stub.calls) == 3
    assert stub.sleeps == [0.25, 2.0, 0.25, 4.0, 0.25]


def test_honours_retry_after_with_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(
        monkeypatch,
        _response(429, headers={"Retry-After": "10"}),
        _response(429, headers={"Retry-After": "3600"}),
        _response(200, "ok"),
    )
    _fetcher().leaflet_page("DE4453")
    assert stub.sleeps == [0.25, 10.0, 0.25, 60.0, 0.25]


def test_gives_up_after_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    Stub(monkeypatch, _response(502), _response(502), _response(502))
    with pytest.raises(FetchError, match="HTTP 502"):
        _fetcher().leaflet_page("DE4453")


def test_no_retry_on_client_error(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Stub(monkeypatch, _response(403))
    with pytest.raises(FetchError, match="HTTP 403"):
        _fetcher().leaflet_page("DE4453")
    assert len(stub.calls) == 1


def test_store_list_invalid_json(monkeypatch: pytest.MonkeyPatch) -> None:
    Stub(monkeypatch, _response(200, "<html>maintenance</html>"))
    with pytest.raises(FetchError, match="not valid JSON"):
        _fetcher().store_list()


ROBOTS_OK = "User-agent: *\nDisallow: /etc.clientlibs/\nDisallow: /angebote/naechste-woche/detail\n"


@pytest.mark.parametrize(
    "robots",
    [_response(200, ROBOTS_OK), _response(404)],
    ids=["allowed", "missing"],
)
def test_preflight_passes(monkeypatch: pytest.MonkeyPatch, robots: requests.Response) -> None:
    stub = Stub(monkeypatch, robots)
    _fetcher().preflight()
    assert stub.calls[0][0] == "https://filiale.kaufland.de/robots.txt"


@pytest.mark.parametrize(
    "rule", ["Disallow: /", "Disallow: /prospekte.html", "Disallow: /angebote/uebersicht"]
)
def test_preflight_respects_disallow(monkeypatch: pytest.MonkeyPatch, rule: str) -> None:
    Stub(monkeypatch, _response(200, f"User-agent: *\n{rule}\n"))
    with pytest.raises(FetchError, match=r"robots\.txt disallows"):
        _fetcher().preflight()


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
