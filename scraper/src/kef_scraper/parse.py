"""Pure parsing of Kaufland's store list and leaflet pages. No network access here."""

from __future__ import annotations

import datetime as dt
import logging
import re

from bs4 import BeautifulSoup, Tag

from kef_scraper.models import Leaflet, SpecialDay, Store, Tile

log = logging.getLogger(__name__)

# Leaflet types every store gets; anything else is "unusual" (Extra, store opening, ...).
STANDARD_SUBCATEGORIES = frozenset({"KDZ1", "KDZ2", "Leaflet1", "Leaflet2", "Wrapper1", "Wrapper2"})

_NAME_PREFIX = "Kaufland "
_PLZ_RE = re.compile(r"\d{5}")
# Generous bounding box around Germany; catches swapped or zeroed coordinates.
_LAT_RANGE = (47.0, 55.5)
_LNG_RANGE = (5.5, 15.5)
_PDF_ID_RE = re.compile(r"/pdfs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/")
_SPECIAL_DAY_RE = re.compile(
    r"(?P<date>\d{4}-\d{2}-\d{2})\|(?P<opens>\d{2}:\d{2})\|(?P<closes>\d{2}:\d{2})"
)
_VALIDITY_RE = re.compile(
    r"^(?P<d1>\d{2})\.(?P<m1>\d{2})\.(?P<y1>\d{4})\s*-\s*(?P<d2>\d{2})\.(?P<m2>\d{2})\.(?P<y2>\d{4})_"
)


class ParseError(ValueError):
    """Raised when Kaufland's data does not have the expected shape."""


def parse_stores(raw: object) -> tuple[list[Store], list[str]]:
    """Convert the `.klstorefinder.json` payload into stores.

    Returns the valid stores and one error message per invalid record. Invalid records count as
    failures in the sanity check instead of aborting the whole scan.
    """
    if not isinstance(raw, list):
        raise ParseError(f"store list: expected a JSON array, got {type(raw).__name__}")
    stores: list[Store] = []
    errors: list[str] = []
    for i, rec in enumerate(raw):
        try:
            stores.append(_parse_store(i, rec))
        except ParseError as e:
            errors.append(str(e))
    return stores, errors


def _parse_store(index: int, rec: object) -> Store:
    if not isinstance(rec, dict):
        raise ParseError(f"store #{index}: expected an object, got {type(rec).__name__}")
    try:
        sid, name, plz = str(rec["n"]), str(rec["cn"]), str(rec["pc"])
        city, street = str(rec["t"]), str(rec["sn"])
        lat, lng = float(rec["lat"]), float(rec["lng"])
    except KeyError as e:
        raise ParseError(f"store #{index}: missing field {e}") from e
    except (TypeError, ValueError) as e:
        raise ParseError(f"store #{index} ({rec.get('n')}): invalid coordinates") from e
    if not _PLZ_RE.fullmatch(plz):
        raise ParseError(f"store {sid}: invalid PLZ {plz!r}")
    if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LNG_RANGE[0] <= lng <= _LNG_RANGE[1]):
        raise ParseError(f"store {sid}: coordinates {lat},{lng} outside Germany")
    return Store(
        id=sid,
        name=name.removeprefix(_NAME_PREFIX),
        plz=plz,
        city=city,
        street=street,
        lat=lat,
        lng=lng,
        special_days=parse_special_days(sid, rec.get("sod")),
    )


def parse_special_days(store_id: str, raw: object) -> tuple[SpecialDay, ...]:
    """Parse the optional `sod` field (`YYYY-MM-DD|HH:MM|HH:MM`, `00:00|00:00` = closed).

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
    """Extract all leaflet tiles from a store's `prospekte.html`."""
    soup = BeautifulSoup(html, "lxml")
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
