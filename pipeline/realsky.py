"""The real sky over a lunar site: stars and the turning Earth.

Moon orientation: the IAU model (Archinal et al. 2011, "Report of the IAU
Working Group on Cartographic Coordinates and Rotational Elements: 2009",
Celestial Mechanics and Dynamical Astronomy 109, 101-135, with the 2011
erratum): right ascension and declination of the Moon's north pole and the
angle W of its prime meridian, as series in 13 arguments E1..E13. It gives
the mean Earth / polar axis frame to roughly 150 m on the surface, which is
0.005 degrees; the Sun and Earth positions of this project do not use it
(they come from Horizons), only the stars and the tilt of Earth's disc do.

Stars: Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren
1991), J2000 positions and V magnitudes, stars of magnitude 5.5 and brighter.

Earth: the point of Earth that faces the Moon, from JPL Horizons
(COMMAND='399', CENTER='500@301', QUANTITIES='14'), and NASA's Blue Marble
Next Generation image as the surface.

This file is the reference for site/js/realsky.js.
"""

from __future__ import annotations

import json
import os
import re
import struct

import numpy as np

import ephemeris
from horizon import local_frame

# Julian date of the table epoch (2026-01-01 00:00 UTC) minus J2000.0,
# and TDB - UTC = 32.184 s + 37 leap seconds (no leap second announced after 2017)
EPOCH_DAYS_FROM_J2000 = 2461041.5 - 2451545.0
TDB_MINUS_UTC_S = 69.184

_E = [  # degrees at J2000, degrees per day
    (125.045, -0.0529921), (250.089, -0.1059842), (260.008, 13.0120009), (176.625, 13.3407154),
    (357.529, 0.9856003), (311.589, 26.4057084), (134.963, 13.0649930), (276.617, 0.3287146),
    (34.226, 1.7484877), (15.134, -0.1589763), (119.743, 0.0036096), (239.961, 0.1643573),
    (25.053, 12.9590088),
]
_RA = {1: -3.8787, 2: -0.1204, 3: 0.0700, 4: -0.0172, 6: 0.0072, 10: -0.0052, 13: 0.0043}       # sin
_DEC = {1: 1.5419, 2: 0.0239, 3: -0.0278, 4: 0.0068, 6: -0.0029, 7: 0.0009, 10: 0.0008, 13: -0.0009}  # cos
_W = {1: 3.5610, 2: 0.1208, 3: -0.0642, 4: 0.0158, 5: 0.0252, 6: -0.0066, 7: -0.0047, 8: -0.0046,
      9: 0.0028, 10: 0.0052, 11: 0.0040, 12: 0.0019, 13: -0.0044}                                 # sin


def moon_matrix(hours):
    """3x3 matrix that turns a direction in the ICRF (the frame of star
    catalogues) into the Moon's mean Earth / polar axis frame, at `hours`
    since 2026-01-01 00:00 UTC."""
    d = EPOCH_DAYS_FROM_J2000 + hours / 24.0 + TDB_MINUS_UTC_S / 86400.0
    t = d / 36525.0
    e = [np.radians(a + b * d) for a, b in _E]
    ra = 269.9949 + 0.0031 * t + sum(c * np.sin(e[k - 1]) for k, c in _RA.items())
    dec = 66.5392 + 0.0130 * t + sum(c * np.cos(e[k - 1]) for k, c in _DEC.items())
    w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + sum(c * np.sin(e[k - 1]) for k, c in _W.items())
    a, b, c = np.radians(ra + 90.0), np.radians(90.0 - dec), np.radians(w % 360.0)
    r3a = np.array([[np.cos(a), np.sin(a), 0], [-np.sin(a), np.cos(a), 0], [0, 0, 1]])
    r1 = np.array([[1, 0, 0], [0, np.cos(b), np.sin(b)], [0, -np.sin(b), np.cos(b)]])
    r3w = np.array([[np.cos(c), np.sin(c), 0], [-np.sin(c), np.cos(c), 0], [0, 0, 1]])
    return r3w @ r1 @ r3a


def site_matrix(hours, lat_deg, lon_deg):
    """Matrix from the ICRF to the site's east / north / up directions."""
    p, n, e = local_frame(lat_deg, lon_deg)
    return np.array([e, n, p]) @ moon_matrix(hours)


def star_az_el(ra_deg, dec_deg, hours, lat_deg, lon_deg):
    """Azimuth and elevation (degrees) of fixed stars seen from a site."""
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    v = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)
    east, north, up = (site_matrix(hours, lat_deg, lon_deg) @ v[..., None])[..., 0].T
    return np.degrees(np.arctan2(east, north)) % 360.0, np.degrees(np.arcsin(np.clip(up, -1, 1)))


