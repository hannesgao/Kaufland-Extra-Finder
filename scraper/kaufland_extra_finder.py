#!/usr/bin/env python3
"""
kaufland_extra.py — find Kaufland DE stores that currently publish an "Extra-Angebote" leaflet.

How it works (reverse-engineered from filiale.kaufland.de, Oct 2026):
  1. GET /.klstorefinder.json          -> all stores (id "DE4453", PLZ, address, ...)
  2. GET /prospekte.html with cookie x-aem-variant=<store id>
     -> server renders that store's leaflet tiles (response has `Vary: x-aem-variant`)
  3. Each tile is <div data-t-name="FlyerTile" data-subcategory=... data-aa-detail=... data-download-url=...>
     Extra leaflets have data-subcategory="Hyper1" and a title like "08.10.2026 - 14.10.2026_Extra-Angebote".
  4. Stores sharing the same PDF UUID receive the identical Extra leaflet -> "cluster".

Usage:
  pip install requests beautifulsoup4 lxml
  python kaufland_extra.py                      # full scan (~800 stores, ~1-2 min)
  python kaufland_extra.py --stores DE4453,DE4443
  python kaufland_extra.py --out data --workers 4
"""
import argparse
import csv
import datetime as dt
import json
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://filiale.kaufland.de"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
# Leaflet types every store gets; anything else is "unusual" (Extra, store opening, ...)
STANDARD_SUBS = {"KDZ1", "KDZ2", "Leaflet1", "Leaflet2", "Wrapper1", "Wrapper2"}
PDF_ID_RE = re.compile(r"/pdfs/([0-9a-f-]{36})/")

_local = threading.local()


def session() -> requests.Session:
    if not hasattr(_local, "s"):
        s = requests.Session()
        s.headers.update({"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9"})
        _local.s = s
    return _local.s


def fetch_stores() -> list[dict]:
    r = session().get(f"{BASE}/.klstorefinder.json", timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_leaflets(store_id: str, delay: float, retries: int = 3) -> list[dict] | None:
    for attempt in range(retries):
        try:
            time.sleep(delay)
            r = session().get(f"{BASE}/prospekte.html",
                              cookies={"x-aem-variant": store_id}, timeout=30)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
            tiles = []
            for t in soup.select('[data-t-name="FlyerTile"]'):
                a = t.find("a", href=True)
                pdf = t.get("data-download-url") or ""
                m = PDF_ID_RE.search(pdf)
                tiles.append({
                    "sub": t.get("data-subcategory"),
                    "title": t.get("data-aa-detail"),
                    "start": t.get("data-offer-start-date"),
                    "pdf": pdf,
                    "pdf_id": m.group(1) if m else None,
                    "viewer": a["href"] if a else None,
                })
            return tiles
        except Exception as e:  # noqa: BLE001
            print(f"  ! {store_id} attempt {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return None


def is_extra(tile: dict) -> bool:
    return (tile["sub"] or "").startswith("Hyper") or "extra" in (tile["title"] or "").lower()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.25, help="sleep before each request (per worker)")
    ap.add_argument("--stores", help="comma-separated store ids to scan instead of all")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "snapshots").mkdir(parents=True, exist_ok=True)
    today = dt.date.today().isoformat()

    stores = fetch_stores()
    if args.stores:
        wanted = set(args.stores.split(","))
        stores = [s for s in stores if s["n"] in wanted]
    print(f"Scanning {len(stores)} stores ...")

    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        results = dict(zip([s["n"] for s in stores],
                           ex.map(lambda s: fetch_leaflets(s["n"], args.delay), stores)))
    print(f"Done in {time.time() - t0:.0f}s")

    extra_rows, unusual_rows, failed = [], [], []
    for s in stores:
        tiles = results[s["n"]]
        if tiles is None:
            failed.append(s["n"])
            continue
        for t in tiles:
            row = {
                "store_id": s["n"], "name": s["cn"], "plz": s["pc"], "city": s["t"],
                "street": s["sn"], "lat": s["lat"], "lng": s["lng"],
                "sub": t["sub"], "title": t["title"], "start": t["start"],
                "pdf_id": t["pdf_id"], "pdf": t["pdf"], "viewer": t["viewer"],
            }
            if is_extra(t):
                extra_rows.append(row)
            elif t["sub"] not in STANDARD_SUBS:
                unusual_rows.append(row)

    # cluster = stores receiving the identical Extra PDF
    clusters = defaultdict(list)
    for r in extra_rows:
        clusters[r["pdf_id"]].append(r["store_id"])
    for r in extra_rows:
        r["cluster_size"] = len(clusters[r["pdf_id"]])

    # --- write outputs ---
    snap = {"scanned_at": dt.datetime.now().isoformat(timespec="seconds"),
            "store_count": len(stores), "failed": failed,
            "extra": extra_rows, "unusual": unusual_rows,
            "clusters": {k: v for k, v in clusters.items()}}
    (out / "snapshots" / f"{today}.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1))

    fields = ["store_id", "name", "plz", "city", "street", "title", "start",
              "cluster_size", "pdf_id", "pdf", "viewer", "lat", "lng"]
    with open(out / "latest_extra.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(sorted(extra_rows, key=lambda r: r["plz"]))

    # append to long-running history (one row per store per Extra leaflet)
    hist = out / "history.csv"
    new_file = not hist.exists()
    seen = set()
    if not new_file:
        with open(hist, encoding="utf-8") as f:
            seen = {(r["store_id"], r["title"]) for r in csv.DictReader(f)}
    with open(hist, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["first_seen", "store_id", "name", "plz", "title", "pdf_id", "cluster_size"])
        for r in extra_rows:
            if (r["store_id"], r["title"]) not in seen:
                w.writerow([today, r["store_id"], r["name"], r["plz"], r["title"],
                            r["pdf_id"], r["cluster_size"]])

    # --- diff against previous snapshot ---
    prev_files = sorted(p for p in (out / "snapshots").glob("*.json") if p.stem < today)
    cur_ids = {r["store_id"] for r in extra_rows}
    print(f"\nExtra leaflets: {len(extra_rows)} in {len(cur_ids)} stores, "
          f"{len(clusters)} distinct PDFs. Failed: {len(failed)}")
    if prev_files:
        prev = json.loads(prev_files[-1].read_text())
        prev_ids = {r["store_id"] for r in prev["extra"]}
        names = {s["n"]: f'{s["cn"]} ({s["pc"]})' for s in stores}
        added, removed = cur_ids - prev_ids, prev_ids - cur_ids
        print(f"vs {prev_files[-1].stem}: +{len(added)} / -{len(removed)}")
        for i in sorted(added):
            print("  +", names.get(i, i))
        for i in sorted(removed):
            print("  -", names.get(i, i))
    if unusual_rows:
        print("\nOther non-standard leaflets (store openings etc.):")
        for r in unusual_rows:
            print(f'  {r["name"]} ({r["plz"]}): {r["sub"]} {r["title"]}')


if __name__ == "__main__":
    main()