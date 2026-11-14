"""Tests for pipeline/horizon.py on synthetic terrain with known answers."""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))

from horizon import Dem, R_M, horizon, local_frame  # noqa: E402


def flat_near():
    return Dem.synthetic(2600, 80.0)      # +-104 km, 80 m pixels like the near DEM


def flat_far():
    return Dem.synthetic(2600, 240.0)     # +-312 km, 240 m pixels like the far DEM


def test_flat_sphere_observer_2m():
    h = horizon(-89.4527, 222.8513, 2.0, flat_near(), flat_far())
    # dip of the horizon = -acos(R / (R + 2 m)) = -0.0869 deg
    assert np.allclose(h["elevation_deg"], -0.087, atol=0.002)
    # tangent point at sqrt(2 R h) = 2.64 km
    assert np.allclose(h["distance_km"], 2.64, atol=0.1)


def test_flat_sphere_observer_5km():
    h = horizon(-89.4527, 222.8513, 5000.0, flat_near(), flat_far())
    # -acos(R / (R + 5 km)) = -4.342 deg, tangent point 131.6 km away (in the far DEM)
    assert np.allclose(h["elevation_deg"], -4.342, atol=0.005)
    assert np.allclose(h["distance_km"], 131.6, atol=1.0)


def test_wall_10km_north():
    lat, lon = -89.5, 40.0
    dem = Dem.synthetic(3000, 20.0)       # +-30 km, 20 m pixels
    # Wall 1 km high, 10 to 12 km north of the observer, 40 km wide east-west,
    # laid out in the observer's own north/east directions.
    rows, cols = np.indices(dem.data.shape)
    plat, plon = dem.unproject(*dem.pixel_centre_xy(rows, cols))
    plat, plon = np.radians(plat), np.radians(plon)
    q = np.stack([np.cos(plat) * np.cos(plon), np.cos(plat) * np.sin(plon), np.sin(plat)], axis=-1)
    _, n, e = local_frame(lat, lon)
    north_m = R_M * np.arcsin(q @ n)
    east_m = R_M * np.arcsin(q @ e)
    dem.data[(north_m >= 10000.0) & (north_m <= 12000.0) & (np.abs(east_m) <= 20000.0)] = 1000.0

    h = horizon(lat, lon, 2.0, dem, near_limit_km=25.0)
    el, dist = h["elevation_deg"], h["distance_km"]

    # north (azimuth 0): atan((rt cos d - ro) / (rt sin d)) at 10 km = 5.53 deg
    assert el[0] == pytest.approx(5.53, abs=0.02)
    assert dist[0] == pytest.approx(10.0, abs=0.05)
    # south half (azimuth 90..270) sees only the flat sphere
    south = slice(180, 541)
    assert np.allclose(el[south], -0.087, atol=0.002)


def test_rotating_dem_shifts_profile_by_90_degrees():
    # Observer exactly on the pole: there azimuth a points toward longitude a,
    # so turning the terrain a quarter turn about the pole must slide the
    # profile by exactly 90 degrees = 180 samples.
    n = 1000
    dem = Dem.synthetic(n, 80.0)
    rows, cols = np.indices(dem.data.shape)
    x, y = dem.pixel_centre_xy(rows, cols)
    rng = np.random.default_rng(1)
    for _ in range(12):                    # lopsided set of hills
        cx, cy = rng.uniform(-30000, 30000, 2)
        dem.data += (rng.uniform(200, 1500)
                     * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * rng.uniform(1500, 5000) ** 2))
                     ).astype(np.float32)
    dem.data -= dem.data[n // 2 - 1:n // 2 + 1, n // 2 - 1:n // 2 + 1].mean()

    turned = Dem.synthetic(n, 80.0)
    turned.data = np.rot90(dem.data).copy()

    # Which way did the terrain turn in longitude? Work it out from the
    # georeferencing: np.rot90 moves element [r, c] to [n - 1 - c, r].
    r, c = 100, 300
    _, lon_before = dem.unproject(*dem.pixel_centre_xy(r, c))
    _, lon_after = dem.unproject(*dem.pixel_centre_xy(n - 1 - c, r))
    turn = (lon_after - lon_before + 180.0) % 360.0 - 180.0
    assert abs(turn) == pytest.approx(90.0, abs=1e-6)

    a = horizon(-90.0, 0.0, 2.0, dem, near_limit_km=35.0)
    b = horizon(-90.0, 0.0, 2.0, turned, near_limit_km=35.0)

    assert np.ptp(a["elevation_deg"]) > 1.0          # the profile is not flat
    shift = int(round(turn / 0.5))                   # +-180 samples
    assert np.allclose(b["elevation_deg"], np.roll(a["elevation_deg"], shift), atol=1e-6)
    assert np.allclose(b["distance_km"], np.roll(a["distance_km"], shift), atol=1e-6)
    # and the shift is real: unshifted profiles differ
    assert not np.allclose(b["elevation_deg"], a["elevation_deg"], atol=0.1)


def test_projection_round_trip_and_axes():
    dem = Dem.synthetic(100, 80.0)
    # +y is longitude 0, +x is longitude 90 E (read from the projection formula)
    x, y = dem.project(-89.0, 0.0)
    assert abs(x) < 1e-6 and y > 0
    x, y = dem.project(-89.0, 90.0)
    assert x > 0 and abs(y) < 1e-6
    # distance from the pole on the map is close to the arc length near the pole
    assert np.hypot(*dem.project(-89.0, 222.8513)) == pytest.approx(R_M * np.radians(1.0), rel=1e-4)
    lat, lon = dem.unproject(*dem.project(-89.4527, 222.8513))
    assert lat == pytest.approx(-89.4527, abs=1e-9)
    assert lon == pytest.approx(222.8513, abs=1e-9)


def test_projection_matches_pyproj():
    pyproj = pytest.importorskip("pyproj")
    tr = pyproj.Transformer.from_crs(
        "+proj=longlat +R=1737400 +no_defs",
        "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
        always_xy=True)
    dem = Dem.synthetic(100, 80.0)
    lats = np.array([-89.4527, -88.0, -85.0, -81.0])
    lons = np.array([222.8513, 10.0, 130.0, 300.0])
    px, py = tr.transform(lons, lats)
    x, y = dem.project(lats, lons)
    assert np.allclose(x, px, atol=1e-3)
    assert np.allclose(y, py, atol=1e-3)
