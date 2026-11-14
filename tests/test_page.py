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

KEYS = ("sunlit_hours", "mean_sun_fraction", "longest_dark_hours", "earth_hours",
        "longest_outage_hours", "both_hours")


def browser_available() -> bool:
    if shutil.which("node") is None:
        return False
    probe = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True)
    return probe.returncode == 0


def reference(table, site_file, start):
    with open(os.path.join(ROOT, "data", "sites", site_file)) as f:
        site = json.load(f)
    return visibility.metrics(table, site, ephemeris.hours_since_epoch(start), 10 * 24, 1.0)


@pytest.mark.skipif(not browser_available(), reason="node with playwright not installed")
def test_page_numbers_match_python(capsys):
    assert publish.main("dist") == 0
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "check_page.cjs")],
                          capture_output=True, text=True, check=True)
    page = json.loads(done.stdout)
    assert page["errors"] == []
    assert page["loadingTextSeen"]
    assert page["sentenceWhileLoading"].startswith("Land at")      # the page opens before the data
    assert not page["sideScrollAt360"]
    assert page["lookShown"]                                       # narrow screen: a window, not all 360 degrees
    assert page["steps"] == [0, 3, 27, 26, 240, 0]                 # arrows 1 h, Shift 1 day, End, Home
    assert page["at27"]["label"] == "MET 027:00"
    assert page["at27"]["whenA"] == "2027-03-02 03:00 UTC"
    assert page["noteAt2m"]
    assert page["laterDownloads"] == ["data/sites/site01_5m.json"]

    # the plans the page opens with: A = Site 1, 2027-03-01 00:00 UTC, 10 days, panels at 2 m;
    # B = the same one week later
    table = sky.read_bin(os.path.join(ROOT, "site", "data", "sky.bin"))
    cases = {
        "values": {"a": ("site01.json", dt.datetime(2027, 3, 1)), "b": ("site01.json", dt.datetime(2027, 3, 8))},
        "values5m": {"a": ("site01_5m.json", dt.datetime(2027, 3, 1)),
                     "b": ("site01_5m.json", dt.datetime(2027, 3, 8))},
    }
    lines = []
    for which, plans in cases.items():
        got = page[which]
        want = {name: reference(table, *plan) for name, plan in plans.items()}
        for key in KEYS:
            for name in ("a", "b"):
                g, w = got[f"{name}.{key}"], want[name][key]
                assert g == pytest.approx(w, abs=1e-12), (which, name, key)
            assert got[f"diff.{key}"] == pytest.approx(want["b"][key] - want["a"][key], abs=1e-12)
            if which == "values":
                lines.append(f"{key:22} A browser {got['a.' + key]!s:>19} python {want['a'][key]!s:>19} | "
                             f"B browser {got['b.' + key]!s:>19} python {want['b'][key]!s:>19}")
    assert page["firstLoadBytes"] < 300000
    with capsys.disabled():
        print("\n" + "\n".join(lines))
        print("verdict:", page["verdict"])
        print(f"first load: {page['firstLoadBytes']} bytes in {len(page['firstLoad'])} files")
