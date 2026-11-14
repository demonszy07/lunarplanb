"""Terrain horizon seen from a point near the lunar south pole.

For 720 azimuths (clockwise from north, N 0, E 90) this gives the elevation
angle of the terrain horizon and the distance of the terrain point that sets it.

Conventions (see CLAUDE.md):
  frame MOON_ME, east-positive longitude, sphere R = 1737.4 km, no refraction.
  tan(e) = (rt cos d - ro) / (rt sin d)
    ro = radius of the observer, rt = radius of the terrain point,
    d  = angle between them seen from the Moon's centre.
  Negative horizons are valid and are never clipped.

The DEM georeferencing (projection, pixel size, corner, pixel-is-area or
pixel-is-point, nodata) is read from the GeoTIFF tags, not assumed.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

import numpy as np

R_M = 1737400.0  # reference sphere radius, metres
N_AZ = 720


# --------------------------------------------------------------------------
# DEM
# --------------------------------------------------------------------------

@dataclass
class Dem:
    """A height grid (metres above the reference sphere) in a south polar
    stereographic projection on a sphere.

    Map coordinates of the centre of pixel (row, col):
        x = x0 + (col + half) * dx
        y = y0 - (row + half) * dy
    where (x0, y0) is the model tiepoint of raster position (0, 0) and
    half = 0.5 for pixel-is-area, 0 for pixel-is-point (GeoTIFF spec).
    """

    data: np.ndarray       # 2D, metres, NaN = no data
    x0: float
    y0: float
    dx: float
    dy: float
    half: float = 0.5
    lon0_deg: float = 0.0  # longitude that points straight "up" (+y) from the pole
    k0: float = 1.0        # scale at the pole
    radius_m: float = R_M

    # -- construction ------------------------------------------------------

    @classmethod
    def from_geotiff(cls, path: str) -> "Dem":
        import tifffile

        with tifffile.TiffFile(path) as tif:
            page = tif.pages[0]
            geo = tif.geotiff_metadata
            if geo is None:
                raise ValueError(f"{path}: no GeoTIFF tags")
            if "ModelPixelScale" not in geo or "ModelTiepoint" not in geo:
                raise ValueError(f"{path}: needs ModelPixelScale and ModelTiepoint")

            if geo["ProjCoordTransGeoKey"].name != "PolarStereographic":
                raise ValueError(f"{path}: projection is {geo['ProjCoordTransGeoKey']!r}")
            if geo["ProjNatOriginLatGeoKey"] != -90.0:
                raise ValueError(f"{path}: not a south polar projection")
            if geo["ProjLinearUnitsGeoKey"].name != "Meter":
                raise ValueError(f"{path}: map units are not metres")
            if geo.get("ProjFalseEastingGeoKey", 0.0) or geo.get("ProjFalseNorthingGeoKey", 0.0):
                raise ValueError(f"{path}: false easting/northing not supported")
            a = geo["GeogSemiMajorAxisGeoKey"]
            b = geo["GeogSemiMinorAxisGeoKey"]
            if a != b:
                raise ValueError(f"{path}: reference body is not a sphere")
            if a != R_M:
                raise ValueError(f"{path}: sphere radius {a} m, expected {R_M} m")

            sx, sy, _ = geo["ModelPixelScale"]
            i, j, _, tx, ty, _ = geo["ModelTiepoint"][:6]
            raster_type = geo["GTRasterTypeGeoKey"].name
            if raster_type not in ("IsArea", "IsPoint"):
                raise ValueError(f"{path}: unknown raster type {raster_type}")

            data = page.asarray().astype(np.float32, copy=False)
            nodata = page.tags.get("GDAL_NODATA")
            if nodata is not None:
                nd = float(nodata.value)
                if not np.isnan(nd):
                    data = np.where(data == nd, np.nan, data)

        return cls(
            data=data,
            # tiepoint says raster (i, j) sits at map (tx, ty); move it to raster (0, 0)
            x0=tx - i * sx,
            y0=ty + j * sy,
            dx=sx,
            dy=sy,
            half=0.5 if raster_type == "IsArea" else 0.0,
            lon0_deg=geo.get("ProjStraightVertPoleLongGeoKey", 0.0),
            k0=geo.get("ProjScaleAtNatOriginGeoKey", 1.0),
            radius_m=a,
        )

    @classmethod
    def synthetic(cls, n: int, pixel_m: float, fill: float = 0.0) -> "Dem":
        """Square n x n grid centred on the pole, same layout as the LOLA files."""
        half_width = n * pixel_m / 2.0
        return cls(
            data=np.full((n, n), fill, dtype=np.float32),
            x0=-half_width, y0=half_width, dx=pixel_m, dy=pixel_m,
        )

    # -- geometry ----------------------------------------------------------

    def project(self, lat_deg, lon_deg):
        """Latitude/longitude (degrees) -> map x, y (metres).

        South polar stereographic on a sphere (Snyder 1987, polar aspect,
        south pole): rho = 2 R k0 tan(pi/4 + lat/2),
        x = rho sin(lon - lon0), y = rho cos(lon - lon0).
        """
        lat = np.radians(lat_deg)
        dlon = np.radians(np.asarray(lon_deg) - self.lon0_deg)
        rho = 2.0 * self.radius_m * self.k0 * np.tan(np.pi / 4.0 + lat / 2.0)
        return rho * np.sin(dlon), rho * np.cos(dlon)

    def unproject(self, x, y):
        """Map x, y (metres) -> latitude, longitude (degrees, 0..360 east)."""
        rho = np.hypot(x, y)
        lat = 2.0 * np.arctan(rho / (2.0 * self.radius_m * self.k0)) - np.pi / 2.0
        lon = np.degrees(np.arctan2(x, y)) + self.lon0_deg
        return np.degrees(lat), np.mod(lon, 360.0)

    def pixel_centre_xy(self, row, col):
        return (self.x0 + (np.asarray(col) + self.half) * self.dx,
                self.y0 - (np.asarray(row) + self.half) * self.dy)

    def sample_xy(self, x, y):
        """Bilinear height at map x, y. NaN outside the grid or next to no-data."""
        fc = (np.asarray(x, dtype=np.float64) - self.x0) / self.dx - self.half
        fr = (self.y0 - np.asarray(y, dtype=np.float64)) / self.dy - self.half
        nrows, ncols = self.data.shape
        c0 = np.floor(fc).astype(np.int64)
        r0 = np.floor(fr).astype(np.int64)
        ok = (c0 >= 0) & (c0 < ncols - 1) & (r0 >= 0) & (r0 < nrows - 1)
        c0 = np.where(ok, c0, 0)
        r0 = np.where(ok, r0, 0)
        tc = fc - c0
        tr = fr - r0
        d = self.data
        h = ((1 - tr) * ((1 - tc) * d[r0, c0] + tc * d[r0, c0 + 1])
             + tr * ((1 - tc) * d[r0 + 1, c0] + tc * d[r0 + 1, c0 + 1]))
        return np.where(ok, h, np.nan)

    def sample(self, lat_deg, lon_deg):
        return self.sample_xy(*self.project(lat_deg, lon_deg))


# --------------------------------------------------------------------------
# Horizon
# --------------------------------------------------------------------------

def local_frame(lat_deg: float, lon_deg: float):
    """Unit vectors: position p, local north n, local east e (Moon-fixed x, y, z).

    At the exact pole "north" is taken along the given longitude, so azimuth a
    points toward longitude lon + a.
    """
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    p = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    n = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    e = np.array([-np.sin(lon), np.cos(lon), 0.0])
    return p, n, e


def _points(p, n, e, az_rad, dist_m):
    """Latitude and longitude (degrees) of the points at each (azimuth, distance),
    walking along great circles in 3D: q = cos d * p + sin d * u."""
    d = np.asarray(dist_m) / R_M
    u = np.cos(az_rad)[..., None] * n + np.sin(az_rad)[..., None] * e
    q = np.cos(d)[..., None] * p + np.sin(d)[..., None] * u
    lat = np.degrees(np.arctan2(q[..., 2], np.hypot(q[..., 0], q[..., 1])))
    lon = np.degrees(np.arctan2(q[..., 1], q[..., 0]))
    return lat, lon


def _march(dem: Dem, p, n, e, az_rad, dist_m, ro, fallback: Dem | None = None):
    """Elevation angle (rad) of the terrain at each (azimuth, distance), and how
    many samples had to come from the fallback DEM."""
    lat, lon = _points(p, n, e, az_rad[:, None], dist_m[None, :])
    height = dem.sample(lat, lon)                     # NaN where there is no terrain data
    borrowed = 0
    if fallback is not None:
        hole = np.isnan(height)
        borrowed = int(hole.sum())
        if borrowed:
            height = np.where(hole, fallback.sample(lat, lon), height)
    d = dist_m / R_M
    rt = R_M + height
    return np.arctan2(rt * np.cos(d) - ro, rt * np.sin(d)), borrowed


def _sweep(lat_deg, lon_deg, observer_height_m, near, far, near_limit_km, far_limit_km,
           n_az, detail, detail_limit_km):
    """Elevation angle of the terrain along every ray. Shared by horizon() and view()."""
    ground = near if detail is None else detail
    site_height = float(ground.sample(lat_deg, lon_deg))
    if np.isnan(site_height):
        raise ValueError("site is outside the DEM or on a no-data cell")
    ro = R_M + site_height + observer_height_m

    p, n, e = local_frame(lat_deg, lon_deg)
    az_deg = np.arange(n_az) * (360.0 / n_az)
    az = np.radians(az_deg)

    # (DEM, where its stretch ends in metres, DEM to borrow from where the first
    # has no data); each stretch starts one step past the end of the one before,
    # and the step is half a pixel
    tiers = []
    if detail is not None:
        tiers.append((detail, detail_limit_km * 1000.0, near))
    tiers.append((near, near_limit_km * 1000.0, None))
    if far is not None and far_limit_km > near_limit_km:
        tiers.append((far, far_limit_km * 1000.0, None))
    dist, elev, begin, borrowed = [], [], 0.0, 0
    for dem, end, fallback in tiers:
        step = 0.5 * min(dem.dx, dem.dy)
        d = np.arange(begin + step, end + 0.5 * step, step)
        angles, took = _march(dem, p, n, e, az, d, ro, fallback)
        dist.append(d)
        elev.append(angles)
        borrowed += took
        begin = end
    detail_samples = elev[0].size if detail is not None else 0
    dist = np.concatenate(dist)
    elev = np.concatenate(elev, axis=1)
    missing = np.isnan(elev)
    elev = np.where(missing, -np.inf, elev)
    if np.any(np.isinf(elev.max(axis=1))):
        raise ValueError("an azimuth has no terrain data at all")
    return {"p": p, "n": n, "e": e, "ro": ro, "az_deg": az_deg, "dist": dist, "elev": elev,
            "site_height": site_height, "skipped": int(missing.sum()), "samples": int(missing.size),
            "detail_samples": detail_samples, "detail_borrowed": borrowed}


def horizon(lat_deg: float, lon_deg: float, observer_height_m: float,
            near: Dem, far: Dem | None = None,
            near_limit_km: float = 100.0, far_limit_km: float = 300.0,
            n_az: int = N_AZ,
            detail: Dem | None = None, detail_limit_km: float = 5.0):
    """Terrain horizon around a site.

    The near DEM is used out to near_limit_km, the far DEM from there to
    far_limit_km. The step along each ray is half a pixel of the DEM in use.
    Terrain beyond the last distance is not considered.

    If a detail DEM is given it replaces the near DEM out to detail_limit_km,
    and the height of the ground under the observer is read from it. Where the
    detail DEM has no data, the near DEM is used for that sample instead.

    Returns a dict with
      azimuth_deg    (n_az,) 0, 360/n_az, ... clockwise from north
      elevation_deg  (n_az,) horizon angle, can be negative
      distance_km    (n_az,) arc length on the reference sphere to the terrain
                     point that sets the horizon
      site_height_m  DEM height at the site (above the 1737.4 km sphere)
      skipped        number of samples with no terrain data
      samples        total number of samples
      detail_samples, detail_borrowed
                     samples inside the detail stretch, and how many of them
                     had to be read from the near DEM
    """
    s = _sweep(lat_deg, lon_deg, observer_height_m, near, far, near_limit_km, far_limit_km,
               n_az, detail, detail_limit_km)
    best = np.argmax(s["elev"], axis=1)
    return {
        "azimuth_deg": s["az_deg"],
        "elevation_deg": np.degrees(s["elev"][np.arange(n_az), best]),
        "distance_km": s["dist"][best] / 1000.0,
        "site_height_m": s["site_height"],
        "skipped": s["skipped"],
        "samples": s["samples"],
        "detail_samples": s["detail_samples"],
        "detail_borrowed": s["detail_borrowed"],
    }


# --------------------------------------------------------------------------
# What the ground looks like below the skyline
# --------------------------------------------------------------------------

VIEW_AZ = 360          # one column per degree of azimuth
VIEW_EL_TOP = 2.4      # degrees; above the highest skyline of any site
VIEW_EL_STEP = 0.2
VIEW_ROWS = 52         # down to -8 degrees


def _slopes(dem: Dem, lat, lon):
    """Ground slope toward east and toward north at the given points."""
    x, y = dem.project(lat, lon)
    zx = (dem.sample_xy(x + dem.dx, y) - dem.sample_xy(x - dem.dx, y)) / (2.0 * dem.dx)
    zy = (dem.sample_xy(x, y + dem.dy) - dem.sample_xy(x, y - dem.dy)) / (2.0 * dem.dy)
    lam = np.radians(lon - dem.lon0_deg)
    # on the map, east at a point is (cos lon, -sin lon) and north is (sin lon, cos lon);
    # map lengths are k times ground lengths, k = 2 k0 / (1 + sin |lat|)
    k = 2.0 * dem.k0 / (1.0 + np.sin(np.radians(-lat)))
    return k * (zx * np.cos(lam) - zy * np.sin(lam)), k * (zx * np.sin(lam) + zy * np.cos(lam))


def view(lat_deg: float, lon_deg: float, observer_height_m: float,
         near: Dem, far: Dem | None = None,
         near_limit_km: float = 100.0, far_limit_km: float = 300.0,
         detail: Dem | None = None, detail_limit_km: float = 5.0):
    """Which way the ground faces at every point of the panorama.

    For each azimuth (VIEW_AZ columns) and each elevation row, the first
    terrain point the line of sight meets is found from the same march as the
    horizon. The unit normal of the ground there is returned in the
    observer's own east / north / up directions. Rows above the skyline carry
    the normal of the skyline point, so the picture has no holes.

    Returns normal (rows, columns, 3) and distance_km (rows, columns).
    """
    s = _sweep(lat_deg, lon_deg, observer_height_m, near, far, near_limit_km, far_limit_km,
               VIEW_AZ, detail, detail_limit_km)
    elev, dist = s["elev"], s["dist"]
    row_el = np.radians(VIEW_EL_TOP - (np.arange(VIEW_ROWS) + 0.5) * VIEW_EL_STEP)
    seen = np.maximum.accumulate(elev, axis=1)      # highest terrain so far along the ray
    best = np.argmax(elev, axis=1)
    index = np.empty((VIEW_ROWS, VIEW_AZ), dtype=np.int64)
    for i in range(VIEW_AZ):
        index[:, i] = np.minimum(np.searchsorted(seen[i], row_el), best[i])
    d = dist[index]

    az = np.radians(s["az_deg"])[None, :] * np.ones((VIEW_ROWS, 1))
    lat, lon = _points(s["p"], s["n"], s["e"], az, d)
    se = np.full(d.shape, np.nan)
    sn = np.full(d.shape, np.nan)
    # finest DEM first; each one fills what the finer ones could not
    order = ([(detail, detail_limit_km * 1000.0)] if detail is not None else []) + \
            [(near, near_limit_km * 1000.0)] + ([(far, np.inf)] if far is not None else [])
    for dem, limit in order:
        want = np.isnan(se) & (d <= limit)
        if want.any():
            e_slope, n_slope = _slopes(dem, lat[want], lon[want])
            se[want], sn[want] = e_slope, n_slope
    flat = np.isnan(se) | np.isnan(sn)
    se[flat], sn[flat] = 0.0, 0.0

    # normal in the frame of the terrain point, then in the Moon's frame, then in the observer's
    la, lo = np.radians(lat), np.radians(lon)
    up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
    north = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], axis=-1)
    east = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], axis=-1)
    normal = up - se[..., None] * east - sn[..., None] * north
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    in_observer_frame = np.stack([normal @ s["e"], normal @ s["n"], normal @ s["p"]], axis=-1)
    return {"normal": in_observer_frame, "distance_km": d / 1000.0, "flat_filled": int(flat.sum())}


def write_view(path: str, normal, header_extra: dict | None = None) -> None:
    """File layout (little-endian), same idea as the sky table:
      4 bytes "LVEW", uint32 length of the JSON header, JSON header (padded to an
      even length), then for every row (top first) and column two signed bytes:
      east and north part of the unit ground normal, times 127."""
    import json
    import struct
    header = {
        "columns": VIEW_AZ, "rows": VIEW_ROWS,
        "azimuth": "column i is i degrees clockwise from north",
        "elevation_top_deg": VIEW_EL_TOP, "elevation_step_deg": VIEW_EL_STEP,
        "values": "int8 east, int8 north of the unit ground normal x 127, in the observer's east/north/up frame",
    }
    header.update(header_extra or {})
    text = json.dumps(header, separators=(",", ":")).encode("utf-8")
    text += b" " * ((-len(text)) % 2)
    data = np.round(normal[..., :2] * 127.0).astype(np.int8)
    with open(path, "wb") as f:
        f.write(b"LVEW" + struct.pack("<I", len(text)) + text + data.tobytes())


def top_peaks(az_deg, elev_deg, count: int = 3, min_separation_deg: float = 10.0):
    """Indices of the highest horizon directions, at least min_separation apart."""
    free = np.ones(len(az_deg), dtype=bool)
    picked = []
    for _ in range(count):
        if not free.any():
            break
        i = int(np.argmax(np.where(free, elev_deg, -np.inf)))
        picked.append(i)
        gap = np.abs((az_deg - az_deg[i] + 180.0) % 360.0 - 180.0)
        free &= gap >= min_separation_deg
    return picked


# --------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True, help="east-positive degrees")
    ap.add_argument("--height", type=float, default=2.0, help="observer height above terrain, m")
    ap.add_argument("--near", default="data/raw/LDEM_80S_80MPP_ADJ.TIF")
    ap.add_argument("--far", default="data/raw/LDEM_60S_240MPP_ADJ.TIF")
    ap.add_argument("--out", required=True, help="output JSON")
    args = ap.parse_args()

    near = Dem.from_geotiff(args.near)
    far = Dem.from_geotiff(args.far)
    h = horizon(args.lat, args.lon, args.height, near, far)

    out = {
        "lat": args.lat, "lon": args.lon,
        "observer_height_m": args.height,
        "site_height_m": round(h["site_height_m"], 2),
        "frame": "MOON_ME, east-positive, sphere 1737.4 km, no refraction",
        "azimuth": "clockwise from north; index i is i * 0.5 degrees",
        "near_dem": args.near.split("/")[-1], "near_limit_km": 100.0,
        "far_dem": args.far.split("/")[-1], "far_limit_km": 300.0,
        "samples": h["samples"], "skipped_no_data": h["skipped"],
        "elevation_deg": [round(float(v), 4) for v in h["elevation_deg"]],
        "distance_km": [round(float(v), 3) for v in h["distance_km"]],
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")

    el, az, dk = h["elevation_deg"], h["azimuth_deg"], h["distance_km"]
    print(f"site height in DEM: {h['site_height_m']:.2f} m")
    print(f"samples {h['samples']}, without terrain data {h['skipped']}")
    print(f"horizon min {el.min():.4f}  median {np.median(el):.4f}  max {el.max():.4f} deg")
    for limit in (1.5, 2.0):
        print(f"below {limit} deg: {100.0 * np.mean(el < limit):.1f} % of azimuths")
    print("highest three directions (at least 10 deg apart):")
    for i in top_peaks(az, el):
        print(f"  az {az[i]:6.1f}  elevation {el[i]:7.4f} deg  distance {dk[i]:8.3f} km")


if __name__ == "__main__":
    main()
