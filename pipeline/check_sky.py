"""Compare sky.py with Horizons asked directly for a point on the Moon.

5 check points x 40 random times (fixed seed) x Sun and Earth.
Horizons query: CENTER='coord@301', SITE_COORD='lon,lat,0', QUANTITIES='4,13'
(airless apparent azimuth and elevation, angular diameter).
Raw answers are kept in data/raw/check/. Prints min, median, max of the
absolute differences. Nothing here adjusts the calculation.
"""

from __future__ import annotations

import datetime as dt
import os

import numpy as np

import ephemeris
import sky

# Site 1 plus four points spread in latitude and longitude (check points only)
POINTS = [(-89.45, 222.69), (-89.90, 0.00), (-88.80, 68.00), (-87.50, 300.00), (-85.00, 150.00)]
BODIES = {"sun": "10", "earth": "399"}
N_TIMES = 40
SEED = 20261114
RAW_DIR = "data/raw/check"


def random_times() -> list[dt.datetime]:
    rng = np.random.default_rng(SEED)
    last_minute = int(ephemeris.hours_since_epoch(dt.datetime(2031, 1, 1)) * 60)
    minutes = np.sort(rng.integers(0, last_minute, N_TIMES))
    return [ephemeris.EPOCH + dt.timedelta(minutes=int(m)) for m in minutes]


def ask_horizons(body: str, lat: float, lon: float, times: list[dt.datetime]) -> str:
    path = os.path.join(RAW_DIR, f"{body}_{lat:+.2f}_{lon:.2f}.txt")
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    tlist = " ".join("'" + t.strftime("%Y-%m-%d %H:%M") + "'" for t in times)
    text = ephemeris.horizons_request({
        "COMMAND": f"'{BODIES[body]}'", "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'", "SITE_COORD": f"'{lon},{lat},0'",
        "TLIST": tlist, "QUANTITIES": "'4,13'", "APPARENT": "'AIRLESS'",
    })
    ephemeris.table_rows(text)
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return text


def parse(text: str) -> dict:
    out = {}
    for line in ephemeris.table_rows(text):
        f = [s.strip() for s in line.split(",")]
        date, clock = f[0].split()
        y, mon, d = date.split("-")
        hh, mm = clock.split(":")[:2]
        t = dt.datetime(int(y), ephemeris.MONTHS[mon], int(d), int(hh), int(mm))
        # date, solar flag, interferer flag, azimuth, elevation, angular diameter (arcsec)
        out[t] = (float(f[3]), float(f[4]), float(f[5]) / 3600.0)
    return out


def main():
    table = ephemeris.load()
    times = random_times()
    hours = np.array([ephemeris.hours_since_epoch(t) for t in times])
    diffs = {b: {"az": [], "az_sky": [], "el": [], "diam": []} for b in BODIES}

    for lat, lon in POINTS:
        ours = sky.sky(table, hours, lat, lon)
        for body in BODIES:
            ref = parse(ask_horizons(body, lat, lon, times))
            assert len(ref) == N_TIMES, (body, lat, lon, len(ref))
            az, el, diam = ours[body]
            for i, t in enumerate(times):
                raz, rel, rdiam = ref[t]
                daz = (az[i] - raz + 180.0) % 360.0 - 180.0
                diffs[body]["az"].append(daz)
                diffs[body]["az_sky"].append(daz * np.cos(np.radians(rel)))
                diffs[body]["el"].append(el[i] - rel)
                diffs[body]["diam"].append(diam[i] - rdiam)

    print(f"{len(POINTS)} points x {N_TIMES} times = {len(POINTS) * N_TIMES} comparisons per body")
    print("absolute difference, degrees (ours minus Horizons)")
    print(f"{'body':6} {'quantity':28} {'min':>10} {'median':>10} {'max':>10}")
    names = {"az": "azimuth", "az_sky": "azimuth x cos(elevation)", "el": "elevation",
             "diam": "angular diameter"}
    worst = 0.0
    for body in BODIES:
        for key, label in names.items():
            a = np.abs(np.array(diffs[body][key]))
            print(f"{body:6} {label:28} {a.min():10.6f} {np.median(a):10.6f} {a.max():10.6f}")
            if key in ("az", "el"):
                worst = max(worst, a.max())
        signed = np.array(diffs[body]["az_sky"]), np.array(diffs[body]["el"])
        print(f"{'':6} mean signed: azimuth x cos(el) {signed[0].mean():+.6f}, elevation {signed[1].mean():+.6f}")
    print(f"largest azimuth or elevation difference: {worst:.6f} deg (target: below 0.01)")


if __name__ == "__main__":
    main()
