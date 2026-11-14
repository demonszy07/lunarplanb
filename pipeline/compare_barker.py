"""Compare our illumination numbers with Barker et al. (2021), Table 2, Case A.

Seven regions of interest (RoIs) at Site 1, observer 1 m and 5 m above the
ground, 2024-01-01 to 2026-01-01, one sample per hour:
  average illumination  = mean visible fraction of the Sun's disc, percent
  longest dark          = longest unbroken time with no Sun at all, days

Three columns per case:
  Barker       values typed from the paper's Table 2 (Case A). They are the
               1st percentile (average) and 99th percentile (dark) of 100
               clone maps, so they lean pessimistic. The paper applies limb
               darkening to the Sun's disc; we do not.
  ours 80 m    our pipeline as used for the site: 80 m DEM to 100 km, 240 m to 300 km
  ours 5 m     the same, but the first 5 km from PGDA's 5 m Site 1 map

This is a check only. It uses its own Horizons table (2024-2026) and writes
nothing that the web page reads. Nothing here is tuned to match the paper.

Inputs in data/raw/ (not in the repository):
  horizons_moon_2024_2026_1h.txt   ephemeris.download(path, 2024, 2026)
  pgda78/Site01_final_adj_5mpp_surf.tif, pgda78/Site01_ROIs/Site01_ROIs.shp
      from https://pgda.gsfc.nasa.gov/products/78
"""

from __future__ import annotations

import numpy as np
import shapefile

import ephemeris
import visibility
from horizon import Dem, horizon

TABLE = "data/raw/horizons_moon_2024_2026_1h.txt"
DETAIL = "data/raw/pgda78/Site01_final_adj_5mpp_surf.tif"
ROIS = "data/raw/pgda78/Site01_ROIs/Site01_ROIs.shp"

# Barker et al. 2021, Table 2, Case A, RoI 1..7
BARKER = {
    5.0: {"avg": [89.26, 88.51, 84.53, 88.12, 85.71, 87.35, 82.79],
          "dark": [5.29, 7.31, 8.41, 4.00, 4.52, 4.16, 5.42]},
    1.0: {"avg": [68.03, 70.32, 67.51, 69.61, 70.38, 71.15, 67.36],
          "dark": [16.55, 17.84, 22.23, 13.27, 15.24, 12.74, 14.54]},
}


# Table 2, Case C, observer 1 m: every hour the best-lit pixel inside the RoI.
# Case A above is the average over the pixels inside the RoI polygon; our
# numbers are for one point (the one stored with the polygon), so they are
# expected to fall between A and C.
BARKER_C_1M = [85.84, 85.75, 77.31, 86.81, 84.47, 86.74, 83.44]


def roi_points():
    """X, Y stored with each polygon of the shapefile, in file order."""
    reader = shapefile.Reader(ROIS)
    return [tuple(rec) for rec in reader.records()]


def run(table, lat, lon, height, near, far, detail=None):
    h = horizon(lat, lon, height, near, far, detail=detail)
    site = {"lat": lat, "lon": lon, "site_height_m": h["site_height_m"],
            "observer_height_m": height, "elevation_deg": h["elevation_deg"]}
    hours = table["hours"][:-1]            # 2024-01-01 00:00 .. 2025-12-31 23:00
    v = visibility.view(table, site, hours)
    frac = v["sun_fraction"]
    return {
        "avg": 100.0 * frac.mean(),
        "dark": visibility.longest_run(frac <= 0.0) / 24.0,
        "lit": 100.0 * np.mean(frac > 0.0),
        "ground": h["site_height_m"],
        "close": int(np.sum(h["distance_km"] < 5.0)),
        "profile": h["elevation_deg"],
        "skipped": h["skipped"],
    }


