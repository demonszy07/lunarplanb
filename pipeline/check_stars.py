"""Check the Moon orientation model used for the stars against Horizons.

Horizons has no stars, so a far planet stands in for one: seen from a point
on the Moon, Horizons gives its place among the stars (astrometric right
ascension and declination, ICRF) and its azimuth and elevation at the same
moment. Feeding that right ascension and declination through our own
star code must give the same azimuth and elevation.

Expected leftover: Horizons' azimuth and elevation include the aberration
of light (up to 0.006 degrees) and its star-frame position does not; the
IAU orientation model itself is good to about 0.005 degrees.

Raw answers are kept in data/raw/check_stars/. Nothing is adjusted.
"""

import datetime as dt
import os

import numpy as np

import ephemeris
import realsky

POINTS = [(-89.4527, 222.8513), (-85.9876, 2.0528)]          # Site 1 and Malapert massif
BODIES = {"Jupiter": "599", "Saturn": "699", "Neptune": "899"}
RAW_DIR = "data/raw/check_stars"


def times():
    rng = np.random.default_rng(20261115)
    last = int(ephemeris.hours_since_epoch(dt.datetime(2031, 1, 1)) * 60)
    return [ephemeris.EPOCH + dt.timedelta(minutes=int(m)) for m in np.sort(rng.integers(0, last, 12))]


def ask(name, lat, lon, when):
    path = os.path.join(RAW_DIR, f"{name}_{lat:+.4f}_{lon:.4f}.txt")
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    text = ephemeris.horizons_request({
        "COMMAND": f"'{BODIES[name]}'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},0'", "QUANTITIES": "'1,4'", "APPARENT": "'AIRLESS'",
        "TLIST": " ".join("'" + t.strftime("%Y-%m-%d %H:%M") + "'" for t in when),
    })
    ephemeris.table_rows(text)
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return text


def main():
    when = times()
    hours = [ephemeris.hours_since_epoch(t) for t in when]
    d_az, d_el = [], []
    for lat, lon in POINTS:
        for name in BODIES:
            rows = ephemeris.table_rows(ask(name, lat, lon, when))
            assert len(rows) == len(when)
            for h, line in zip(hours, rows):
                f = [s.strip() for s in line.split(",")]
                # date, flags, flags, RA, DEC (ICRF, degrees), azimuth, elevation
                ra, dec, az, el = float(f[3]), float(f[4]), float(f[5]), float(f[6])
                our_az, our_el = realsky.star_az_el(ra, dec, h, lat, lon)
                d_az.append(((float(our_az) - az + 180.0) % 360.0 - 180.0) * np.cos(np.radians(el)))
                d_el.append(float(our_el) - el)
    d_az, d_el = np.abs(d_az), np.abs(d_el)
    print(f"{len(d_az)} comparisons: {len(POINTS)} points x {len(BODIES)} far planets x {len(when)} times, 2026-2030")
    print("absolute difference, degrees (ours minus Horizons)")
    print(f"azimuth x cos(elevation): min {d_az.min():.4f}  median {np.median(d_az):.4f}  max {d_az.max():.4f}")
    print(f"elevation:                min {d_el.min():.4f}  median {np.median(d_el):.4f}  max {d_el.max():.4f}")


if __name__ == "__main__":
    main()