def earth_pole_angle(hours, lat_deg, lon_deg, earth_az_deg, earth_el_deg):
    """Which way Earth's north pole points on the site's sky: degrees from
    straight up, positive toward increasing azimuth (to the right).
    Earth's pole is taken as the ICRF pole (it has moved 0.15 degrees since 2000)."""
    pole = site_matrix(hours, lat_deg, lon_deg) @ np.array([0.0, 0.0, 1.0])
    az, el = np.radians(earth_az_deg), np.radians(earth_el_deg)
    right = np.array([np.cos(az), -np.sin(az), 0.0])
    up = np.array([-np.sin(el) * np.sin(az), -np.sin(el) * np.cos(az), np.cos(el)])
    return float(np.degrees(np.arctan2(pole @ right, pole @ up)))


def earth_point(x, y, facing_lon, facing_lat, pole_angle_deg):
    """Longitude (0..360 east) and latitude on Earth of the point seen at
    (x, y) on its disc: x to the right, y up, disc radius 1."""
    z = np.sqrt(1.0 - x * x - y * y)
    p, b = np.radians(pole_angle_deg), np.radians(facing_lat)
    xp, yp = x * np.cos(p) - y * np.sin(p), x * np.sin(p) + y * np.cos(p)
    lat = np.degrees(np.arcsin(np.clip(yp * np.cos(b) + z * np.sin(b), -1, 1)))
    lon = facing_lon + np.degrees(np.arctan2(xp, -yp * np.sin(b) + z * np.cos(b)))
    return lon % 360.0, lat


def sun_on_disc(sun_az, sun_el, earth_az, earth_el):
    """The Sun's direction in the frame of Earth's disc: x right, y up, z toward the viewer."""
    az, el, sa, se = (np.radians(v) for v in (earth_az, earth_el, sun_az, sun_el))
    s = np.array([np.cos(se) * np.sin(sa), np.cos(se) * np.cos(sa), np.sin(se)])
    right = np.array([np.cos(az), -np.sin(az), 0.0])
    up = np.array([-np.sin(el) * np.sin(az), -np.sin(el) * np.cos(az), np.cos(el)])
    toward_earth = np.array([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)])
    return np.array([s @ right, s @ up, -(s @ toward_earth)])


# --------------------------------------------------------------------------
# Files for the browser
# --------------------------------------------------------------------------

BSC_JSON = "data/raw/sky/bsc5-short.json"
EARTH_RAW = "data/raw/horizons_earth_from_moon_2026_2031_1h.txt"
BLUE_MARBLE_WHEEL = "data/raw/sky/bm/basemap_data-2.0.0-py3-none-any.whl"
FAINTEST = 5.5


def read_bsc(path: str = BSC_JSON):
    """Right ascension, declination (degrees, J2000) and V magnitude of every
    catalogue entry that has all three."""
    with open(path) as f:
        rows = json.load(f)
    ra, dec, mag = [], [], []
    for row in rows:
        if not all(k in row for k in ("RA", "Dec", "V")):
            continue
        h, m, s = (float(x) for x in re.match(r"(\d+)h (\d+)m ([\d.]+)s", row["RA"]).groups())
        sign, d, am, asec = re.match(r"([+-])(\d+)° (\d+)′ (\d+)″", row["Dec"]).groups()
        ra.append(15.0 * (h + m / 60.0 + s / 3600.0))
        dec.append((1 if sign == "+" else -1) * (float(d) + float(am) / 60.0 + float(asec) / 3600.0))
        mag.append(float(row["V"]))
    return np.array(ra), np.array(dec), np.array(mag)


def write_stars(path: str = "site/data/stars.bin") -> int:
    """Layout: "LSTR", uint32 count, then per star uint16 right ascension
    (0..65536 = 0..360 deg), int16 declination (32767 = 90 deg), uint8
    magnitude ((V + 2) * 30). Brightest first."""
    ra, dec, mag = read_bsc()
    keep = mag <= FAINTEST
    order = np.argsort(mag[keep])
    ra, dec, mag = ra[keep][order], dec[keep][order], mag[keep][order]
    with open(path, "wb") as f:
        f.write(b"LSTR" + struct.pack("<I", len(ra)))
        for r, d, m in zip(ra, dec, mag):
            f.write(struct.pack("<HhB", int(round(r / 360.0 * 65536)) % 65536,
                                int(round(d / 90.0 * 32767)), int(round((m + 2.0) * 30.0))))
    return len(ra)


def read_stars(path: str = "site/data/stars.bin"):
    with open(path, "rb") as f:
        raw = f.read()
    assert raw[:4] == b"LSTR"
    (count,) = struct.unpack("<I", raw[4:8])
    rec = np.frombuffer(raw, dtype=np.dtype([("ra", "<u2"), ("dec", "<i2"), ("mag", "u1")]), count=count, offset=8)
    return rec["ra"] / 65536.0 * 360.0, rec["dec"] / 32767.0 * 90.0, rec["mag"] / 30.0 - 2.0