def main():
    table = ephemeris.load(TABLE)
    near = Dem.from_geotiff("data/raw/LDEM_80S_80MPP_ADJ.TIF")
    far = Dem.from_geotiff("data/raw/LDEM_60S_240MPP_ADJ.TIF")
    detail = Dem.from_geotiff(DETAIL)
    points = roi_points()

    print(f"Period {ephemeris.EPOCH.year - 2}-01-01 to {ephemeris.EPOCH.year}-01-01, "
          f"{len(table['hours']) - 1} hourly samples")
    print("RoI points (from Site01_ROIs.shp) and ground height in the two terrain models:")
    results = {}
    for k, (x, y) in enumerate(points, start=1):
        lat, lon = (float(v) for v in near.unproject(x, y))
        for height in (5.0, 1.0):
            results[(k, height, "80m")] = run(table, lat, lon, height, near, far)
            results[(k, height, "5m")] = run(table, lat, lon, height, near, far, detail)
        a, b = results[(k, 5.0, "80m")], results[(k, 5.0, "5m")]
        print(f"  RoI {k}: x {x:9.1f} y {y:9.1f}  lat {lat:.4f} lon {lon:.4f}  "
              f"ground 80 m map {a['ground']:7.1f} m, 5 m map {b['ground']:7.1f} m, "
              f"difference {b['ground'] - a['ground']:+5.1f} m")

    for height in (5.0, 1.0):
        print(f"\nObserver {height:g} m above ground")
        with_c = height == 1.0
        print(f"{'':6} | {'average illumination, %':^{42 if with_c else 31}} | {'longest dark, days':^31}")
        print(f"{'RoI':6} | {'Barker A':>9} {'ours 80 m':>10} {'ours 5 m':>10}"
              + (f" {'Barker C':>10}" if with_c else "")
              + f" | {'Barker A':>9} {'ours 80 m':>10} {'ours 5 m':>10}")
        cols = {"avg80": [], "avg5": [], "dark80": [], "dark5": []}
        for k in range(1, 8):
            a, b = results[(k, height, "80m")], results[(k, height, "5m")]
            cols["avg80"].append(a["avg"]); cols["avg5"].append(b["avg"])
            cols["dark80"].append(a["dark"]); cols["dark5"].append(b["dark"])
            print(f"{k:<6} | {BARKER[height]['avg'][k - 1]:9.2f} {a['avg']:10.2f} {b['avg']:10.2f}"
                  + (f" {BARKER_C_1M[k - 1]:10.2f}" if with_c else "")
                  + f" | {BARKER[height]['dark'][k - 1]:9.2f} {a['dark']:10.2f} {b['dark']:10.2f}")
        ref_avg, ref_dark = np.array(BARKER[height]["avg"]), np.array(BARKER[height]["dark"])
        c = {k: np.array(v) for k, v in cols.items()}
        print(f"{'mean':6} | {ref_avg.mean():9.2f} {c['avg80'].mean():10.2f} {c['avg5'].mean():10.2f}"
              + (f" {np.mean(BARKER_C_1M):10.2f}" if with_c else "")
              + f" | {ref_dark.mean():9.2f} {c['dark80'].mean():10.2f} {c['dark5'].mean():10.2f}")
        if with_c:
            between = [(BARKER[height]["avg"][i] <= c["avg5"][i] <= BARKER_C_1M[i]) for i in range(7)]
            print(f"ours 5 m between Barker A and C: {sum(between)} of 7 RoIs")
        print(f"ours minus Barker A, average illumination (points): "
              f"80 m {np.min(c['avg80'] - ref_avg):+.2f} to {np.max(c['avg80'] - ref_avg):+.2f}, "
              f"5 m {np.min(c['avg5'] - ref_avg):+.2f} to {np.max(c['avg5'] - ref_avg):+.2f}")
        print(f"ours minus Barker A, longest dark (days): "
              f"80 m {np.min(c['dark80'] - ref_dark):+.2f} to {np.max(c['dark80'] - ref_dark):+.2f}, "
              f"5 m {np.min(c['dark5'] - ref_dark):+.2f} to {np.max(c['dark5'] - ref_dark):+.2f}")
        d_avg, d_dark = c["avg80"] - c["avg5"], c["dark80"] - c["dark5"]
        print(f"80 m minus 5 m near terrain: average {d_avg.min():+.2f} to {d_avg.max():+.2f} points "
              f"(mean of absolute values {np.abs(d_avg).mean():.2f}); "
              f"dark {d_dark.min():+.2f} to {d_dark.max():+.2f} days "
              f"(mean of absolute values {np.abs(d_dark).mean():.2f})")
        prof = [np.abs(results[(k, height, '80m')]['profile'] - results[(k, height, '5m')]['profile'])
                for k in range(1, 8)]
        print(f"horizon profile, 80 m against 5 m near terrain: median difference "
              f"{np.median(prof):.3f} deg, largest {np.max(prof):.3f} deg; directions whose horizon is "
              f"set within 5 km (5 m run): "
              f"{[results[(k, height, '5m')]['close'] for k in range(1, 8)]} of 720")
    skipped = sum(r["skipped"] for r in results.values())
    print(f"\nsamples without terrain data over all runs: {skipped}")


if __name__ == "__main__":
    main()
