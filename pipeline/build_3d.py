"""Write data/sites/[id]_3d.bin for every site: the terrain the 3D view is built from.

Five square height grids, one inside the other, all centred on the site:

  outer   240 x 240 km, one height every 960 m  averaged from LDEM_60S_240MPP_ADJ.TIF
  wide    40 x 40 km,   one height every 160 m  averaged from LDEM_80S_80MPP_ADJ.TIF
  local   16 x 16 km,   one height every 80 m   LDEM_80S_80MPP_ADJ.TIF itself
  middle  4 x 4 km,     one height every 20 m   averaged from the site's 5 m map
  near    500 x 500 m,  one height every 5 m    the 5 m map itself

A grid point "x metres east, y metres north" is the point reached by walking
hypot(x, y) metres along the great circle that leaves the site at azimuth
atan2(x, y) (clockwise from north). This is the same walk the horizon
calculation uses, so the grid has no map-projection distortion at the site.

The file also carries two horizons, each for panels at 2 m and at 5 m:
  beyond 19.2 km (to 300 km): the 3D view casts shadows only inside the wide
    grid, so it dims that ground when mountains farther out hide the Sun;
  beyond 120 km (to 300 km): terrain past the outer grid, drawn as a strip.

Heights are metres above the 1737.4 km sphere. The Moon's curvature is not in
the heights; it goes into the positions when the mesh is built (local_position).

File layout (little-endian), same idea as the other .bin files:
  4 bytes "L3DT", uint32 length of the JSON header, JSON header (padded to an
  even length), then int16 blocks in the order given by the header.
  height = offset + scale * int16
"""

from __future__ import annotations

import json
import os
import struct

import numpy as np

from build_sites import DETAIL_LIMIT_KM, HEIGHTS, PGDA, SITES, TILE_DIR, site_point, tile_name
from horizon import Dem, R_M, N_AZ, _points, _sweep, local_frame

# name, half width (m), step (m), sub-samples per side averaged into one height, which map
LEVELS = [
    ("outer", 120000.0, 960.0, 4, "far"),
    ("wide", 20000.0, 160.0, 2, "near"),
    ("local", 8000.0, 80.0, 1, "near"),
    ("middle", 2000.0, 20.0, 4, "detail"),
    ("near", 250.0, 5.0, 1, "detail"),
]
# the two far-only horizons: the square (half width, m) whose inside is left out
FAR_BEYOND = [19200.0, 120000.0]
FAR_SCALE_DEG = 0.001


def local_position(x_east, y_north, height, site_height):
    """Where a grid point sits in the site's own east / north / up frame, with
    the origin on the ground at the site. This is where the Moon's curvature
    comes in: level ground 20 km away lies 115 m below the site's horizontal."""
    x_east, y_north = np.asarray(x_east, dtype=float), np.asarray(y_north, dtype=float)
    d = np.hypot(x_east, y_north)
    angle = d / R_M
    rt = R_M + np.asarray(height, dtype=float)
    # sin(angle) / d, with the limit 1 / R at the site itself
    reach = np.where(d > 0, rt * np.sin(angle) / np.where(d > 0, d, 1.0), rt / R_M)
    return np.stack([x_east * reach, y_north * reach, rt * np.cos(angle) - (R_M + site_height)], axis=-1)


def grid_points(lat, lon, half, step, sub=1):
    """Latitude and longitude of every grid point (rows south to north, columns
    west to east). With sub > 1, of sub x sub points spread evenly inside the
    cell around each grid point: shape (sub * sub, n, n)."""
    n = int(round(2 * half / step)) + 1
    axis = (np.arange(n) - (n - 1) / 2) * step
    offsets = (np.arange(sub) + 0.5) / sub * step - step / 2
    p, north, east = local_frame(lat, lon)
    lats, lons = [], []
    for dy in offsets:
        for dx in offsets:
            x, y = np.meshgrid(axis + dx, axis + dy)
            la, lo = _points(p, north, east, np.arctan2(x, y), np.hypot(x, y))
            lats.append(la)
            lons.append(lo)
    return n, np.array(lats), np.array(lons)


def level_heights(lat, lon, half, step, sub, dem: Dem, fallback: Dem | None):
    """Heights of one grid, each the mean of sub x sub samples of the map.
    Where the map has no data the fallback map is read instead."""
    n, lats, lons = grid_points(lat, lon, half, step, sub)
    h = dem.sample(lats, lons)
    hole = np.isnan(h)
    if hole.any():
        if fallback is None:
            raise ValueError("no terrain data inside the grid")
        h = np.where(hole, fallback.sample(lats, lons), h)
    if np.isnan(h).any():
        raise ValueError("no terrain data inside the grid, also in the fallback map")
    return h.mean(axis=0), float(hole.mean())


def far_horizon(lat, lon, observer_height, near: Dem, far: Dem, detail: Dem | None, half):
    """Horizon (degrees) from terrain outside the square of that half width only, 720 azimuths."""
    s = _sweep(lat, lon, observer_height, near, far, 100.0, 300.0, N_AZ, detail, DETAIL_LIMIT_KM)
    az = np.radians(s["az_deg"])
    edge = half / np.maximum(np.abs(np.sin(az)), np.abs(np.cos(az)))      # the square's edge along each azimuth
    elev = np.where(s["dist"][None, :] > edge[:, None], s["elev"], -np.inf)
    return np.degrees(elev.max(axis=1))


