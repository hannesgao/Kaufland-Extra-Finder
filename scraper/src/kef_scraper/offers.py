"""Offers from a store's offer overview, and which of them are trading cards.

`/angebote/uebersicht.html` (cookie `x-aem-variant=<store id>`) embeds every offer of the current
and the next week, plus announced offers ("Vorwerbung", advertised about a week before the sale),
as JSON: `window.SSR['<id>'] = {"component":"OfferTemplate","props":{...}}`. Offers differ between
stores. A store without offer data (e.g. one that is closed) has no OfferTemplate on the page.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import unicodedata
from collections.abc import Mapping
from typing import Any

from kef_scraper.models import Offer
from kef_scraper.parse import ParseError

log = logging.getLogger(__name__)

_TEMPLATE = '"component":"OfferTemplate"'
IMAGE_RENDITION = "150"  # keys of `listImageRenditions`: rendered width in px
IMAGE_RENDITION_2X = "322"

# Trading-card offers are those whose title or subtitle contains one of these (accents and case
# ignored). Only Pokémon so far: a full scan on 2026-10-06 found no other trading cards.
CARD_KEYWORDS = ("pokemon",)
# Offers that look like trading cards but match no keyword are listed in the scan report, so a
# new brand shows up before anyone misses it.
_CARD_LIKE = re.compile(
    r"sammelkart|trading ?card|\btcg\b|booster|yu-?gi-?oh|one piece|lorcana|"
    r"magic: the gathering|digimon|dragon ?ball|topps|match attax"
)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def is_card(offer: Offer) -> bool:
    text = _norm(f"{offer.title} {offer.subtitle}")
    return any(k in text for k in CARD_KEYWORDS)


def is_card_like(offer: Offer) -> bool:
    return not is_card(offer) and bool(_CARD_LIKE.search(_norm(f"{offer.title} {offer.subtitle}")))


def _date(value: object) -> dt.date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _rendition(raw: Mapping[str, Any], width: str) -> str | None:
    """Image URL in the given width: the rendition token is the query string as is."""
    image, renditions = raw.get("listImage"), raw.get("listImageRenditions")
    if not isinstance(image, str) or not image.startswith("https://"):
        return None
    token = renditions.get(width) if isinstance(renditions, dict) else None
    return f"{image}?{token}" if isinstance(token, str) and token else None


def _offer(raw: Mapping[str, Any], category: str, next_week: dt.date | None) -> Offer | None:
    kl_nr = raw.get("klNr")
    shown_from, shown_to = _date(raw.get("dateFrom")), _date(raw.get("dateTo"))
    if not isinstance(kl_nr, str) or not kl_nr or shown_from is None or shown_to is None:
        return None
    price = raw.get("formattedPrice")
    unit = raw.get("unit")
    return Offer(
        kl_nr=kl_nr,
        title=_text(raw.get("title")),
        subtitle=_text(raw.get("subtitle")),
        price=price if isinstance(price, str) and price else None,
        unit=unit if isinstance(unit, str) and unit else None,
        shown_from=shown_from,
        shown_to=shown_to,
        sales_from=_date(raw.get("salesFrom")),
        sales_to=_date(raw.get("salesTo")),
        category=category,
        week="next" if next_week and shown_from >= next_week else "current",
        thumbnail=_rendition(raw, IMAGE_RENDITION),
        thumbnail_2x=_rendition(raw, IMAGE_RENDITION_2X),
    )


def parse_offers(html: str) -> list[Offer] | None:
    """All offers on a store's offer overview, or None if the page has no offer data.

    An offer listed in several categories is returned once (key: article number + start date).
    Raises ParseError when the offer data is there but cannot be read.
    """
    start = html.find(_TEMPLATE)
    if start < 0:
        return None
    begin = html.rfind("= ", 0, start)
    if begin < 0:
        raise ParseError("offer data without assignment")
    try:
        data, _ = json.JSONDecoder().raw_decode(html, begin + 2)
        props = data["props"]
        cycles = props["offerData"]["cycles"]
    except (ValueError, KeyError, TypeError) as e:
        raise ParseError(f"unreadable offer data: {e}") from e
    week_data = props.get("weekData") or {}
    next_dates = [d for d in map(_date, week_data.get("nextWeekDates") or []) if d]
    next_week = min(next_dates) if next_dates else None
    offers: dict[tuple[str, dt.date], Offer] = {}
    for cycle in cycles:
        for category in cycle.get("categories") or []:
            name = _text(category.get("name"))
            for raw in category.get("offers") or []:
                offer = _offer(raw, name, next_week) if isinstance(raw, dict) else None
                if offer is None:
                    log.debug("skipping malformed offer in %s", name)
                    continue
                offers.setdefault((offer.kl_nr, offer.shown_from), offer)
    return list(offers.values())
