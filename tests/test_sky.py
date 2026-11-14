"""Tests for the sky calculation, the small browser table and site/js/sky.js."""

import datetime as dt
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import ephemeris  # noqa: E402
import sky  # noqa: E402

RAW = os.path.join(ROOT, ephemeris.RAW_PATH)
BIN = os.path.join(ROOT, "site", "data", "sky.bin")
POINTS = [(-89.45, 222.69), (-89.90, 0.00), (-88.80, 68.00), (-87.50, 300.00), (-85.00, 150.00)]

needs_raw = pytest.mark.skipif(not os.path.exists(RAW),
                               reason="raw Horizons table not downloaded (python pipeline/ephemeris.py)")


def az_diff(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


# -- geometry on made-up inputs (no data files needed) ----------------------

def test_body_straight_overhead():
    az, el, diam = sky.direction(-89.45, 222.69, -89.45, 222.69, 384400.0, 6378.137)
    assert el == pytest.approx(90.0, abs=1e-6)
    assert diam == pytest.approx(2 * np.degrees(np.arcsin(6378.137 / (384400.0 - 1737.4))), abs=1e-12)


def test_azimuth_points_at_the_sub_point():
    # From the equator at longitude 0, a far body over the north pole is due
    # north on the horizon, and one over longitude 90 E is due east.
    far = 1e12
    az, el, _ = sky.direction(0.0, 0.0, 90.0, 0.0, far, 1.0)
    assert az_diff(az, 0.0) == pytest.approx(0.0, abs=1e-6) and el == pytest.approx(0.0, abs=1e-6)
    az, el, _ = sky.direction(0.0, 0.0, 0.0, 90.0, far, 1.0)
    assert az == pytest.approx(90.0, abs=1e-6) and el == pytest.approx(0.0, abs=1e-6)


def test_parallax_lowers_a_nearby_body():
    # Body over the equator, seen from the pole: on the horizon if infinitely
    # far, below it by asin(R / D) at distance D.
    d = 384400.0
    _, el, _ = sky.direction(-90.0, 0.0, 0.0, 0.0, d, 1.0)
    assert el == pytest.approx(-np.degrees(np.arctan(1737.4 / d)), abs=1e-9)
    assert el == pytest.approx(-0.259, abs=0.001)


# -- against the Horizons table ---------------------------------------------

@needs_raw
def test_known_rows_site_1():
    # Rows written in CLAUDE.md for 2026-11-14 00:00 UT. The Earth azimuth
    # differs from that row by 0.004 deg; the tolerance says so openly.
    table = ephemeris.load(RAW)
    r = sky.sky(table, ephemeris.hours_since_epoch(dt.datetime(2026, 11, 14)), -89.45, 222.69)
    assert az_diff(r["sun"][0], 263.9129) == pytest.approx(0.0, abs=0.001)
    assert r["sun"][1] == pytest.approx(1.4984, abs=0.001)
    assert az_diff(r["earth"][0], 136.0519) == pytest.approx(0.0, abs=0.006)
    assert r["earth"][1] == pytest.approx(-5.0442, abs=0.001)


@needs_raw
def test_small_table_is_current():
    fresh = sky.reduce(ephemeris.load(RAW))
    stored = sky.read_bin(BIN)
    for ch in fresh["channels"]:
        hours = stored["hours"]
        value = ch["offset"] + ch["rate"] * hours + ch["scale"] * ch["ints"]
        assert np.array_equal(value, stored[ch["name"]]), ch["name"]


@needs_raw
def test_small_table_error_against_hourly(capsys):
    """3-hour samples + 16-bit packing + straight-line interpolation,
    measured at every hour of the hourly table. Target: below 0.005 deg."""
    full = ephemeris.load(RAW)
    small = sky.read_bin(BIN)
    hours = full["hours"]
    lines = []
    for name in sky.CHANNELS:
        err = np.abs(np.interp(hours, small["hours"], small[name]) - full[name])
        lines.append(f"{name:10} max error {err.max():.6f} {'km' if name.endswith('km') else 'deg'}")
        if not name.endswith("km"):
            assert err.max() < 0.005
    worst = {"sun": 0.0, "earth": 0.0}
    for lat, lon in POINTS:
        a = sky.sky(full, hours, lat, lon)
        b = sky.sky(small, hours, lat, lon)
        for body in worst:
            d_az = np.abs(az_diff(b[body][0], a[body][0]) * np.cos(np.radians(a[body][1])))
            d_el = np.abs(b[body][1] - a[body][1])
            worst[body] = max(worst[body], d_az.max(), d_el.max())
    for body, w in worst.items():
        lines.append(f"{body:10} max azimuth/elevation error at 5 points {w:.6f} deg")
        assert w < 0.005
    with capsys.disabled():
        print("\n" + "\n".join(lines))


# -- JavaScript against Python ----------------------------------------------

@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_javascript_matches_python(capsys):
    table = sky.read_bin(BIN)
    rng = np.random.default_rng(7)
    last = table["hours"][-1]
    cases = []
    for lat, lon in POINTS + [(-90.0, 0.0), (12.3, 45.6)]:
        for h in rng.uniform(0.0, last, 200):
            cases.append([float(h), lat, lon, float(rng.choice([0.0, 2.0, 1954.34]))])
    cases += [[0.0, -89.45, 222.69, 0.0], [float(last), -89.45, 222.69, 0.0],
              [3.0, -89.45, 222.69, 0.0], [7616.0, -89.45, 222.69, 0.0]]

    done = subprocess.run(
        ["node", os.path.join(ROOT, "tests", "run_sky_js.mjs")],
        input=json.dumps({"bin": BIN, "cases": cases}),
        capture_output=True, text=True, check=True)
    js = np.array(json.loads(done.stdout))

    py = []
    for h, lat, lon, height in cases:
        r = sky.sky(table, h, lat, lon, height)
        py.append([float(x) for x in r["sun"]] + [float(x) for x in r["earth"]])
    py = np.array(py)

    diff = js - py
    diff[:, 0] = az_diff(js[:, 0], py[:, 0])
    diff[:, 3] = az_diff(js[:, 3], py[:, 3])
    worst = np.abs(diff).max()
    with capsys.disabled():
        print(f"\nJavaScript vs Python: {len(cases)} cases, largest difference {worst:.3e} deg")
    assert worst < 1e-9
