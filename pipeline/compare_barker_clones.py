"""Repeat the Barker et al. (2021) comparison on the paper's own 100 clone maps.

The paper's Table 2 (Case A) gives, for each region of interest, the 1st
percentile of average illumination and the 99th percentile of the longest
dark period over 100 "clones": copies of the 5 m Site 1 map with plausible
height errors added. PGDA publishes those clones, so the same statistic can
be formed with our own horizon and Sun code:
  first 5 km from each clone, then the 80 m and 240 m maps as usual.

Each clone (41 MB) is downloaded, used and deleted. Per-clone results are
kept in data/barker_clones.json. Check only; nothing is tuned.

Source of the clones: https://pgda.gsfc.nasa.gov/products/78
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from multiprocessing import Pool

import numpy as np

import ephemeris
from compare_barker import BARKER, TABLE, roi_points, run
from horizon import Dem

URL = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Clones/Site01_final_adj_5mpp_{:04d}_err.tif"
TMP = "data/raw/pgda78/clones"
OUT = "data/barker_clones.json"
N_CLONES = 100

_state = {}


def _init():
    _state["table"] = ephemeris.load(TABLE)
    _state["near"] = Dem.from_geotiff("data/raw/LDEM_80S_80MPP_ADJ.TIF")
    _state["far"] = Dem.from_geotiff("data/raw/LDEM_60S_240MPP_ADJ.TIF")
    _state["points"] = roi_points()


def one_clone(number: int) -> dict:
    path = os.path.join(TMP, f"clone_{number:04d}.tif")
    for attempt in range(5):
        try:
            urllib.request.urlretrieve(URL.format(number), path)
            break
        except Exception:
            if attempt == 4:
                raise
    clone = Dem.from_geotiff(path)
    os.remove(path)
    out = {"clone": number, "rows": []}
    for k, (x, y) in enumerate(_state["points"], start=1):
        lat, lon = (float(v) for v in clone.unproject(x, y))
        for height in (5.0, 1.0):
            r = run(_state["table"], lat, lon, height, _state["near"], _state["far"], clone)
            out["rows"].append({"roi": k, "height_m": height, "avg": float(r["avg"]),
                                "dark": float(r["dark"]), "ground": float(r["ground"])})
    return out


def report(results: list[dict]) -> None:
    n = len(results)
    print(f"{n} clone maps, Site 1, 2024-01-01 to 2026-01-01, hourly")
    print("Barker: Table 2 Case A (1st percentile of average, 99th percentile of dark).")
    print("ours: the same percentiles over the clones, and the median over the clones.")
    for height in (5.0, 1.0):
        print(f"\nObserver {height:g} m above ground")
        print(f"{'':4} | {'average illumination, %':^40} | {'longest dark, days':^40}")
        print(f"{'RoI':4} | {'Barker':>8} {'ours p1':>8} {'median':>8} {'min..max':>13} | "
              f"{'Barker':>8} {'ours p99':>8} {'median':>8} {'min..max':>13}")
        d_avg, d_dark = [], []
        for k in range(1, 8):
            rows = [r for res in results for r in res["rows"]
                    if r["roi"] == k and r["height_m"] == height]
            avg = np.array([r["avg"] for r in rows])
            dark = np.array([r["dark"] for r in rows])
            p1, p99 = np.percentile(avg, 1), np.percentile(dark, 99)
            b_avg, b_dark = BARKER[height]["avg"][k - 1], BARKER[height]["dark"][k - 1]
            d_avg.append(p1 - b_avg)
            d_dark.append(p99 - b_dark)
            print(f"{k:<4} | {b_avg:8.2f} {p1:8.2f} {np.median(avg):8.2f} "
                  f"{avg.min():6.1f}..{avg.max():<5.1f} | {b_dark:8.2f} {p99:8.2f} "
                  f"{np.median(dark):8.2f} {dark.min():6.1f}..{dark.max():<5.1f}")
        d_avg, d_dark = np.array(d_avg), np.array(d_dark)
        print(f"ours minus Barker: average {d_avg.min():+.2f} to {d_avg.max():+.2f} points "
              f"(mean {d_avg.mean():+.2f}); dark {d_dark.min():+.2f} to {d_dark.max():+.2f} days "
              f"(mean {d_dark.mean():+.2f})")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        with open(OUT) as f:
            report(json.load(f))
        sys.exit()
    os.makedirs(TMP, exist_ok=True)
    with Pool(4, initializer=_init) as pool:
        results = []
        for res in pool.imap_unordered(one_clone, range(1, N_CLONES + 1)):
            results.append(res)
            print(f"clone {res['clone']:3d} done ({len(results)}/{N_CLONES})", file=sys.stderr, flush=True)
    results.sort(key=lambda r: r["clone"])
    with open(OUT, "w") as f:
        json.dump(results, f, separators=(",", ":"))
        f.write("\n")
    report(results)
