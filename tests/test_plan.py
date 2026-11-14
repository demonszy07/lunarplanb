"""Plan logic in the browser code, and the Earth's phase against Python."""

import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import shading  # noqa: E402
import sky  # noqa: E402


def test_earth_phase_simple_cases():
    # Sun right behind Earth: new Earth. Sun opposite: full Earth. Sun 90 degrees away: half.
    assert sky.earth_phase(100.0, 2.0, 100.0, 2.0)[0] == pytest.approx(0.0, abs=1e-12)
    assert sky.earth_phase(280.0, 0.0, 100.0, 0.0)[0] == pytest.approx(1.0, abs=1e-12)
    lit, toward = sky.earth_phase(190.0, 0.0, 100.0, 0.0)
    assert lit == pytest.approx(0.5, abs=1e-12)
    assert toward == pytest.approx(90.0, abs=1e-9)        # Sun to the right of Earth
    assert sky.earth_phase(10.0, 0.0, 100.0, 0.0)[1] == pytest.approx(-90.0, abs=1e-9)   # to the left
    assert sky.earth_phase(100.0, 5.0, 100.0, 0.0)[1] == pytest.approx(0.0, abs=1e-9)    # straight above


def test_lommel_seeliger_simple_cases():
    # flat ground, light and eye both 30 degrees up: mu0 = mu, so I = 1/2
    assert shading.lommel_seeliger(0.0, 0.0, 0.0, -30.0, 180.0, 30.0) == pytest.approx(0.5)
    # light below the plane of the ground: black
    assert shading.lommel_seeliger(0.0, 0.0, 0.0, -30.0, 180.0, -1.0) == 0.0
    # the Sun's centre exactly on the ground's own horizon: half its disc still lights it, faintly
    grazing = shading.lommel_seeliger(0.0, 0.0, 0.0, -30.0, 180.0, 0.0)
    assert 0.0 < grazing < shading.lommel_seeliger(0.0, 0.0, 0.0, -30.0, 180.0, 0.3)
    assert shading.soft_mu0(-0.01) == 0.0 and shading.soft_mu0(0.2) == 0.2
    # a slope facing the light is brighter than flat ground, one facing away is black
    toward = shading.lommel_seeliger(0.0, -0.3, 0.0, -5.0, 180.0, 1.0)     # normal leans south, Sun in the south
    flat = shading.lommel_seeliger(0.0, 0.0, 0.0, -5.0, 180.0, 1.0)
    away = shading.lommel_seeliger(0.0, 0.3, 0.0, -5.0, 180.0, 1.0)
    assert toward > flat > away == 0.0
    assert shading.EARTHSHINE_TO_SUNLIGHT == pytest.approx(1.1e-4, rel=0.01)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_plan_logic_phase_and_shading_in_javascript():
    rng = np.random.default_rng(3)
    phase = [[float(rng.uniform(0, 360)), float(rng.uniform(-2, 2)),
              float(rng.uniform(0, 360)), float(rng.uniform(-8, 11))] for _ in range(200)]
    shade = []
    for _ in range(300):
        slope, aspect = rng.uniform(0, 0.6), rng.uniform(0, 2 * np.pi)
        shade.append([float(slope * np.sin(aspect)), float(slope * np.cos(aspect)),
                      float(rng.uniform(0, 360)), float(rng.uniform(-8, 2.4)),
                      float(rng.uniform(0, 360)), float(rng.uniform(-2, 8))])
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "run_plan_js.mjs")],
                          input=json.dumps({"phase": phase, "shade": shade}), capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    out = json.loads(done.stdout)
    js = np.array(out["phase"])
    py = np.array([sky.earth_phase(*c) for c in phase], dtype=float)
    assert np.abs(js[:, 0] - py[:, 0]).max() < 1e-12
    assert np.abs((js[:, 1] - py[:, 1] + 180.0) % 360.0 - 180.0).max() < 1e-9
    want = np.array([float(shading.lommel_seeliger(*c)) for c in shade])
    assert np.count_nonzero(want) > 50 and np.count_nonzero(want == 0) > 50
    assert np.abs(np.array(out["shade"]) - want).max() < 1e-12