def quantise(values):
    lo, hi = float(values.min()), float(values.max())
    offset = (hi + lo) / 2
    scale = max((hi - lo) / 65534.0, 1e-9)
    q = np.round((values - offset) / scale).astype("<i2")
    return q, offset, scale


def write_3d(path, site, lat, lon, site_height, levels, far_profiles):
    blocks, meta = [], []
    for (name, half, step, sub, _), (heights, borrowed, source) in zip(LEVELS, levels):
        q, offset, scale = quantise(heights)
        blocks.append(q.tobytes())
        meta.append({"name": name, "half_width_m": half, "step_m": step, "size": int(heights.shape[0]),
                     "offset": round(offset, 4), "scale": scale, "source": source,
                     "samples_averaged": sub * sub, "share_read_from_80m_map": round(borrowed, 4)})
    far_meta = []
    for beyond, height, profile in far_profiles:
        blocks.append(np.round(profile / FAR_SCALE_DEG).astype("<i2").tobytes())
        far_meta.append({"beyond_m": beyond, "observer_height_m": height, "count": N_AZ, "scale_deg": FAR_SCALE_DEG})
    header = {
        "site": site["id"], "lat": lat, "lon": lon, "site_height_m": round(site_height, 2),
        "frame": "MOON_ME, east-positive longitude, sphere 1737.4 km",
        "grid": "square grids centred on the site; rows run south to north, columns west to east; "
                "a point x m east, y m north is hypot(x, y) m along the great circle of azimuth atan2(x, y)",
        "values": "int16 q, height in metres above the sphere = offset + scale * q; curvature is not included",
        "levels": meta,
        "far_horizon": far_meta,
        "far_horizon_note": "degrees = scale_deg * int16, index i is i * 0.5 degrees clockwise from north; "
                            "only terrain outside the square of half width beyond_m, out to 300 km",
        "source": PGDA + " and https://pgda.gsfc.nasa.gov/products/90",
    }
    text = json.dumps(header, separators=(",", ":")).encode("utf-8")
    text += b" " * ((-len(text)) % 2)
    with open(path, "wb") as f:
        f.write(b"L3DT" + struct.pack("<I", len(text)) + text + b"".join(blocks))


def read_3d(path):
    """Read a file back: header, {name: heights}, {(beyond_m, observer height): far horizon in degrees}."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:4] != b"L3DT":
        raise ValueError("not a 3D terrain file")
    length = struct.unpack("<I", raw[4:8])[0]
    header = json.loads(raw[8:8 + length])
    pos = 8 + length
    grids = {}
    for level in header["levels"]:
        n = level["size"]
        q = np.frombuffer(raw, dtype="<i2", count=n * n, offset=pos).reshape(n, n)
        grids[level["name"]] = level["offset"] + level["scale"] * q
        pos += 2 * n * n
    far = {}
    for entry in header["far_horizon"]:
        q = np.frombuffer(raw, dtype="<i2", count=entry["count"], offset=pos)
        far[(entry["beyond_m"], entry["observer_height_m"])] = q * entry["scale_deg"]
        pos += 2 * entry["count"]
    return header, grids, far


def main(out_dir: str = "data/sites"):
    near = Dem.from_geotiff("data/raw/LDEM_80S_80MPP_ADJ.TIF")
    far = Dem.from_geotiff("data/raw/LDEM_60S_240MPP_ADJ.TIF")
    for site in SITES:
        lat, lon = site_point(site, near)
        tile = tile_name(site["id"])
        detail = Dem.from_geotiff(os.path.join(TILE_DIR, tile))
        site_height = float(detail.sample(lat, lon))
        levels = []
        maps = {"far": (far, None, "LDEM_60S_240MPP_ADJ.TIF"), "near": (near, None, "LDEM_80S_80MPP_ADJ.TIF"),
                "detail": (detail, near, tile)}
        for name, half, step, sub, which in LEVELS:
            dem, fallback, source = maps[which]
            heights, borrowed = level_heights(lat, lon, half, step, sub, dem, fallback)
            levels.append((heights, borrowed, source))
        profiles = [(beyond, h, far_horizon(lat, lon, h, near, far, detail, beyond))
                    for beyond in FAR_BEYOND for h in HEIGHTS.values()]
        path = os.path.join(out_dir, site["id"] + "_3d.bin")
        write_3d(path, site, lat, lon, site_height, levels, profiles)

        centre = levels[4][0][50, 50]
        print(f"{site['id']:9} ground {site_height:8.2f} m, centre of the near grid {centre:8.2f} m; "
              f"outer grid {levels[0][0].min():7.0f}..{levels[0][0].max():6.0f} m; "
              f"borrowed from the 80 m map: middle {100 * levels[3][1]:4.1f} %, near {100 * levels[4][1]:4.1f} %; "
              f"horizon beyond 19.2 km {profiles[0][2].min():6.2f}..{profiles[0][2].max():5.2f} deg, "
              f"beyond 120 km {profiles[2][2].min():6.2f}..{profiles[2][2].max():5.2f} deg; "
              f"{os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
