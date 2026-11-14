"""The page in a real browser shows the same numbers as the Python reference."""

import datetime as dt
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import ephemeris  # noqa: E402
import publish  # noqa: E402
import sky  # noqa: E402
import visibility  # noqa: E402


def browser_available() -> bool:
    if shutil.which("node") is None:
        return False
    probe = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True)
    return probe.returncode == 0


@pytest.mark.skipif(not browser_available(), reason="node with playwright not installed")
def test_page_numbers_match_python(capsys):
    assert publish.main("dist") == 0
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "check_page.cjs")],
                          capture_output=True, text=True, check=True)
    page = json.loads(done.stdout)
    assert page["errors"] == []
    assert page["loadingTextSeen"]
    assert not page["sideScrollAt360"]

    # plan A as written in site/js/app.js
    table = sky.read_bin(os.path.join(ROOT, "site", "data", "sky.bin"))
    with open(os.path.join(ROOT, "data", "sites", "site01.json")) as f:
        site = json.load(f)
    start = ephemeris.hours_since_epoch(dt.datetime(2027, 3, 1))
    want = visibility.metrics(table, site, start, 10 * 24, 1.0)

    got = page["values"]
    lines = []
    for key in ("sunlit_hours", "mean_sun_fraction", "longest_dark_hours", "hours_to_first_sunset",
                "earth_hours", "longest_outage_hours", "hours_to_first_earthset", "both_hours"):
        lines.append(f"{key:26} browser {got[key]!s:>20}  python {want[key]!s:>20}")
        if key == "mean_sun_fraction":
            assert got[key] == pytest.approx(want[key], abs=1e-12)
        else:
            assert got[key] == want[key]
    assert page["totalBytes"] < 300000
    with capsys.disabled():
        print("\n" + "\n".join(lines))
        print(f"downloaded by the browser: {page['totalBytes']} bytes in {len(page['downloads'])} files")
