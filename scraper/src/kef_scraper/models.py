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
class StoreResult:
    store: Store
    leaflets: tuple[Leaflet, ...] = ()
    unusual: tuple[Tile, ...] = ()
    error: str | None = None


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
