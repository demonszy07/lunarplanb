"""Where the Sun and Earth are in the sky of a site on the Moon.

Everything comes from one Horizons table (see ephemeris.py): the sub-solar
and sub-Earth points on the Moon and the two centre-to-centre distances.

For a body whose sub-point is (sub_lat, sub_lon) at centre distance D:
    s = unit vector of the sub-point      (Moon centre -> body)
    p = unit vector of the site           (Moon centre -> site)
    v = D s - ro p                        (site -> body; this is the parallax)
    elevation = angle of v above the plane perpendicular to p
    azimuth   = direction of v in that plane, clockwise from north
    angular diameter = 2 asin(body radius / |v|)
Frame MOON_ME, east-positive longitude, sphere R = 1737.4 km, no refraction.

This file is the reference. site/js/sky.js must give the same numbers.
"""

from __future__ import annotations

import argparse
import json
import struct

import numpy as np

import ephemeris
from horizon import local_frame

MOON_RADIUS_KM = 1737.4
SUN_RADIUS_KM = 695700.0     # radius Horizons prints for the Sun
EARTH_RADIUS_KM = 6378.137   # equatorial radius Horizons prints for Earth

CHANNELS = ("sun_lon", "sun_lat", "sun_km", "earth_lon", "earth_lat", "earth_km")
MAGIC = b"LSKY"


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def direction(lat_deg, lon_deg, sub_lat_deg, sub_lon_deg, dist_km, body_radius_km,
              height_m: float = 0.0):
    """Azimuth, elevation, angular diameter (degrees) of a body seen from a site.

    sub_lat/sub_lon/dist may be arrays (one entry per time)."""
    p, n, e = local_frame(lat_deg, lon_deg)
    ro = MOON_RADIUS_KM + height_m / 1000.0
    la, lo = np.radians(sub_lat_deg), np.radians(sub_lon_deg)
    s = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
    v = np.asarray(dist_km)[..., None] * s - ro * p
    up, north, east = v @ p, v @ n, v @ e
    rng = np.sqrt(up * up + north * north + east * east)
    el = np.degrees(np.arctan2(up, np.hypot(north, east)))
    az = np.degrees(np.arctan2(east, north)) % 360.0
    diam = 2.0 * np.degrees(np.arcsin(body_radius_km / rng))
    return az, el, diam


def at(table: dict, hours):
    """Linear interpolation of every channel at the given hours since epoch."""
    hours = np.asarray(hours, dtype=float)
    if hours.min() < table["hours"][0] or hours.max() > table["hours"][-1]:
        raise ValueError("time outside the table")
    return {c: np.interp(hours, table["hours"], table[c]) for c in CHANNELS}


def sky(table: dict, hours, lat_deg: float, lon_deg: float, height_m: float = 0.0) -> dict:
    """Sun and Earth as seen from a site.

    Returns {"sun": (az, el, diameter), "earth": (az, el, diameter)} in degrees."""
    v = at(table, hours)
    return {
        "sun": direction(lat_deg, lon_deg, v["sun_lat"], v["sun_lon"], v["sun_km"],
                         SUN_RADIUS_KM, height_m),
        "earth": direction(lat_deg, lon_deg, v["earth_lat"], v["earth_lon"], v["earth_km"],
                           EARTH_RADIUS_KM, height_m),
    }


def earth_phase(sun_az, sun_el, earth_az, earth_el):
    """How Earth looks from the site: lit share of its disc (0 new, 1 full)
    and the direction from Earth to the Sun on the sky, in degrees from
    straight up, positive toward increasing azimuth.

    The Sun is far enough that the lit share depends only on the angle
    between Sun and Earth in the site's sky: lit = (1 - cos(angle)) / 2."""
    es, ee = np.radians(sun_el), np.radians(earth_el)
    d = np.radians(np.asarray(sun_az) - np.asarray(earth_az))
    cos_angle = np.sin(es) * np.sin(ee) + np.cos(es) * np.cos(ee) * np.cos(d)
    toward_sun = np.degrees(np.arctan2(
        np.sin(d) * np.cos(es),
        np.cos(ee) * np.sin(es) - np.sin(ee) * np.cos(es) * np.cos(d)))
    return (1.0 - cos_angle) / 2.0, toward_sun


# --------------------------------------------------------------------------
# Small table for the browser
# --------------------------------------------------------------------------

# The Sun's distance changes so slowly that one value a day is enough.
SPARSE = {"sun_km": 8}


