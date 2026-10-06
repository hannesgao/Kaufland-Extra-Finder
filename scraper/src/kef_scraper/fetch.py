"""Network access to filiale.kaufland.de. Everything that talks HTTP lives here."""

from __future__ import annotations

import logging
import random
import threading
import time
import urllib.robotparser
from typing import Protocol

import requests

log = logging.getLogger(__name__)

BASE_URL = "https://filiale.kaufland.de"
STORE_LIST_PATH = "/.klstorefinder.json"
LEAFLET_PATH = "/prospekte.html"
OFFERS_PATH = "/angebote/uebersicht.html"  # ~400 KB compressed, ~5 MB of HTML per store
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0 Safari/537.36"
)
MAX_WORKERS = 4
MAX_PDF_BYTES = 50_000_000  # Extra PDFs are ~6 MB
PDF_TIMEOUT_S = 120.0
PDF_BACKOFF_S = 10.0  # the PDF CDN needs longer to recover from a 503 than the store pages
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
_MAX_RETRY_AFTER_S = 60.0


class FetchError(RuntimeError):
    """A request failed permanently (after retries, or with a non-retryable status)."""


class Fetcher(Protocol):
    """What the scanner needs from the network. Tests provide an offline implementation."""

    def preflight(self) -> None: ...

    def store_list(self) -> object: ...

    def leaflet_page(self, store_id: str) -> str: ...

    def offers_page(self, store_id: str) -> str: ...

    def pdf(self, url: str) -> bytes: ...


class HttpFetcher:
    """Polite HTTP client: per-request delay, retries with exponential backoff, robots.txt check."""

    def __init__(
        self,
        *,
        delay: float = 0.25,
        retries: int = 3,
        timeout: float = 30.0,
        backoff: float = 2.0,
        base_url: str = BASE_URL,
    ) -> None:
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self.backoff = backoff
        self.base_url = base_url
        self._local = threading.local()

    def _session(self) -> requests.Session:
        session: requests.Session | None = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "de-DE,de;q=0.9"})
            self._local.session = session
        return session

    def preflight(self) -> None:
        """Abort if robots.txt disallows the paths we need."""
        url = f"{self.base_url}/robots.txt"
        resp = self._get(url, accept_status=frozenset({404}))
        if resp.status_code == 404:  # no robots.txt: everything is allowed
            return
        parser = urllib.robotparser.RobotFileParser(url)
        parser.parse(resp.text.splitlines())
        for path in (STORE_LIST_PATH, LEAFLET_PATH, OFFERS_PATH):
            if not parser.can_fetch(USER_AGENT, f"{self.base_url}{path}"):
                raise FetchError(f"robots.txt disallows {path}")

    def store_list(self) -> object:
        resp = self._get(f"{self.base_url}{STORE_LIST_PATH}")
        try:
            return resp.json()
        except ValueError as e:
            raise FetchError(f"store list is not valid JSON: {e}") from e

    def leaflet_page(self, store_id: str) -> str:
        resp = self._get(f"{self.base_url}{LEAFLET_PATH}", cookies={"x-aem-variant": store_id})
        return resp.text

    def offers_page(self, store_id: str) -> str:
        resp = self._get(f"{self.base_url}{OFFERS_PATH}", cookies={"x-aem-variant": store_id})
        return resp.text

    def pdf(self, url: str) -> bytes:
        resp = self._get(url, timeout=PDF_TIMEOUT_S, backoff=PDF_BACKOFF_S)
        if len(resp.content) > MAX_PDF_BYTES:
            raise FetchError(f"{url}: PDF larger than {MAX_PDF_BYTES} bytes")
        return resp.content

    def _get(
        self,
        url: str,
        cookies: dict[str, str] | None = None,
        accept_status: frozenset[int] = frozenset(),
        timeout: float | None = None,
        backoff: float | None = None,
    ) -> requests.Response:
        last_error = "no attempt made"
        for attempt in range(1, self.retries + 1):
            time.sleep(self.delay)
            wait = (backoff or self.backoff) * 2 ** (attempt - 1) + random.uniform(0, 0.5)  # noqa: S311
            try:
                resp = self._session().get(url, cookies=cookies, timeout=timeout or self.timeout)
            except requests.RequestException as e:
                last_error = f"{type(e).__name__}: {e}"
            else:
                if resp.ok or resp.status_code in accept_status:
                    return resp
                last_error = f"HTTP {resp.status_code}"
                if resp.status_code not in _RETRY_STATUS:
                    break
                wait = max(wait, _retry_after(resp))
            if attempt < self.retries:
                log.warning("%s (cookies=%s) attempt %d: %s", url, cookies, attempt, last_error)
                time.sleep(wait)
        raise FetchError(f"GET {url} failed: {last_error}")


def _retry_after(resp: requests.Response) -> float:
    value = resp.headers.get("Retry-After", "")
    try:
        return min(float(value), _MAX_RETRY_AFTER_S)
    except ValueError:
        return 0.0
