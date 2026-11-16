"""Pure parsing of Kaufland's sitemap and store pages. No network access here."""

from __future__ import annotations

import datetime as dt
import json
import logging
import re

from bs4 import BeautifulSoup, Tag

from kef_scraper.models import Leaflet, SpecialDay, Store, StoreRef, Tile

log = logging.getLogger(__name__)

# Leaflet types every store gets; anything else is "unusual" (Extra, store opening, ...).
STANDARD_SUBCATEGORIES = frozenset({"KDZ1", "KDZ2", "Leaflet1", "Leaflet2", "Wrapper1", "Wrapper2"})

_NAME_PREFIX = "Kaufland "
_PLZ_RE = re.compile(r"\d{5}")
# Generous bounding box around Germany; catches swapped or zeroed coordinates.
_LAT_RANGE = (47.0, 55.5)
_LNG_RANGE = (5.5, 15.5)
_PDF_ID_RE = re.compile(r"/pdfs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/")
STORE_PAGE_BASE = "https://filiale.kaufland.de/service/filiale/"
_LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
# e.g. `kassel-wesertor-4453.html`; the number is the store id without its country prefix.
_STORE_PAGE_RE = re.compile(r"(?P<slug>[a-z0-9]+(?:-+[a-z0-9]+)*?-+(?P<number>\d{4}))\.html")
_SPECIAL_DAY_RE = re.compile(
    r"(?P<date>\d{4}-\d{2}-\d{2})\|(?P<opens>\d{2}:\d{2})\|(?P<closes>\d{2}:\d{2})"
)
_VALIDITY_RE = re.compile(
    r"^(?P<d1>\d{2})\.(?P<m1>\d{2})\.(?P<y1>\d{4})\s*-\s*(?P<d2>\d{2})\.(?P<m2>\d{2})\.(?P<y2>\d{4})_"
)


class ParseError(ValueError):
    """Raised when Kaufland's data does not have the expected shape."""


def parse_sitemap(xml: str) -> tuple[list[StoreRef], list[str]]:
    """Find the store pages in the sitemap.

    Returns the stores and one error message per store page address that does not have the
    expected form. Those count as failures in the sanity check instead of aborting the scan.
    """
    refs: dict[str, StoreRef] = {}
    errors: list[str] = []
    for url in _LOC_RE.findall(xml):
        if not url.startswith(STORE_PAGE_BASE):
            continue
        m = _STORE_PAGE_RE.fullmatch(url.removeprefix(STORE_PAGE_BASE))
        if m is None:
            errors.append(f"sitemap: unexpected store page address {url!r}")
            continue
        ref = StoreRef(id=f"DE{m['number']}", slug=m["slug"])
        if refs.setdefault(ref.id, ref) != ref:
            errors.append(f"sitemap: {ref.id} is listed as {refs[ref.id].slug} and {ref.slug}")
    return list(refs.values()), errors


def parse_store_page(html: str, ref: StoreRef) -> tuple[Store, list[Tile]]:
    """Read the store's details and its leaflet tiles from its page."""
    soup = BeautifulSoup(html, "lxml")
    details = soup.select_one('[data-t-name="StoreDetails"]')
    info = soup.select_one('[data-t-name="StoreInfo"]')
    if details is None or info is None:
        raise ParseError(f"{ref.id}: no store details on the page")
    sid = _attr(details, "data-force-store-change")
    if sid != ref.id:
        raise ParseError(f"{ref.id}: the page is for store {sid!r}")
    name, plz = _prop(info, sid, "name"), _prop(info, sid, "postalCode")
    city, street = _prop(info, sid, "addressLocality"), _prop(info, sid, "streetAddress")
    try:
        lat, lng = float(_attr(info, "data-lat") or ""), float(_attr(info, "data-lng") or "")
    except ValueError as e:
        raise ParseError(f"store {sid}: invalid coordinates") from e
    if not _PLZ_RE.fullmatch(plz):
        raise ParseError(f"store {sid}: invalid PLZ {plz!r}")
    if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LNG_RANGE[0] <= lng <= _LNG_RANGE[1]):
        raise ParseError(f"store {sid}: coordinates {lat},{lng} outside Germany")
    store = Store(
        id=sid,
        name=name.removeprefix(_NAME_PREFIX),
        plz=plz,
        city=city,
        street=street,
        lat=lat,
        lng=lng,
        special_days=parse_special_days(sid, _special_opening_days(sid, info)),
        url=f"{STORE_PAGE_BASE}{ref.slug}.html",
    )
    return store, _tiles(soup)


def _prop(info: Tag, store_id: str, name: str) -> str:
    """The `content` of a schema.org microdata property of the store."""
    el = info.select_one(f'[itemprop="{name}"]')
    value = _attr(el, "content") if el is not None else None
    if not value:
        raise ParseError(f"store {store_id}: missing field {name!r}")
    return value