def reduce(table: dict, step_hours: int = 3) -> dict:
    """Keep every step_hours-th row and pack each channel into 16-bit integers.

    value(i) = offset + rate * hours(i) + scale * integer(i)

    rate is a straight-line trend (degrees per hour) taken out of the unwrapped
    longitudes first, so the leftover fits 16 bits; it is 0 for other channels.
    A channel listed in SPARSE keeps only every n-th of those rows ("every" in
    the header); readers fill the rows between by straight lines.
    """
    hours = table["hours"][::step_hours]
    if hours[-1] != table["hours"][-1]:
        raise ValueError("table length does not divide by the step")
    channels = []
    for name in CHANNELS:
        every = SPARSE.get(name, 1)
        if (len(hours) - 1) % every:
            raise ValueError("row count does not divide by the sparse step")
        h = hours[::every]
        v = table[name][::step_hours][::every]
        rate = float(np.polyfit(h, v, 1)[0]) if name.endswith("_lon") else 0.0
        rest = v - rate * h
        offset = float((rest.max() + rest.min()) / 2.0)
        scale = float((rest.max() - rest.min()) / 2.0 / 32767.0)
        ints = np.round((rest - offset) / scale).astype(np.int16)
        channels.append({"name": name, "offset": offset, "rate": rate, "scale": scale,
                         "every": every, "ints": ints})
    return {"step_hours": step_hours, "count": len(hours), "channels": channels}


def write_bin(reduced: dict, path: str) -> None:
    """File layout (little-endian):
      4 bytes  "LSKY"
      uint32   length of the JSON header in bytes
      JSON     header, padded with spaces so the data starts on an even byte
      int16[]  the values of each channel, channels one after another;
               a channel has (count - 1) / every + 1 values
    """
    header = {
        "epoch": ephemeris.EPOCH.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "step_hours": reduced["step_hours"],
        "count": reduced["count"],
        "frame": "MOON_ME, east-positive longitude",
        "formula": "value = offset + rate * hours_since_epoch + scale * int16; "
                   "a channel with every = n holds every n-th row, straight lines between",
        "units": {"lon": "deg (unwrapped)", "lat": "deg", "km": "centre to centre"},
        "moon_radius_km": MOON_RADIUS_KM,
        "sun_radius_km": SUN_RADIUS_KM,
        "earth_radius_km": EARTH_RADIUS_KM,
        "source": "NASA/JPL Horizons, COMMAND=301 CENTER=500@399 QUANTITIES=14,15,19,20",
        "channels": [{k: ch[k] for k in ("name", "offset", "rate", "scale", "every")}
                     for ch in reduced["channels"]],
    }
    text = json.dumps(header, separators=(",", ":")).encode("utf-8")
    text += b" " * ((-len(text)) % 2)
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<I", len(text)) + text)
        for ch in reduced["channels"]:
            f.write(ch["ints"].astype("<i2").tobytes())


def read_bin(path: str) -> dict:
    """Read the small table back into the same shape ephemeris.load() gives."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:4] != MAGIC:
        raise ValueError("not a sky table")
    (n,) = struct.unpack("<I", raw[4:8])
    header = json.loads(raw[8:8 + n])
    count = header["count"]
    hours = np.arange(count, dtype=float) * header["step_hours"]
    table = {"hours": hours, "header": header}
    pos = 8 + n
    for ch in header["channels"]:
        every = ch.get("every", 1)
        stored = (count - 1) // every + 1
        ints = np.frombuffer(raw, dtype="<i2", count=stored, offset=pos).astype(float)
        own_hours = hours[::every]
        values = ch["offset"] + ch["rate"] * own_hours + ch["scale"] * ints
        if every > 1:
            # the same straight-line fill as site/js/sky.js, written out so both agree
            row = np.arange(count)
            i = np.minimum(row // every, stored - 2)
            values = values[i] + (values[i + 1] - values[i]) * ((row - i * every) / every)
        table[ch["name"]] = values
        pos += 2 * stored
    return table


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Write the small sky table for the browser.")
    ap.add_argument("--raw", default=ephemeris.RAW_PATH)
    ap.add_argument("--out", default="site/data/sky.bin")
    ap.add_argument("--step", type=int, default=3)
    args = ap.parse_args()
    import os
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    write_bin(reduce(ephemeris.load(args.raw), args.step), args.out)
    print(f"wrote {args.out}, {os.path.getsize(args.out)} bytes")