EARTH_STEP_HOURS = 12


def load_earth_table(path: str = EARTH_RAW):
    """Hourly longitude (unwrapped, east-positive) and latitude of the point
    of Earth that faces the Moon's centre."""
    with open(path) as f:
        text = f.read()
    if "Earth (399)" not in text or "Moon (301)" not in text or "East-longitude positive" not in text:
        raise ValueError("not the Earth-from-Moon table")
    rows = [[s.strip() for s in line.split(",")] for line in ephemeris.table_rows(text)]
    lon = np.degrees(np.unwrap(np.radians([float(r[3]) for r in rows])))
    lat = np.array([float(r[4]) for r in rows])
    return np.arange(len(rows), dtype=float), lon, lat


def write_earth(path: str = "site/data/earth.bin") -> dict:
    """Same layout as the sky table ("LERT" header): the sub-Moon longitude and
    latitude on Earth every 12 hours as 16-bit numbers;
    value = offset + rate * hours + scale * int16."""
    hours, lon, lat = load_earth_table()
    h = hours[::EARTH_STEP_HOURS]
    channels, blobs = [], []
    for name, v in (("lon", lon[::EARTH_STEP_HOURS]), ("lat", lat[::EARTH_STEP_HOURS])):
        rate = float(np.polyfit(h, v, 1)[0]) if name == "lon" else 0.0
        rest = v - rate * h
        offset = float((rest.max() + rest.min()) / 2.0)
        scale = float((rest.max() - rest.min()) / 2.0 / 32767.0)
        blobs.append(np.round((rest - offset) / scale).astype("<i2").tobytes())
        channels.append({"name": name, "offset": offset, "rate": rate, "scale": scale})
    header = {"epoch": ephemeris.EPOCH.strftime("%Y-%m-%dT%H:%M:%SZ"), "step_hours": EARTH_STEP_HOURS,
              "count": len(h), "channels": channels,
              "what": "point of Earth facing the Moon's centre, east-positive longitude (unwrapped) and latitude, degrees",
              "source": "NASA/JPL Horizons, COMMAND=399 CENTER=500@301 QUANTITIES=14"}
    text = json.dumps(header, separators=(",", ":")).encode()
    text += b" " * ((-len(text)) % 2)
    with open(path, "wb") as f:
        f.write(b"LERT" + struct.pack("<I", len(text)) + text + b"".join(blobs))
    return header


def read_earth(path: str = "site/data/earth.bin"):
    with open(path, "rb") as f:
        raw = f.read()
    assert raw[:4] == b"LERT"
    (n,) = struct.unpack("<I", raw[4:8])
    header = json.loads(raw[8:8 + n])
    hours = np.arange(header["count"], dtype=float) * header["step_hours"]
    out, pos = {"hours": hours}, 8 + n
    for ch in header["channels"]:
        ints = np.frombuffer(raw, dtype="<i2", count=header["count"], offset=pos).astype(float)
        out[ch["name"]] = ch["offset"] + ch["rate"] * hours + ch["scale"] * ints
        pos += 2 * header["count"]
    return out


def earth_facing(table, hours):
    """Longitude (0..360 east) and latitude of the Earth point facing the Moon."""
    return (float(np.interp(hours, table["hours"], table["lon"])) % 360.0,
            float(np.interp(hours, table["hours"], table["lat"])))


def write_earth_image(path: str = "site/data/earth.jpg", width: int = 256) -> None:
    """Small copy of NASA's Blue Marble Next Generation picture of Earth
    (equirectangular, longitude -180..180 left to right, north up)."""
    import io
    import zipfile
    from PIL import Image
    with zipfile.ZipFile(BLUE_MARBLE_WHEEL) as z:
        image = Image.open(io.BytesIO(z.read("mpl_toolkits/basemap_data/bmng.jpg")))
    image = image.convert("RGB").resize((width, width // 2), Image.LANCZOS)
    image.save(path, "JPEG", quality=72, optimize=True)


if __name__ == "__main__":
    count = write_stars()
    print(f"site/data/stars.bin: {count} stars of magnitude {FAINTEST} and brighter, "
          f"{os.path.getsize('site/data/stars.bin')} bytes")
    write_earth()
    hours, lon, lat = load_earth_table()
    small = read_earth()
    err_lon = np.abs(np.interp(hours, small["hours"], small["lon"]) - lon).max()
    err_lat = np.abs(np.interp(hours, small["hours"], small["lat"]) - lat).max()
    print(f"site/data/earth.bin: {os.path.getsize('site/data/earth.bin')} bytes; against the hourly table "
          f"longitude within {err_lon:.3f} deg, latitude within {err_lat:.3f} deg")
    write_earth_image()
    print(f"site/data/earth.jpg: {os.path.getsize('site/data/earth.jpg')} bytes")
