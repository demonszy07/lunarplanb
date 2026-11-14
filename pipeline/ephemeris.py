"""Download and read the one JPL Horizons table the whole project uses.

Target Moon (301), observer Earth's centre (500@399), quantities
  14  sub-Earth longitude and latitude on the Moon   (ObsSub-LON, ObsSub-LAT)
  15  sub-solar longitude and latitude on the Moon   (SunSub-LON, SunSub-LAT)
  19  Sun to Moon-centre distance                    (r, AU)
  20  Earth-centre to Moon-centre distance           (delta, AU)
Longitudes are east-positive in the MOON_ME frame (stated in the table header).

Source: NASA/JPL Horizons, https://ssd.jpl.nasa.gov/horizons/
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import time
import urllib.parse
import urllib.request

import numpy as np

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
AU_KM = 149597870.700          # as printed in the Horizons header
EPOCH = dt.datetime(2026, 1, 1)  # hour 0 of the table, UT
RAW_PATH = "data/raw/horizons_moon_2026_2031_1h.txt"

MONTHS = {m: i + 1 for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def horizons_request(params: dict, retries: int = 4) -> str:
    """One GET to the Horizons API. Returns the plain-text answer."""
    query = {"format": "text", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
             "EPHEM_TYPE": "'OBSERVER'", "ANG_FORMAT": "'DEG'", "CSV_FORMAT": "'YES'"}
    query.update(params)
    url = API + "?" + urllib.parse.urlencode(query)
    wait = 2.0
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=300) as resp:
                return resp.read().decode("utf-8")
        except Exception:
            if attempt == retries:
                raise
            time.sleep(wait)
            wait *= 2
    raise RuntimeError("unreachable")


def table_rows(text: str) -> list[str]:
    """Lines between $$SOE and $$EOE, or an error with Horizons' own message."""
    if "$$SOE" not in text or "$$EOE" not in text:
        raise ValueError("Horizons returned no table:\n" + text[-1500:])
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    return [line for line in body.splitlines() if line.strip()]


def fetch_table(start: str, stop: str) -> str:
    return horizons_request({
        "COMMAND": "'301'", "CENTER": "'500@399'",
        "QUANTITIES": "'14,15,19,20'",
        "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": "'1 h'",
    })


def download(path: str = RAW_PATH, first_year: int = 2026, last_year: int = 2031) -> None:
    """Save the raw table. Tries one query; if Horizons refuses (line limit),
    asks year by year and joins the rows. The raw text is kept as received."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        text = fetch_table(f"{first_year}-01-01 00:00", f"{last_year}-01-01 00:00")
        table_rows(text)
        parts = [text]
        print("one query was enough")
    except ValueError as err:
        print("single query refused, splitting by year:", str(err).strip().splitlines()[-1])
        parts = []
        for year in range(first_year, last_year):
            # each part stops one hour before the next begins, so no row repeats
            stop = f"{year}-12-31 23:00" if year < last_year - 1 else f"{last_year}-01-01 00:00"
            text = fetch_table(f"{year}-01-01 00:00", stop)
            table_rows(text)
            parts.append(text)
    with open(path, "w") as f:
        f.write("\n".join(parts))
    print(f"wrote {path}, {os.path.getsize(path)} bytes")


def load(path: str = RAW_PATH) -> dict:
    """Read the raw table into arrays on a uniform one-hour grid.

    Returns hours (since 2026-01-01 00:00 UT; negative before that), and for Earth and Sun the
    sub-point longitude (unwrapped, degrees), latitude (degrees) and
    centre-to-centre distance (km).
    """
    with open(path) as f:
        text = f.read()
    if "MOON_ME" not in text or "East-longitude positive" not in text:
        raise ValueError("table is not in MOON_ME with east-positive longitude")

    hours, cols = [], []
    for chunk in text.split("$$SOE")[1:]:
        for line in chunk.split("$$EOE", 1)[0].splitlines():
            if not line.strip():
                continue
            f_ = [s.strip() for s in line.split(",")]
            date, clock = f_[0].split()
            y, mon, d = date.split("-")
            hh, mm = clock.split(":")
            t = dt.datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm))
            hours.append((t - EPOCH).total_seconds() / 3600.0)
            # date, solar flag, lunar flag, ObsSub-LON, ObsSub-LAT, SunSub-LON, SunSub-LAT, r, rdot, delta, deldot
            cols.append([float(f_[3]), float(f_[4]), float(f_[5]), float(f_[6]),
                         float(f_[7]), float(f_[9])])
    hours = np.array(hours)
    c = np.array(cols)
    if not np.array_equal(np.diff(hours), np.ones(len(hours) - 1)):
        raise ValueError("table is not a gap-free one-hour grid")

    return {
        "hours": hours,
        "earth_lon": np.degrees(np.unwrap(np.radians(c[:, 0]))),
        "earth_lat": c[:, 1],
        "sun_lon": np.degrees(np.unwrap(np.radians(c[:, 2]))),
        "sun_lat": c[:, 3],
        "sun_km": c[:, 4] * AU_KM,
        "earth_km": c[:, 5] * AU_KM,
    }


def hours_since_epoch(when: dt.datetime) -> float:
    return (when - EPOCH).total_seconds() / 3600.0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=RAW_PATH)
    args = ap.parse_args()
    download(args.out)
    t = load(args.out)
    print(f"{len(t['hours'])} hourly rows, hour 0 to {t['hours'][-1]:.0f}")