def _special_opening_days(store_id: str, info: Tag) -> object:
    """The `specialOpeningDay` list of the opening-hours data, None if the page has none."""
    script = info.select_one("script.m-store-open-status__data")
    if script is None:
        return None
    try:
        data = json.loads(script.get_text())
    except ValueError:
        log.warning("%s: ignoring unreadable opening hours", store_id)
        return None
    return data.get("specialOpeningDay") if isinstance(data, dict) else None


def parse_special_days(store_id: str, raw: object) -> tuple[SpecialDay, ...]:
    """Parse the special opening days (`YYYY-MM-DD|HH:MM|HH:MM`, `00:00|00:00` = closed).

    This is supplementary information, so malformed entries are logged and skipped instead of
    failing the store.
    """
    if raw is None:
        return ()
    if not isinstance(raw, list):
        log.warning("%s: ignoring special opening days of type %s", store_id, type(raw).__name__)
        return ()
    days: dict[dt.date, SpecialDay] = {}
    for entry in raw:
        m = _SPECIAL_DAY_RE.fullmatch(entry) if isinstance(entry, str) else None
        try:
            if m is None:
                raise ValueError("unexpected format")
            day = dt.date.fromisoformat(m["date"])
            opens, closes = _valid_time(m["opens"]), _valid_time(m["closes"])
        except ValueError as e:
            log.warning("%s: ignoring special opening day %r: %s", store_id, entry, e)
            continue
        closed = opens == closes == "00:00"
        days[day] = SpecialDay(day) if closed else SpecialDay(day, opens, closes)
    return tuple(days[d] for d in sorted(days))


def _valid_time(value: str) -> str:
    dt.time.fromisoformat(value)  # raises ValueError for e.g. 25:00
    return value


def _attr(tag: Tag, name: str) -> str | None:
    value = tag.get(name)
    if value is None:
        return None
    return value if isinstance(value, str) else " ".join(value)


def parse_tiles(html: str) -> list[Tile]:
    """Extract all leaflet tiles from a page."""
    return _tiles(BeautifulSoup(html, "lxml"))


def _tiles(soup: BeautifulSoup) -> list[Tile]:
    tiles = []
    for el in soup.select('[data-t-name="FlyerTile"]'):
        link = el.find("a", href=True)
        tiles.append(
            Tile(
                subcategory=_attr(el, "data-subcategory"),
                title=_attr(el, "data-aa-detail"),
                start=_attr(el, "data-offer-start-date"),
                pdf=_attr(el, "data-download-url"),
                viewer=_attr(link, "href") if isinstance(link, Tag) else None,
            )
        )
    return tiles


def is_extra(tile: Tile) -> bool:
    sub = tile.subcategory or ""
    return sub.startswith("Hyper") or "extra" in (tile.title or "").lower()


def is_standard(tile: Tile) -> bool:
    return tile.subcategory in STANDARD_SUBCATEGORIES


def parse_validity(title: str) -> tuple[dt.date, dt.date]:
    """Parse `dd.mm.yyyy - dd.mm.yyyy_<name>` into (valid_from, valid_to)."""
    m = _VALIDITY_RE.match(title)
    if not m:
        raise ParseError(f"cannot parse validity from title {title!r}")
    try:
        start = dt.date(int(m["y1"]), int(m["m1"]), int(m["d1"]))
        end = dt.date(int(m["y2"]), int(m["m2"]), int(m["d2"]))
    except ValueError as e:
        raise ParseError(f"invalid date in title {title!r}: {e}") from e
    if end < start:
        raise ParseError(f"validity ends before it starts in title {title!r}")
    return start, end


def pdf_id(url: str) -> str | None:
    m = _PDF_ID_RE.search(url)
    return m.group(1) if m else None


def to_leaflet(tile: Tile) -> Leaflet:
    """Validate an Extra tile and convert it into a `Leaflet`."""
    if not tile.title:
        raise ParseError("Extra tile without title")
    valid_from, valid_to = parse_validity(tile.title)
    if tile.start and tile.start != valid_from.isoformat():
        raise ParseError(
            f"start date {tile.start} does not match title {tile.title!r}",
        )
    if not tile.pdf:
        raise ParseError(f"Extra tile {tile.title!r} has no PDF URL")
    cluster = pdf_id(tile.pdf)
    if cluster is None:
        raise ParseError(f"no PDF id in URL {tile.pdf!r}")
    if not tile.viewer:
        raise ParseError(f"Extra tile {tile.title!r} has no viewer link")
    return Leaflet(
        valid_from=valid_from,
        valid_to=valid_to,
        cluster=cluster,
        viewer=tile.viewer,
        pdf=tile.pdf,
        title=tile.title,
    )
