"""Write tests/vectors.json: 200 rows computed by the Python reference from
site/data/sky.bin and data/sites/*.json. The JavaScript must reproduce them.

160 "view" rows (one site, one time) and 40 "metrics" rows (one mission window).
Rows are picked with a fixed seed so that partly hidden Sun and Earth discs,
the hard cases, are well represented.
"""

import json
import os
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import sky  # noqa: E402
import visibility  # noqa: E402

SITE_IDS = ["site01", "site04", "site07", "site11", "malapert", "mouton", "haworth"]
VIEW_KEYS = ["sun_az", "sun_el", "sun_fraction", "earth_az", "earth_el",
             "earth_fraction", "earth_state", "earth_link"]


def load_sites():
    sites = {}
    for sid in SITE_IDS:
        with open(os.path.join(ROOT, "data", "sites", sid + ".json")) as f:
            sites[sid] = json.load(f)
    return sites


def view_row(table, site, hours):
    v = visibility.view(table, site, np.array([hours]))
    row = {"kind": "view", "site": site["id"], "hours": hours}
    for k in VIEW_KEYS:
        x = v[k][0]
        row[k] = bool(x) if k == "earth_link" else int(x) if k == "earth_state" else float(x)
    return row


def metrics_row(table, site, start, duration, step):
    row = {"kind": "metrics", "site": site["id"], "start_hours": start,
           "duration_hours": duration, "step_hours": step}
    row.update(visibility.metrics(table, site, start, duration, step))
    return row


def build():
    table = sky.read_bin(os.path.join(ROOT, "site", "data", "sky.bin"))
    sites = load_sites()
    rng = np.random.default_rng(2026)
    last = float(table["hours"][-1])
    rows = []

    # view rows: per site, a pool of random times sorted into kinds
    quota = {"sun_partial": 60, "earth_partial": 30, "other": 70}
    pools = {k: [] for k in quota}
    for sid in SITE_IDS:
        hours = np.round(rng.uniform(0.0, last, 4000), 4)
        v = visibility.view(table, sites[sid], hours)
        for i, h in enumerate(hours):
            sf, ef = v["sun_fraction"][i], v["earth_fraction"][i]
            kind = ("sun_partial" if 0 < sf < 1 else "earth_partial" if 0 < ef < 1 else "other")
            pools[kind].append((sid, float(h)))
    for kind, n in quota.items():
        pick = rng.choice(len(pools[kind]), size=n, replace=False)
        rows += [view_row(table, sites[sid], h) for sid, h in (pools[kind][i] for i in sorted(pick))]

    # metrics rows: windows of 3 to 60 days, mostly 1 h steps
    for i in range(40):
        sid = SITE_IDS[i % len(SITE_IDS)]
        duration = float(rng.choice([72, 168, 336, 708, 1440]))
        step = float(rng.choice([1.0, 1.0, 1.0, 0.5, 3.0]))
        start = float(np.round(rng.uniform(0.0, last - duration), 2))
        rows.append(metrics_row(table, sites[sid], start, duration, step))
    return rows


if __name__ == "__main__":
    rows = build()
    path = os.path.join(ROOT, "tests", "vectors.json")
    with open(path, "w") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n]\n")
    views = [r for r in rows if r["kind"] == "view"]
    print(f"wrote {path}: {len(rows)} rows, {os.path.getsize(path)} bytes")
    print("view rows:", len(views),
          "| Sun partly hidden:", sum(0 < r["sun_fraction"] < 1 for r in views),
          "| Sun hidden:", sum(r["sun_fraction"] == 0 for r in views),
          "| Sun full:", sum(r["sun_fraction"] == 1 for r in views),
          "| Earth partial:", sum(r["earth_state"] == 1 for r in views),
          "| Earth none:", sum(r["earth_state"] == 0 for r in views),
          "| Earth link:", sum(r["earth_link"] for r in views))
