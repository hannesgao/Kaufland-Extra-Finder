"""Plain data types shared by the scraper modules."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SpecialDay:
    """A day with non-standard opening hours. `opens`/`closes` are None when the store is closed."""

    date: dt.date
    opens: str | None = None
    closes: str | None = None

    @property
    def closed(self) -> bool:
        return self.opens is None


@dataclass(frozen=True, slots=True)
class Store:
    id: str
    name: str
    plz: str
    city: str
    street: str
    lat: float
    lng: float
    special_days: tuple[SpecialDay, ...] = ()
    url: str | None = None  # the store's page on filiale.kaufland.de


@dataclass(frozen=True, slots=True)
class Tile:
    """One leaflet tile as rendered on a store's leaflet page."""

    subcategory: str | None
    title: str | None
    start: str | None
    pdf: str | None
    viewer: str | None


@dataclass(frozen=True, slots=True)
class Leaflet:
    """A validated Extra-Angebote leaflet."""

    valid_from: dt.date
    valid_to: dt.date
    cluster: str
    viewer: str
    pdf: str
    title: str


@dataclass(frozen=True, slots=True)
class Offer:
    """One offer from a store's offer overview (`/angebote/uebersicht.html`)."""

    kl_nr: str  # Kaufland article number, the `kloffer-articleID` of the offer page
    title: str
    subtitle: str
    price: str | None  # as Kaufland formats it, e.g. "55.00"
    unit: str | None
    shown_from: dt.date  # advertised on the website (for announced offers: before the sale)
    shown_to: dt.date
    sales_from: dt.date | None  # set for announced offers ("Vorwerbung"): the actual sale
    sales_to: dt.date | None
    category: str  # internal category name, e.g. "Vorwerbung"
    week: str  # "current" or "next": the week of the offer overview that lists it
    thumbnail: str | None = None  # 150 px wide
    thumbnail_2x: str | None = None  # 322 px wide


@dataclass(frozen=True, slots=True)
class StoreResult:
    store: Store
    leaflets: tuple[Leaflet, ...] = ()
    unusual: tuple[Tile, ...] = ()
    error: str | None = None
    # Offer overview (only with `--offers`): matched trading-card offers, offers that look like
    # trading cards but match no keyword, whether the page had no offer data at all (a closed
    # store), and a fetch/parse error.
    offers_scanned: bool = False
    cards: tuple[Offer, ...] = ()
    card_like: tuple[Offer, ...] = ()
    no_offer_page: bool = False
    offers_error: str | None = None


@dataclass(frozen=True, slots=True)
class ScanResult:
    results: tuple[StoreResult, ...]
    full_scan: bool
    # Store-list records that could not be parsed (they never reach `results`).
    list_errors: tuple[str, ...] = ()
    duration_s: float = 0.0
    failures: tuple[StoreResult, ...] = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "failures", tuple(r for r in self.results if r.error))

    @property
    def store_count(self) -> int:
        """Stores in Kaufland's list, including records that could not be parsed."""
        return len(self.results) + len(self.list_errors)

    @property
    def failed_count(self) -> int:
        return len(self.failures) + len(self.list_errors)

    @property
    def failure_rate(self) -> float:
        return self.failed_count / self.store_count if self.store_count else 0.0

    @property
    def extra(self) -> tuple[StoreResult, ...]:
        return tuple(r for r in self.results if r.leaflets)

    @property
    def offers_scanned(self) -> bool:
        return any(r.offers_scanned for r in self.results)

    @property
    def offers_failures(self) -> tuple[StoreResult, ...]:
        return tuple(r for r in self.results if r.offers_error)

    @property
    def no_offer_pages(self) -> tuple[StoreResult, ...]:
        return tuple(r for r in self.results if r.no_offer_page)

    @property
    def card_stores(self) -> tuple[StoreResult, ...]:
        return tuple(r for r in self.results if r.cards)
