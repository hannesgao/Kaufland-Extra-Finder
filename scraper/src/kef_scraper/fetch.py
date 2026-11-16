"""Network access to filiale.kaufland.de. Everything that talks HTTP lives here."""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Protocol

import requests

from kef_scraper.robots import Rule, is_allowed, parse_rules

log = logging.getLogger(__name__)

BASE_URL = "https://filiale.kaufland.de"
SITEMAP_PATH = "/.sitemap.xml"  # named in robots.txt; lists every store page
STORE_PAGE_PATH = "/service/filiale/{slug}.html"  # store details and the store's leaflets
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

    def sitemap(self) -> str: ...

    def store_page(self, slug: str) -> str: ...

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
        self._rules: list[Rule] | None = None  # set by preflight()

    def _session(self) -> requests.Session:
        session: requests.Session | None = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "de-DE,de;q=0.9"})
            self._local.session = session
        return session

    def preflight(self) -> None:
        """Load robots.txt and abort if it disallows the fixed paths we need.

        Store pages are checked one by one when they are requested.
        """
        url = f"{self.base_url}/robots.txt"
        resp = self._get(url, accept_status=frozenset({404}))
        if resp.status_code == 404:  # no robots.txt: everything is allowed
            self._rules = []
            return
        self._rules = parse_rules(resp.text, USER_AGENT)
        for path in (SITEMAP_PATH, OFFERS_PATH):
            self._check_robots(path)

    def _check_robots(self, path: str) -> None:
        if self._rules is None:
            raise FetchError("robots.txt has not been checked; call preflight() first")
        if not is_allowed(self._rules, path):
            raise FetchError(f"robots.txt disallows {path}")

    def sitemap(self) -> str:
        self._check_robots(SITEMAP_PATH)
        return self._get(f"{self.base_url}{SITEMAP_PATH}").text

    def store_page(self, slug: str) -> str:
        path = STORE_PAGE_PATH.format(slug=slug)
        self._check_robots(path)
        return self._get(f"{self.base_url}{path}").text

    def offers_page(self, store_id: str) -> str:
        self._check_robots(OFFERS_PATH)
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
