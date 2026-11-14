"""Tests for the visibility rules, the mission metrics and site/js/visibility.js."""

import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.dirname(__file__))

import make_vectors  # noqa: E402
import visibility as vis  # noqa: E402

FLAT = np.zeros(720)
# floats may differ in the last digits between numpy and JavaScript
FLOAT_TOL = 1e-9
EXACT_KEYS = {"kind", "site", "hours", "start_hours", "duration_hours", "step_hours", "samples",
              "earth_state", "earth_link", "sunlit_hours", "longest_dark_hours", "earth_hours",
              "longest_outage_hours", "both_hours", "hours_to_first_sunset",
              "hours_to_first_earthset"}


# -- disc against simple horizons --------------------------------------------

def test_horizon_lookup_wraps():
    profile = np.arange(720) * 0.5              # value equals azimuth
    assert vis.horizon_at(profile, 10.25) == pytest.approx(10.25)
    assert vis.horizon_at(profile, 370.0) == pytest.approx(10.0)
    # between the last direction (359.5) and north (0) the line goes 359.5 -> 0
    assert vis.horizon_at(profile, 359.75) == pytest.approx(359.5 / 2)
    assert vis.horizon_at(profile, -0.25) == pytest.approx(359.5 / 2)


def test_disc_clear_hidden_and_half():
    d = 0.53
    assert vis.disc_fraction(FLAT, 100.0, 1.0, d) == 1.0
    assert vis.disc_fraction(FLAT, 100.0, -1.0, d) == 0.0
    assert vis.disc_fraction(FLAT, 100.0, 0.0, d) == pytest.approx(0.5, abs=1e-12)
    # just touching: top edge on the horizon / bottom edge on the horizon
    assert vis.disc_fraction(FLAT, 100.0, -d / 2, d) == 0.0
    assert vis.disc_fraction(FLAT, 100.0, d / 2, d) == 1.0


def test_disc_fraction_matches_circle_segment():
    # Disc centre a quarter radius above a flat horizon: exact area of the
    # visible part is 1 - (acos(t) - t sqrt(1 - t^2)) / pi with t = 0.25.
    d, t = 0.53, 0.25
    exact = 1.0 - (np.arccos(t) - t * np.sqrt(1 - t * t)) / np.pi
    got = vis.disc_fraction(FLAT, 200.0, t * d / 2, d)
    assert got == pytest.approx(exact, abs=0.01)


def test_wall_hides_one_side_of_the_disc():
    # terrain 10 deg high up to azimuth 180, 10 deg low from 180.5 on;
    # between them the stored profile is a straight ramp through 0 at 180.25
    wall = np.where(np.arange(720) * 0.5 <= 180.0, 10.0, -10.0)
    assert vis.disc_fraction(wall, 170.0, 0.0, 0.5) == 0.0
    assert vis.disc_fraction(wall, 190.0, 0.0, 0.5) == 1.0
    # disc centred on the ramp: its left half is behind terrain, right half clear
    assert vis.disc_fraction(wall, 180.25, 0.0, 0.5) == pytest.approx(0.5, abs=0.02)


def test_earth_states():
    assert list(vis.earth_state(np.array([0.0, 0.3, 1.0]))) == [0, 1, 2]


def test_runs():
    assert vis.longest_run([False, True, True, True, False, True]) == 3
    assert vis.longest_run([True, True]) == 2
    assert vis.longest_run([False, False]) == 0
    assert vis.first_true([False, False, True]) == 2
    assert vis.first_true([False]) is None


def test_metrics_add_up():
    sites = make_vectors.load_sites()
    import sky
    table = sky.read_bin(os.path.join(ROOT, "site", "data", "sky.bin"))
    m = vis.metrics(table, sites["site01"], 7000.0, 720.0)
    assert m["samples"] == 720
    assert 0 <= m["both_hours"] <= min(m["sunlit_hours"], m["earth_hours"])
    assert m["longest_dark_hours"] <= 720 - m["sunlit_hours"]
    assert m["longest_outage_hours"] <= 720 - m["earth_hours"]
    assert 0.0 <= m["mean_sun_fraction"] <= m["sunlit_hours"] / 720 + 1e-12


# -- vectors: Python is current, JavaScript matches ---------------------------

def load_vectors():
    with open(os.path.join(ROOT, "tests", "vectors.json")) as f:
        return json.load(f)


def compare(rows, expected):
    assert len(rows) == len(expected)
    worst = 0.0
    for got, want in zip(rows, expected):
        assert got.keys() == want.keys()
        for k, w in want.items():
            g = got[k]
            if k in EXACT_KEYS or w is None or g is None:
                assert g == w, (want["site"], k, g, w)
            else:
                diff = abs(g - w)
                if k.endswith("_az"):
                    diff = abs((g - w + 180.0) % 360.0 - 180.0)
                worst = max(worst, diff)
                assert diff < FLOAT_TOL, (want["site"], k, g, w)
    return worst


def test_vectors_file_has_200_rows_and_is_current():
    expected = load_vectors()
    assert len(expected) == 200
    assert compare(make_vectors.build(), expected) == 0.0


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_javascript_matches_vectors(capsys):
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "run_visibility_js.mjs")],
                          capture_output=True, text=True, check=True)
    worst = compare(json.loads(done.stdout), load_vectors())
    with capsys.disabled():
        print(f"\nJavaScript vs vectors.json: 200 rows, counts/states/hours identical, "
              f"largest angle or fraction difference {worst:.3e}")
