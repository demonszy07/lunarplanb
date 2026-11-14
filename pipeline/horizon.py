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


def _march(dem: Dem, p, n, e, az_rad, dist_m, ro):
    """Elevation angle (rad) of the terrain at each (azimuth, distance)."""
    d = dist_m / R_M                                  # central angle, shape (nd,)
    u = np.cos(az_rad)[:, None] * n + np.sin(az_rad)[:, None] * e   # (naz, 3)
    # great circle in 3D: q = cos d * p + sin d * u
    q = np.cos(d)[None, :, None] * p + np.sin(d)[None, :, None] * u[:, None, :]
    lat = np.degrees(np.arctan2(q[..., 2], np.hypot(q[..., 0], q[..., 1])))
    lon = np.degrees(np.arctan2(q[..., 1], q[..., 0]))
    rt = R_M + dem.sample(lat, lon)                   # NaN where there is no terrain data
    return np.arctan2(rt * np.cos(d) - ro, rt * np.sin(d))


def horizon(lat_deg: float, lon_deg: float, observer_height_m: float,
            near: Dem, far: Dem | None = None,
            near_limit_km: float = 100.0, far_limit_km: float = 300.0,
            n_az: int = N_AZ):
    """Terrain horizon around a site.

    The near DEM is used out to near_limit_km, the far DEM from there to
    far_limit_km. The step along each ray is half a pixel of the DEM in use.
    Terrain beyond the last distance is not considered.

    Returns a dict with
      azimuth_deg    (n_az,) 0, 360/n_az, ... clockwise from north
      elevation_deg  (n_az,) horizon angle, can be negative
      distance_km    (n_az,) arc length on the reference sphere to the terrain
                     point that sets the horizon
      site_height_m  DEM height at the site (above the 1737.4 km sphere)
      skipped        number of samples with no terrain data
      samples        total number of samples
    """
    site_height = float(near.sample(lat_deg, lon_deg))
    if np.isnan(site_height):
        raise ValueError("site is outside the near DEM or on a no-data cell")
    ro = R_M + site_height + observer_height_m

    p, n, e = local_frame(lat_deg, lon_deg)
    az_deg = np.arange(n_az) * (360.0 / n_az)
    az = np.radians(az_deg)

    step_near = 0.5 * min(near.dx, near.dy)
    dist = [np.arange(step_near, near_limit_km * 1000.0 + 0.5 * step_near, step_near)]
    elev = [_march(near, p, n, e, az, dist[0], ro)]
    if far is not None and far_limit_km > near_limit_km:
        step_far = 0.5 * min(far.dx, far.dy)
        dist.append(np.arange(near_limit_km * 1000.0 + step_far,
                              far_limit_km * 1000.0 + 0.5 * step_far, step_far))
        elev.append(_march(far, p, n, e, az, dist[1], ro))
    dist = np.concatenate(dist)
    elev = np.concatenate(elev, axis=1)

    missing = np.isnan(elev)
    elev = np.where(missing, -np.inf, elev)
    best = np.argmax(elev, axis=1)
    rows = np.arange(n_az)
    best_elev = elev[rows, best]
    if np.any(np.isinf(best_elev)):
        raise ValueError("an azimuth has no terrain data at all")

    return {
        "azimuth_deg": az_deg,
        "elevation_deg": np.degrees(best_elev),
        "distance_km": dist[best] / 1000.0,
        "site_height_m": site_height,
        "skipped": int(missing.sum()),
        "samples": int(missing.size),
    }


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
