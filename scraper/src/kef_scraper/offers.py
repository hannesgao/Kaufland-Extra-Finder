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
from dataclasses import replace
from typing import Any

from kef_scraper.models import Offer
from kef_scraper.parse import ParseError

log = logging.getLogger(__name__)

_TEMPLATE = '"component":"OfferTemplate"'
IMAGE_RENDITION = "150"  # keys of `listImageRenditions`: rendered width in px
IMAGE_RENDITION_2X = "322"

# Display name of the category with the offers of a store's Extra leaflet. Every store has a few
# offers in it (bakery); stores named in an Extra PDF had about 35 (2026-10-06 and 2026-11-12).
EXTRA_SECTION = "Extra-Angebote"

# Trading-card offers are those whose title or subtitle contains one of these brands AND says that
# it is a card product, and that are not an accessory (accents and case ignored):
# "KINDER Adventskalender »Pokémon«" is chocolate with stickers (2026-10-11) and
# "AK TRADE Sammelkarten-Album Pokémon" is an album for cards (2026-11-01), neither is cards.
# Only Pokémon so far: a full scan on 2026-10-06 found no other cards.
CARD_KEYWORDS = ("pokemon",)
_CARD_PRODUCT = re.compile(r"sammelkart|kartenspiel|booster|trading ?card|\btcg\b")
_ACCESSORY = re.compile(
    r"album|ordner|mappe|sleeve|hulle|binder|portfolio|aufbewahrung|deck ?box|spielmatte|playmat"
)
# Offers that may be trading cards but are not listed are named in the scan report, so a new brand
# or a card product with unusual wording shows up before anyone misses it: card wording without a
# brand keyword, another card brand, a brand keyword without card wording, or an accessory.
_OTHER_CARD_BRANDS = re.compile(
    r"yu-?gi-?oh|one piece|lorcana|magic: the gathering|digimon|dragon ?ball|topps|match attax"
)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def _card_text(offer: Offer) -> str:
    return _norm(f"{offer.title} {offer.subtitle}")


def _has_brand(text: str) -> bool:
    return any(k in text for k in CARD_KEYWORDS)


def _is_card_text(text: str) -> bool:
    return _has_brand(text) and bool(_CARD_PRODUCT.search(text)) and not _ACCESSORY.search(text)


def is_card(offer: Offer) -> bool:
    return _is_card_text(_card_text(offer))


def is_card_like(offer: Offer) -> bool:
    text = _card_text(offer)
    if _is_card_text(text):
        return False
    return _has_brand(text) or bool(_CARD_PRODUCT.search(text) or _OTHER_CARD_BRANDS.search(text))


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


def is_extra_offer(offer: Offer) -> bool:
    return EXTRA_SECTION in offer.sections


def _offer(
    raw: Mapping[str, Any], category: str, section: str, next_week: dt.date | None
) -> Offer | None:
    kl_nr = raw.get("klNr")
    shown_from, shown_to = _date(raw.get("dateFrom")), _date(raw.get("dateTo"))
    if not isinstance(kl_nr, str) or not kl_nr or shown_from is None or shown_to is None:
        return None
    price = raw.get("formattedPrice")
    unit = raw.get("unit")
    old_price = raw.get("formattedOldPrice")
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
        old_price=old_price if isinstance(old_price, str) and old_price else None,
        sections=(section,) if section else (),
    )


def parse_offers(html: str) -> list[Offer] | None:
    """All offers on a store's offer overview, or None if the page has no offer data.

    An offer listed in several categories is returned once (key: article number + start date),
    with the first category's data and the display names of all of them in `sections`.
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
            section = _text(category.get("displayName"))
            for raw in category.get("offers") or []:
                offer = _offer(raw, name, section, next_week) if isinstance(raw, dict) else None
                if offer is None:
                    log.debug("skipping malformed offer in %s", name)
                    continue
                key = (offer.kl_nr, offer.shown_from)
                first = offers.setdefault(key, offer)
                if section and section not in first.sections:
                    offers[key] = replace(first, sections=(*first.sections, section))
    return list(offers.values())
