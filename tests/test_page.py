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
    # narrow screen: a window, not all 360 degrees; one line over the sky, the rest behind "i"
    assert page["topLineHeight"] < 24
    assert not page["lookBefore"] and page["lookShown"] and page["seenShown"] and not page["lookAfter"]
    assert page["steps"] == [0, 3, 27, 26, 240, 0]                 # arrows 1 h, Shift 1 day, End, Home
    assert page["blockHeights"][0] == page["blockHeights"][1]
    assert page["at27"]["label"] == "MET 027:00"
    assert page["at27"]["whenA"] == "2027-03-02 03:00 UTC"
    assert page["noteAt2m"]
    assert sorted(page["laterDownloads"]) == ["data/sites/site01_5m.json", "data/sites/site01_5m_view.bin"]
    assert "data/sites/site01_view.bin" in [d["url"] for d in page["firstLoad"]]

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
    # the one size rule: the first screen stays near 300 kB compressed
    first_raw = first_wire = 0
    for d in page["firstLoad"]:
        raw, wire = publish.sizes(os.path.join(ROOT, "dist", d["url"] or "index.html"))
        assert raw == d["bytes"]
        first_raw += raw
        first_wire += wire
    assert first_wire < 320000
    # the real sky comes after the first view, in this order
    assert page["skyLoad"] == ["js/realsky.js", "data/stars.bin", "data/earth.bin", "data/earth.jpg",
                               "js/view3d.bundle.js", "data/sites/site01_3d.bin"]
    # the 3D view: kept if the median picture takes 60 ms or less, otherwise taken out again
    three = page["view3d"]
    assert three["view3d"] in ("on", "slow")
    if three["view3d"] == "slow":
        assert float(three["frameMs"]) > 60 and three["view"] == "2d" and three["canvasHidden"] and three["modeHidden"]
        # 30 pictures, or 5 when all five take more than three times the limit
        assert three["frames"] == "30" or (three["frames"] == "5" and float(three["frameMs"]) > 180)
    else:
        # the page opens with the panorama also when 3D is there; the choice of view is offered
        assert float(three["frameMs"]) <= 60 and three["frames"] == "30"
        assert three["view"] == "2d" and three["canvasHidden"] and not three["modeHidden"]
    assert page["starsWithEye"] == "shown"
    assert page["starsWithCamera"] == "hidden"            # the Sun is in view at landing
    assert "Apollo" in page["cameraNote"]
    with capsys.disabled():
        print("\n" + "\n".join(lines))
        print("verdict:", page["verdict"])
        print(f"first screen: {first_raw} bytes in {len(page['firstLoad'])} files, {first_wire} compressed; "
              f"everything downloaded: {page['fullBytes']} bytes")
        print(f"3D view in this browser: {three['view3d']}, median of {three['frames']} pictures {three['frameMs']} ms")


@pytest.mark.skipif(not browser_available(), reason="node with playwright not installed")
def test_one_cursor_for_keys_typing_taps_and_drags(capsys):
    """Keys, the typed date, the strip under the views, a tap on an hour and
    scrolling all move the same clock, on a desktop and on a touch phone."""
    assert publish.main("dist") == 0
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "check_controls.cjs")],
                          capture_output=True, text=True, check=True)
    both = json.loads(done.stdout)
    d, p = both["desktop"], both["phone"]
    assert d["errors"] == [] and p["errors"] == []

    # 5: the mission summary sits between the verdict and the flight plan
    assert d["summaryBetween"] and p["summaryUnderVerdict"]
    # 4: the words that can be changed are pointed out once
    assert d["tip"] == "Tap the underlined words to change the plan."

    # 1: in a box the arrow keys belong to the box; Escape or a click on the view returns them
    assert d["focusInBox"] == "a-days" and "edit this box" in d["keysInBox"]
    assert d["metAfterArrowsInBox"] == 0
    assert d["focusAfterEscape"] == "plan-col" and d["keysAfterEscape"] == d["keysAtStart"]
    assert "1 hour" in d["keysAtStart"] and "Shift 1 day" in d["keysAtStart"]
    assert d["arrowsAfterEscape"]                      # 0 -> 1 -> 25 -> 1 -> 0
    assert d["heightAfterArrowInSelect"] == "5" and d["metAfterArrowInSelect"] == 0
    assert d["focusAfterViewClick"] == "plan-col"
    assert not p["keysHintShown"]                      # no keyboard on a touch screen

    # 2: the date is text, 24-hour UTC, and can be typed
    assert d["dateType"] == "text" and d["dateShown"] == "2027-03-01 00:00"
    assert d["dateTyped"] == {"value": "2027-04-02 13:00", "whenA": "2027-04-02 13:00 UTC", "focus": "plan-col"}
    assert d["dateDigits"] == {"value": "2027-04-03 18:30", "whenA": "2027-04-03 18:30 UTC"}
    assert d["dateOnly"] == "2027-04-05 00:00"
    assert d["dateWrong"]["invalid"] == "true" and "2027-03-01 00:00" in d["dateWrong"]["tip"]
    assert d["dateWrong"]["whenA"] == "2027-04-05 00:00 UTC"       # the last good plan stays on screen
    assert d["dateBack"] == {"invalid": "false", "tip": d["tip"], "whenA": "2027-03-01 00:00 UTC"}
    assert d["dateHourUp"] == "2027-03-01 01:00" and d["dateDayDown"] == "2027-02-28 01:00"

    # 6: one cursor. The strip, the keys, the wheel, a click on an hour and a drag of the sheet
    assert d["stripClick"]["met"] == 120 and abs(d["stripClick"]["marker"] - 120) < 0.5
    assert d["stripClick"]["focus"] == "plan-col"
    assert d["stripDrag"] == [140, 160, 180, 200] and abs(d["markerAfterDrag"] - 200) < 0.5
    assert d["afterWheel"]["met"] == 211 and abs(d["afterWheel"]["marker"] - 211) < 0.5
    assert d["afterWheel"]["cursor"] == d["afterWheel"]["label"] == "MET 211:00"
    assert d["rowClick"] == 221 and d["afterPaperDrag"] == 211 and d["end"] == 240
    # the same on a phone: tap and drag on the strip, tap on an hour, a finger scrolling the page
    assert not p["sideScroll"]
    assert p["stripTap"]["met"] == 96 and abs(p["stripTap"]["marker"] - 96) < 0.5
    assert p["stripDrag"] == [110, 130, 150, 170]
    assert p["rowTap"]["met"] == 180 and p["rowTap"]["label"] == "MET 180:00"
    scrolled = p["afterScroll"]["met"] - 180
    assert scrolled > 0 and abs(scrolled - p["fingerScrolledPx"] / 6) <= 1
    assert abs(p["afterScroll"]["marker"] - p["afterScroll"]["met"]) < 0.5
    with capsys.disabled():
        print(f"\ndesktop: keys in box moved time by {d['metAfterArrowsInBox']} h; strip click {d['stripClick']['met']}, "
              f"drag {d['stripDrag']}, wheel {d['afterWheel']['met']}, hour click {d['rowClick']}, sheet drag {d['afterPaperDrag']}")
        print(f"phone: fixed block {p['fixedBlock']:.0f} of 740 px; strip tap {p['stripTap']['met']}, drag {p['stripDrag']}, "
              f"hour tap {p['rowTap']['met']}, finger scroll {p['fingerScrolledPx']} px -> MET {p['afterScroll']['met']}")
