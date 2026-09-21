#!/usr/bin/env python3
import json, pathlib, re, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from html import unescape

STATION = "059122"
AEST = timezone(timedelta(hours=10))
OUT = pathlib.Path("data/bellbrook-history.json")
BOM_URL = "https://www.bom.gov.au/fwo/IDN60232/IDN60232.059122.tbl.shtml"
MIRROR_URL = "https://australiademo.opendatasoft.com/api/explore/v2.1/catalog/datasets/bom-river-heights-data/records?" + urllib.parse.urlencode({
    "where": f'station_id="{STATION}"', "order_by": "datetime DESC", "limit": 100
})

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Bellbrook-Floodwatch/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def bom_rows():
    page = get(BOM_URL).decode("iso-8859-1", "replace")
    rows = []
    pattern = re.compile(
        r'<tr[^>]*>\s*<td[^>]*>\s*(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2})\s*</td>'
        r'\s*<td[^>]*>\s*(-?\d+(?:\.\d+)?)\s*</td>\s*</tr>',
        re.I
    )
    for stamp_text, height_text in pattern.findall(page):
        stamp = datetime.strptime(stamp_text, "%d/%m/%Y %H:%M").replace(tzinfo=AEST)
        rows.append({
            "station_id": STATION,
            "height": float(height_text),
            "datetime": stamp.isoformat(),
            "source": "BOM official table"
        })
    if len(rows) < 2:
        raise RuntimeError(f"Official BOM table parser returned only {len(rows)} observations")
    return rows

def mirror_rows():
    payload = json.loads(get(MIRROR_URL))
    rows = []
    for x in payload.get("results", []):
        if str(x.get("station_id")) != STATION:
            continue
        try:
            stamp = datetime.fromisoformat(str(x["datetime"]).replace("Z", "+00:00"))
            height = float(x["height"])
        except (KeyError, ValueError, TypeError):
            continue
        rows.append({
            "station_id": STATION,
            "height": height,
            "datetime": stamp.isoformat(),
            "source": "OpenDataSoft mirror"
        })
    return rows

existing = []
if OUT.exists():
    try:
        existing = json.loads(OUT.read_text())
    except Exception:
        existing = []

official = bom_rows()
mirror = mirror_rows()
by_time = {str(x.get("datetime")): x for x in existing if x.get("datetime")}

# Official BOM history is authoritative for the backfill. Mirror rows supplement
# it where their exact observation timestamp is not already present.
for x in mirror:
    by_time[x["datetime"]] = x
for x in official:
    by_time[x["datetime"]] = x

cutoff = datetime.now(timezone.utc) - timedelta(days=14)
kept = []
for x in by_time.values():
    try:
        d = datetime.fromisoformat(str(x["datetime"]).replace("Z", "+00:00"))
    except Exception:
        continue
    if d >= cutoff:
        kept.append(x)

kept.sort(key=lambda x: datetime.fromisoformat(str(x["datetime"]).replace("Z", "+00:00")))
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(kept, indent=2) + "\n")
print(f"retained {len(kept)} Bellbrook observations; official BOM {len(official)}; mirror {len(mirror)}")
