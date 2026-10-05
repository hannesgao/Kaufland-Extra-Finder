"""Second check of Extra leaflets: which stores does the PDF itself name?

Page 1 of every Extra-Angebote PDF ends with a block naming the store(s) it is valid in, e.g.

    NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER
    NUR IN GÖ-WESTSTADT, ELLIEHÄUSER WEG 23 •
    GÖ-GRONE, IM KAUF PARK • GÖ-WEENDE, GROSSE BREITE 6

The block may wrap over several lines; "•" separates stores; each entry is "PLACE, LOCATION".
Kaufland serves some PDFs to stores the block does not name; those leaflets are flagged.
The code in the footer (e.g. "1_D41-H_8530_TS") does not reliably identify the store.
"""

from __future__ import annotations

import io
import logging
import re
import unicodedata
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from kef_scraper.models import Store

log = logging.getLogger(__name__)

# Bump when parsing changes, so cached results are recomputed.
PARSER_VERSION = 2

_BLOCK_START = re.compile(r"^\s*NUR IN\s+(?P<rest>.*)$")
# Footer line after the block, e.g. "1_D41-H_8530_TS kaufland.de"
_BLOCK_END = re.compile(r"^\s*\d+_[A-Z0-9]+-?[A-Z0-9]*_\d+_|kaufland\.de", re.IGNORECASE)
_MAX_BLOCK_LINES = 6
# Abbreviations seen in store blocks.
_ABBREVIATIONS = {"goe": "goettingen", "mg": "moenchengladbach", "bhv": "bremerhaven"}
_MIN_TRUNCATED = 4


class PdfCheckError(ValueError):
    """The PDF could not be read or has no store block."""


@dataclass(frozen=True, slots=True)
class PdfCheck:
    """Result for one PDF (cached per PDF id). `store_line` is None when it could not be read."""

    store_line: str | None
    error: str | None = None


def extract_store_line(pdf: bytes) -> str:
    """The whole store block after "NUR IN", on one line, e.g. "GÖ-WESTSTADT, … • GÖ-GRONE, …"."""
    try:
        reader = PdfReader(io.BytesIO(pdf))
        text = reader.pages[0].extract_text() if reader.pages else ""
    except (PdfReadError, ValueError, KeyError, IndexError) as e:
        raise PdfCheckError(f"unreadable PDF: {e}") from e
    lines = (text or "").splitlines()
    for i, line in enumerate(lines):
        m = _BLOCK_START.match(line)
        if not m:
            continue
        parts = [m["rest"]]
        for follow in lines[i + 1 : i + _MAX_BLOCK_LINES]:
            if _BLOCK_END.search(follow) or _BLOCK_START.match(follow):
                break
            parts.append(follow)
        block = " ".join(" ".join(parts).split()).strip(" •,")
        if block:
            return block
    raise PdfCheckError('no "NUR IN" line on page 1')


def check_pdf(pdf: bytes) -> PdfCheck:
    try:
        return PdfCheck(store_line=extract_store_line(pdf))
    except PdfCheckError as e:
        return PdfCheck(store_line=None, error=str(e))


def _norm(text: str) -> str:
    """Case-, accent- and spelling-insensitive form.

    "Straße" == "STRASSE" == "Str.", "Grünwinkel" == "GRUENWINKEL".
    """
    text = text.casefold().replace("ß", "ss")
    for umlaut, repl in (("ä", "ae"), ("ö", "oe"), ("ü", "ue")):
        text = text.replace(umlaut, repl)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"\bstr\b\.?", "strasse", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _tokens(text: str) -> list[str]:
    return [_ABBREVIATIONS.get(t, t) for t in _norm(text).split()]


def _entry_names_store(entry: str, store: Store) -> bool:
    place = entry.partition(",")[0]
    street = _norm(store.street)
    if street and f" {street} " in f" {_norm(entry)} ":
        return True
    place_tokens = _tokens(place)
    entry_tokens = _tokens(entry)
    # Ignore 1-2 letter fragments of truncated names ("München-Milbertshofen-Am H").
    own = [t for t in _tokens(store.name) if len(t) > 2]
    if not own or not place_tokens:
        return False
    if len(own) == 1:
        # One-word names belong to the only store in a town (otherwise Kaufland adds the district):
        # "Rastatt" == "RASTATT", "Dreieich" == "DREIEICH-SPRENDLINGEN",
        # "Eiche" == "AHRENSFELDE-EICHE".
        return own[0] in (place_tokens[0], place_tokens[-1])

    def found(token: str, last: bool) -> bool:
        if token in entry_tokens:
            return True
        # Kaufland truncates long names in its store list ("…-Beiertheim-Bulac").
        return (
            last and len(token) >= _MIN_TRUNCATED and any(u.startswith(token) for u in entry_tokens)
        )

    return all(found(t, i == len(own) - 1) for i, t in enumerate(own))


def matches_store(store_line: str, store: Store) -> bool:
    """Does the PDF's store block name this store (by street or by name)?"""
    return any(_entry_names_store(entry, store) for entry in store_line.split("•"))
