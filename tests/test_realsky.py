"""Stars and the turning Earth: the Python reference, and the browser code against it."""

import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import realsky  # noqa: E402

STARS = os.path.join(ROOT, "site", "data", "stars.bin")
EARTH = os.path.join(ROOT, "site", "data", "earth.bin")


def angle_diff(a, b):
    return (np.asarray(a) - np.asarray(b) + 180.0) % 360.0 - 180.0


def test_moon_matrix_is_a_rotation():
    for hours in (0.0, 10176.5, 43000.0):
        m = realsky.moon_matrix(hours)
        assert np.allclose(m @ m.T, np.eye(3), atol=1e-12)
        assert np.linalg.det(m) == pytest.approx(1.0, abs=1e-12)


def test_moon_pole_and_spin():
    # the Moon's north pole stays within 2 degrees of RA 270, Dec 66.5 (the ecliptic pole region)
    m = realsky.moon_matrix(12345.0)
    pole = m.T @ np.array([0.0, 0.0, 1.0])
    assert np.degrees(np.arcsin(pole[2])) == pytest.approx(66.54, abs=1.7)
    # one turn takes 27.32 days: after that long a star is back at the same azimuth and elevation
    a = realsky.star_az_el(101.287, -16.716, 5000.0, -89.45, 222.69)
    b = realsky.star_az_el(101.287, -16.716, 5000.0 + 27.321661 * 24, -89.45, 222.69)
    assert abs(angle_diff(a[0], b[0])) < 0.5 and abs(a[1] - b[1]) < 0.5


def test_star_file():
    ra, dec, mag = realsky.read_stars(STARS)
    assert len(ra) == 2887
    assert mag.max() <= 5.5 + 1e-6 and np.all(np.diff(mag) >= -1e-6)       # brightest first
    # Sirius leads the list, at its catalogue place (RA 6h45m08.9s, Dec -16d42'58")
    assert mag[0] == pytest.approx(-1.46, abs=0.02)
    assert ra[0] == pytest.approx(101.2871, abs=0.006)
    assert dec[0] == pytest.approx(-16.7161, abs=0.003)


def test_earth_table_and_disc():
    table = realsky.read_earth(EARTH)
    lon, lat = realsky.earth_facing(table, 0.0)
    assert lon == pytest.approx(323.268, abs=0.01)                         # first row of the Horizons table
    assert lat == pytest.approx(26.558, abs=0.01)
    # centre of the disc is the facing point; with the pole straight up, north is up and east is right
    assert realsky.earth_point(0.0, 0.0, 30.0, 10.0, 0.0) == pytest.approx((30.0, 10.0))
    assert realsky.earth_point(0.0, 0.5, 30.0, 10.0, 0.0)[1] > 10.0
    assert realsky.earth_point(0.5, 0.0, 30.0, 10.0, 0.0)[0] > 30.0
    # pole pointing down (as from the Moon's south pole): north is at the bottom
    assert realsky.earth_point(0.0, -0.5, 30.0, 10.0, 180.0)[1] > 10.0
    # Sun behind Earth: the disc's own +z (toward us) faces away from it
    assert realsky.sun_on_disc(100.0, 2.0, 100.0, 2.0)[2] == pytest.approx(-1.0)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_javascript_matches_python(capsys):
    rng = np.random.default_rng(11)
    ra, dec, mag = realsky.read_stars(STARS)
    table = realsky.read_earth(EARTH)
    sites = [(-89.4527, 222.8513), (-85.9876, 2.0528), (-86.3628, 336.7905)]
    sky = [[float(rng.uniform(0, 43000)), *sites[i % 3], [int(k) for k in rng.integers(0, len(ra), 30)]]
           for i in range(12)]
    case = {
        "stars": STARS, "earth": EARTH,
        "matrix": [0.0, 10176.0, 43000.25],
        "sky": sky,
        "facing": [float(h) for h in rng.uniform(0, 43800, 50)],
        "pole": [[float(rng.uniform(0, 43000)), *sites[i % 3], float(rng.uniform(0, 360)), float(rng.uniform(-8, 11))]
                 for i in range(30)],
        "point": [[float(x), float(y), float(rng.uniform(0, 360)), float(rng.uniform(-28, 28)), float(rng.uniform(-180, 180))]
                  for x, y in rng.uniform(-0.7, 0.7, (40, 2))],
        "sun": [[float(rng.uniform(0, 360)), float(rng.uniform(-2, 2)), float(rng.uniform(0, 360)), float(rng.uniform(-8, 11))]
                for _ in range(30)],
    }
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "run_realsky_js.mjs")],
                          input=json.dumps(case), capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    js = json.loads(done.stdout)
    assert js["count"] == len(ra)
    for hours, got in zip(case["matrix"], js["matrix"]):
        assert np.abs(np.array(got).reshape(3, 3) - realsky.moon_matrix(hours)).max() < 1e-12
    worst = 0.0
    for (hours, lat, lon, index), got in zip(sky, js["stars"]):
        az, el = realsky.star_az_el(ra[index], dec[index], hours, lat, lon)
        got = np.array(got)
        worst = max(worst, np.abs(angle_diff(got[:, 0], az) * np.cos(np.radians(el))).max(), np.abs(got[:, 1] - el).max())
        assert np.abs(got[:, 2] - mag[index]).max() < 1e-5
    assert worst < 1e-4                      # the browser keeps star places as 32-bit numbers
    want = np.array([realsky.earth_facing(table, h) for h in case["facing"]])
    assert np.abs(angle_diff(np.array(js["facing"])[:, 0], want[:, 0])).max() < 1e-9
    assert np.abs(np.array(js["facing"])[:, 1] - want[:, 1]).max() < 1e-9
    want = [realsky.earth_pole_angle(*c) for c in case["pole"]]
    assert np.abs(angle_diff(js["pole"], want)).max() < 1e-9
    want = np.array([realsky.earth_point(*c) for c in case["point"]])
    assert np.abs(angle_diff(np.array(js["point"])[:, 0], want[:, 0])).max() < 1e-9
    assert np.abs(np.array(js["point"])[:, 1] - want[:, 1]).max() < 1e-9
    want = np.array([realsky.sun_on_disc(*c) for c in case["sun"]])
    assert np.abs(np.array(js["sun"]) - want).max() < 1e-12
    with capsys.disabled():
        print(f"\nstars, JavaScript vs Python: 360 places, largest difference {worst:.2e} deg")
