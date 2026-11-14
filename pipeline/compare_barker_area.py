"""Area average over one region of interest, to compare with Barker et al.
(2021) Table 2: Case A is the average over the pixels inside the RoI polygon,
Case C takes, every hour, the best-lit pixel inside the polygon.

Pixels of PGDA's 5 m Site 1 map whose centres are inside (or on the edge of)
the polygon are sampled every `stride` pixels in both directions. For each one:
horizon with the 5 m map for the first 5 km, then 80 m and 240 m; observer 1 m;
2024-01-01 to 2026-01-01, hourly. Check only; nothing is tuned.

usage: python pipeline/compare_barker_area.py [roi] [stride]
"""

from __future__ import annotations

import sys
import time

import numpy as np
import shapefile
from matplotlib.path import Path

import ephemeris
import visibility
from compare_barker import DETAIL, ROIS, TABLE
from horizon import Dem, horizon

BARKER_1M = {  # Table 2, observer 1 m, RoI 1..7
    "A avg": [68.03, 70.32, 67.51, 69.61, 70.38, 71.15, 67.36],
    "A dark": [16.55, 17.84, 22.23, 13.27, 15.24, 12.74, 14.54],
    "C avg": [85.84, 85.75, 77.31, 86.81, 84.47, 86.74, 83.44],
}


def pixels_in_polygon(dem: Dem, polygon: np.ndarray):
    """Row, column of every pixel whose centre is inside or on the polygon."""
    x0, y0, x1, y1 = polygon[:, 0].min(), polygon[:, 1].min(), polygon[:, 0].max(), polygon[:, 1].max()
    c0, c1 = int((x0 - dem.x0) / dem.dx) - 1, int((x1 - dem.x0) / dem.dx) + 2
    r0, r1 = int((dem.y0 - y1) / dem.dy) - 1, int((dem.y0 - y0) / dem.dy) + 2
    rows, cols = np.mgrid[r0:r1, c0:c1]
    x, y = dem.pixel_centre_xy(rows, cols)
    pts = np.column_stack([x.ravel(), y.ravel()])
    path = Path(polygon)
    inside = path.contains_points(pts, radius=0.01) | path.contains_points(pts, radius=-0.01)
    return rows.ravel()[inside], cols.ravel()[inside]


def main(roi: int = 4, stride: int = 2, height: float = 1.0):
    started = time.time()
    table = ephemeris.load(TABLE)
    near = Dem.from_geotiff("data/raw/LDEM_80S_80MPP_ADJ.TIF")
    far = Dem.from_geotiff("data/raw/LDEM_60S_240MPP_ADJ.TIF")
    detail = Dem.from_geotiff(DETAIL)
    reader = shapefile.Reader(ROIS)
    polygon = np.array(reader.shape(roi - 1).points)
    stored_x, stored_y = reader.record(roi - 1)

    rows, cols = pixels_in_polygon(detail, polygon)
    keep = (rows % stride == 0) & (cols % stride == 0)
    hours = table["hours"][:-1]
    fractions, avg, dark = [], [], []
    for r, c in zip(rows[keep], cols[keep]):
        x, y = detail.pixel_centre_xy(r, c)
        lat, lon = (float(v) for v in detail.unproject(x, y))
        h = horizon(lat, lon, height, near, far, detail=detail)
        site = {"lat": lat, "lon": lon, "site_height_m": h["site_height_m"],
                "observer_height_m": height, "elevation_deg": h["elevation_deg"]}
        f = visibility.view(table, site, hours)["sun_fraction"]
        fractions.append(f)
        avg.append(100.0 * f.mean())
        dark.append(visibility.longest_run(f <= 0.0) / 24.0)
    fractions, avg, dark = np.array(fractions), np.array(avg), np.array(dark)
    best = fractions.max(axis=0)          # every hour, the best-lit sampled pixel

    print(f"RoI {roi}, observer {height:g} m, 5 m near terrain, 2024-01-01 to 2026-01-01, hourly")
    print(f"pixels with centre in the polygon: {len(rows)}; sampled every {stride} pixels in both "
          f"directions: {len(avg)}; stored point x {stored_x} y {stored_y}")
    print(f"per pixel, average illumination %: min {avg.min():.2f}  median {np.median(avg):.2f}  "
          f"mean {avg.mean():.2f}  max {avg.max():.2f}  standard deviation {avg.std():.2f}")
    print(f"per pixel, longest dark, days:     min {dark.min():.2f}  median {np.median(dark):.2f}  "
          f"mean {dark.mean():.2f}  max {dark.max():.2f}")
    print(f"area average of average illumination: {avg.mean():.2f} %   "
          f"(Barker Case A: {BARKER_1M['A avg'][roi - 1]:.2f}, 1st percentile of 100 clones)")
    print(f"area average of longest dark:         {dark.mean():.2f} days "
          f"(Barker Case A: {BARKER_1M['A dark'][roi - 1]:.2f}, 99th percentile of 100 clones)")
    print(f"best-lit sampled pixel every hour:    {100.0 * best.mean():.2f} %   "
          f"(Barker Case C: {BARKER_1M['C avg'][roi - 1]:.2f})")
    print(f"run time {time.time() - started:.0f} s")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4,
         int(sys.argv[2]) if len(sys.argv) > 2 else 2)
