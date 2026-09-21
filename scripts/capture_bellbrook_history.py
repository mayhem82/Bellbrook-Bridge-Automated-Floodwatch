#!/usr/bin/env python3
import json, pathlib, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

STATION="059122"
URL="https://australiademo.opendatasoft.com/api/explore/v2.1/catalog/datasets/bom-river-heights-data/records?"+urllib.parse.urlencode({"where":f'station_id="{STATION}"',"order_by":"datetime DESC","limit":100})
OUT=pathlib.Path("data/bellbrook-history.json")

req=urllib.request.Request(URL,headers={"User-Agent":"Bellbrook-Floodwatch/1.0"})
with urllib.request.urlopen(req,timeout=20) as r:
    payload=json.load(r)
rows=[]
for x in payload.get("results",[]):
    if str(x.get("station_id"))!=STATION: continue
    try:
        stamp=datetime.fromisoformat(str(x["datetime"]).replace("Z","+00:00"))
        height=float(x["height"])
    except (KeyError,ValueError,TypeError):
        continue
    rows.append({"station_id":STATION,"height":height,"datetime":stamp.isoformat()})

existing=[]
if OUT.exists():
    try: existing=json.loads(OUT.read_text())
    except Exception: existing=[]
by_time={str(x.get("datetime")):x for x in existing if x.get("datetime")}
for x in rows: by_time[x["datetime"]]=x
cutoff=datetime.now(timezone.utc)-timedelta(days=14)
kept=[]
for x in by_time.values():
    try: d=datetime.fromisoformat(x["datetime"].replace("Z","+00:00"))
    except Exception: continue
    if d>=cutoff: kept.append(x)
kept.sort(key=lambda x:x["datetime"])
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(kept,indent=2)+"\n")
print(f"retained {len(kept)} Bellbrook observations; fetched {len(rows)}")
