"""The terrain files of the 3D view: grid layout, curvature, and agreement with the horizon files."""

import glob
import json
import os
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_3d  # noqa: E402
from horizon import Dem, R_M, local_frame  # noqa: E402

SITES_DIR = os.path.join(ROOT, "data", "sites")
RAW = os.path.join(ROOT, "data", "raw")


def test_curvature_drop_at_20_km():
    # level ground (height 0 everywhere) 20 km away lies R (1 - cos(d / R)) below the site's horizontal
    east, north, up = build_3d.local_position(20000.0, 0.0, 0.0, 0.0)
    assert up == pytest.approx(-R_M * (1 - np.cos(20000.0 / R_M)))
    assert up == pytest.approx(-115.1, abs=0.05)
    assert east == pytest.approx(R_M * np.sin(20000.0 / R_M)) and north == 0.0
    # at the site itself only the height difference is left
    assert build_3d.local_position(0.0, 0.0, 12.5, 10.0).tolist() == [0.0, 0.0, 2.5]
    # a point higher than the site by the drop sits back on the horizontal
    assert build_3d.local_position(0.0, -20000.0, 115.117, 0.0)[2] == pytest.approx(0.0, abs=0.01)


def test_grid_rows_run_north_and_columns_east():
    lat, lon = -89.45, 222.69
    n, lats, lons = build_3d.grid_points(lat, lon, 250.0, 5.0)
    assert n == 101 and lats.shape == (1, 101, 101)
    c = 50
    assert lats[0, c, c] == pytest.approx(lat) and lons[0, c, c] % 360 == pytest.approx(lon)
    p, north, east = local_frame(lat, lon)

    def offset(row, col):
        la, lo = np.radians(lats[0, row, col]), np.radians(lons[0, row, col])
        q = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
        return (q - p) @ east * R_M, (q - p) @ north * R_M

    assert offset(c, c + 10) == pytest.approx((50.0, 0.0), abs=0.01)       # ten columns: 50 m east
    assert offset(c + 10, c) == pytest.approx((0.0, 50.0), abs=0.01)       # ten rows: 50 m north
    # averaging: four sub-points sit a quarter step either side of the grid point
    _, lats4, _ = build_3d.grid_points(lat, lon, 20000.0, 160.0, 2)
    assert lats4.shape == (4, 251, 251)


def test_site_files_agree_with_the_horizon_files(capsys):
    files = sorted(glob.glob(os.path.join(SITES_DIR, "*_3d.bin")))
    assert len(files) == 7
    lines = []
    for path in files:
        header, grids, far = build_3d.read_3d(path)
        assert [(lv["name"], lv["size"]) for lv in header["levels"]] == [
            ("outer", 251), ("wide", 251), ("local", 201), ("middle", 201), ("near", 101)]
        assert os.path.getsize(path) < 445000
        for suffix, height in (("", 2.0), ("_5m", 5.0)):
            with open(os.path.join(SITES_DIR, header["site"] + suffix + ".json")) as f:
                site = json.load(f)
            assert (site["lat"], site["lon"]) == (header["lat"], header["lon"])
            # the ground under the observer is the same ground
            assert grids["near"][50, 50] == pytest.approx(site["site_height_m"], abs=0.02)
            # a far-only horizon can never be above the full horizon, and is the full horizon
            # wherever that one is set by terrain beyond the corners of the square left out
            full, dist = np.array(site["elevation_deg"]), np.array(site["distance_km"])
            for square in (19200.0, 120000.0):
                profile = far[(square, height)]
                assert np.all(profile <= full + 0.001)
                beyond = dist > square * 2 ** 0.5 / 1000 + 0.1
                assert np.allclose(profile[beyond], full[beyond], atol=0.001)
            beyond = dist > 19200.0 * 2 ** 0.5 / 1000 + 0.1
        mid_vs_near = abs(grids["middle"][100, 100] - grids["near"][50, 50])
        lines.append(f"{header['site']:9} centre: near {grids['near'][50, 50]:8.2f} m, middle differs by {mid_vs_near:5.2f} m, "
                     f"local by {abs(grids['local'][100, 100] - grids['near'][50, 50]):5.2f} m, "
                     f"wide by {abs(grids['wide'][125, 125] - grids['near'][50, 50]):5.2f} m; "
                     f"horizon set beyond the shadowed mesh at {int(beyond.sum()):3d} of 720 azimuths (panels 5 m)")
    with capsys.disabled():
        print("\n" + "\n".join(lines))


@pytest.mark.skipif(not os.path.exists(os.path.join(RAW, "pgda78", "Site01_final_adj_5mpp_surf.tif")),
                    reason="terrain maps not downloaded")
def test_near_grid_is_the_5m_map():
    header, grids, _ = build_3d.read_3d(os.path.join(SITES_DIR, "site01_3d.bin"))
    tile = Dem.from_geotiff(os.path.join(RAW, "pgda78", "Site01_final_adj_5mpp_surf.tif"))
    _, lats, lons = build_3d.grid_points(header["lat"], header["lon"], 250.0, 5.0)
    want = tile.sample(lats[0], lons[0])
    scale = {lv["name"]: lv["scale"] for lv in header["levels"]}
    assert np.max(np.abs(grids["near"] - want)) <= scale["near"] / 2 + 1e-4
    # middle grid: mean of 4 x 4 samples of the same map
    heights, borrowed = build_3d.level_heights(header["lat"], header["lon"], 2000.0, 20.0, 4, tile, None)
    assert borrowed == 0.0
    assert np.max(np.abs(grids["middle"] - heights)) <= scale["middle"] / 2 + 1e-4
