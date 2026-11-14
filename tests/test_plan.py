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


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_plan_logic_and_phase_in_javascript():
    rng = np.random.default_rng(3)
    cases = [[float(rng.uniform(0, 360)), float(rng.uniform(-2, 2)),
              float(rng.uniform(0, 360)), float(rng.uniform(-8, 11))] for _ in range(200)]
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "run_plan_js.mjs")],
                          input=json.dumps(cases), capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    js = np.array(json.loads(done.stdout))
    py = np.array([sky.earth_phase(*c) for c in cases], dtype=float)
    assert np.abs(js[:, 0] - py[:, 0]).max() < 1e-12
    assert np.abs((js[:, 1] - py[:, 1] + 180.0) % 360.0 - 180.0).max() < 1e-9
