"""The 3D view: its mesh against the Python reference, its cast shadows against
straight rays, and the share of the Sun's disc it leaves in view against the 2D number."""

import datetime as dt
import json
import os
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.dirname(__file__))

import build_3d  # noqa: E402
import ephemeris  # noqa: E402
import publish  # noqa: E402
import shadow_reference  # noqa: E402
import sky  # noqa: E402
import visibility  # noqa: E402
from test_page import browser_available  # noqa: E402

SITE_FILE = os.path.join(ROOT, "data", "sites", "site01_3d.bin")

# The five moments of the stage 4 check, and one more. All at Site 1, panels at 2 m.
# They were picked from the 2D numbers alone (pipeline/visibility.py over 2027),
# before the 3D view was measured.
MOMENTS = [
    {"name": "Sun fully in view", "site": "site01", "utc": "2027-03-01 00:00"},
    {"name": "Sun fully hidden", "site": "site01", "utc": "2027-05-05 03:00"},
    {"name": "partly cut by near terrain (0.4 km)", "site": "site01", "utc": "2027-03-04 00:00"},
    {"name": "partly cut by far terrain (42 km)", "site": "site01", "utc": "2027-03-14 10:00"},
    {"name": "just after sunset", "site": "site01", "utc": "2027-03-18 04:00"},
    {"name": "extra: partly cut by terrain 9 km away", "site": "site01", "utc": "2027-06-13 11:00"},
]


def test_mesh_in_javascript_matches_python(capsys):
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "run_3d_js.mjs"), SITE_FILE],
                          capture_output=True, text=True, check=True)
    js = json.loads(done.stdout)
    header, grids, far = build_3d.read_3d(SITE_FILE)
    assert js["drop20km"] == pytest.approx(-115.1, abs=0.05)             # curvature: 115 m at 20 km
    assert js["siteHeight"] == pytest.approx(grids["near"][50, 50], abs=1e-3)
    worst = 0.0
    for name, half, step, _, _ in build_3d.LEVELS:
        n = grids[name].shape[0]
        axis = (np.arange(n) - (n - 1) / 2) * step
        x, y = np.meshgrid(axis[::7], axis[::7])
        want = build_3d.local_position(x, y, grids[name][::7, ::7], grids["near"][50, 50]).reshape(-1, 3)
        got = np.array(js["levels"][name]["sample"])
        worst = max(worst, float(np.abs(got - want).max()))
        level = js["levels"][name]
        assert level["changedInside"] == 0.0                              # blending touches only the band at the edge
        assert level["normalLengthError"] < 1e-6 and level["lowestNormalUp"] > 0
    assert worst < 0.01                                                   # metres; heights are kept as 32-bit numbers
    # no step where the grids meet
    assert all(gap < 1e-3 for gap in js["seams"].values())
    for height in (2.0, 5.0):
        assert np.allclose(js["far"][str(int(height))]["mesh"], far[(19200.0, height)], atol=1e-6)
        assert np.allclose(js["far"][str(int(height))]["strip"], far[(120000.0, height)], atol=1e-6)
    triangles = sum(level["triangles"] for level in js["levels"].values())
    with capsys.disabled():
        print(f"\nmesh: {triangles} triangles; positions differ from Python by at most {worst * 1000:.2f} mm; "
              f"largest step at the seams {max(js['seams'].values()) * 1000:.3f} mm")


def moment_reference(table, moment):
    with open(os.path.join(ROOT, "data", "sites", moment["site"] + ".json")) as f:
        site = json.load(f)
    when = dt.datetime.strptime(moment["utc"], "%Y-%m-%d %H:%M")
    v = visibility.view(table, site, ephemeris.hours_since_epoch(when))
    az = float(v["sun_az"])
    return float(v["sun_fraction"]), site["distance_km"][int(round(az * 2)) % 720]


@pytest.mark.skipif(not browser_available(), reason="node with playwright not installed")
def test_3d_view_against_rays_and_against_the_2d_numbers(capsys):
    assert publish.main("dist") == 0
    done = subprocess.run(["node", os.path.join(ROOT, "tests", "check_3d.cjs")], input=json.dumps(MOMENTS),
                          capture_output=True, text=True, check=True, timeout=900)
    got = json.loads(done.stdout)
    assert got["errors"] == []
    page = got["page"]
    # the page opens with the panorama also when 3D is there; the choice of view is offered
    assert page["start"]["view3d"] == "on" and page["start"]["view"] == "2d" and page["modeShown"]
    # from above: the starting distance, the wheel moves the camera, a drag turns it
    above = page["above"]
    assert above["view"] == "above" and "6.0 km" in above["stretch"] and "no vertical stretch" in above["stretch"]
    assert above["lookAz"] == 0 and above["distance"] == 6000
    assert above["afterWheelIn"] < 6000 < above["afterWheelOut"] and above["pageScrolledByWheel"] == 0
    assert above["afterDrag"]["choice"] == "free" and above["afterDrag"]["lookAz"] != 0
    assert above["nearest"] == 800 and above["farthest"] == 20000
    assert page["notesHiddenIn3d"]                                        # the notes wait behind the "i" button
    # standing on the surface
    assert page["surface"]["view"] == "surface"
    assert "no vertical stretch" in page["stretch"] and "70" in page["stretch"]
    assert page["horizonAt"] == pytest.approx(0.4, abs=0.001)             # the level sight line, as a share of the height
    assert page["lookEast"] == 90
    # a drag of 200 px to the right turns the view left by 200 px worth of the 70 degrees
    drag = page["afterDrag"]
    assert drag["choice"] == "free" and drag["lookAz"] == pytest.approx(90 - 200 * 70 / drag["width"], abs=0.01)
    assert page["panorama"]["view"] == "2d" and page["panorama"]["canvasHidden"] and "stretched" in page["panorama"]["stretch"]
    assert page["again"]["view"] == "surface"
    # another site brings its own terrain file; panels at 5 m raise the eye
    assert page["otherSite"] == {"files": ["data/sites/malapert_3d.bin"], "view": "surface", "eye": 2}
    assert page["panelsAt5m"] == {"eye": 5, "view": "surface"}
    # nothing moves by itself: no picture while nothing changes, then a handful for one hour's step
    assert page["framesWhileIdle"] == 0 and 0 < page["framesForOneHour"] <= 16
    # without WebGL2 the page stays 2D and the 3D code is not downloaded
    assert got["noWebgl2"]["view3d"] == "no-webgl2" and got["noWebgl2"]["view"] == "2d"
    assert not got["noWebgl2"]["bundleFetched"] and not got["noWebgl2"]["terrainFetched"] and not got["noWebgl2"]["modeShown"]
    assert got["switchedOff"] == "off"
    # a device that draws a picture in 5 ms (a clock made to run that way): 3D stays,
    # after 30 timed pictures, and the page still opens with the panorama
    fast = got["fastDevice"]
    assert fast["view3d"] == "on" and fast["frames"] == "30" and float(fast["frameMs"]) <= 60
    assert fast["view"] == "2d" and fast["modeShown"]
    # the software graphics of the test browser are too slow: stopped after five pictures, panorama only
    slow = got["slowDevice"]
    assert slow["view3d"] == "slow" and slow["frames"] == "5" and float(slow["frameMs"]) > 180 and not slow["modeShown"]
    # the reported moment (Mons Mouton, 2028-11-30, MET 063): Sun and Earth are 6.6 degrees apart,
    # yet the names of the arrows do not overlap; every word of the sentence is whole in every view
    rep = got["reported"]
    assert rep["title"] == "LunaricB" and rep["brand"] == "LunaricB" and rep["view"] == "above"
    assert rep["names"] == ["Sun", "Earth", "north"] and rep["overlapping"] == 0
    assert rep["fit"] == {"above": True, "surface": True, "2d": True} and rep["date"] == "2028-11-30 00:00"
    # fingers on the view from above: sideways turns it, two fingers move the camera,
    # up and down still scrolls the page (the time)
    touch = got["touch"]
    assert touch["errors"] == []
    assert touch["sideways"]["turnedDeg"] != 0 and touch["sideways"]["scrolled"] == 0
    assert touch["upDown"]["turnedDeg"] == 0 and touch["upDown"]["scrolled"] > 50
    assert touch["pinchOut"]["distance"] < touch["start"]["distance"] and touch["pinchOut"]["scrolled"] == 0
    assert touch["pinchIn"]["distance"] > touch["pinchOut"]["distance"] and touch["pinchIn"]["scrolled"] == 0

    # ---- cast shadows against straight rays through the same grids ----
    surf = shadow_reference.surfaces(SITE_FILE)
    lines = ["Cast shadows of the 3D view against straight rays through the same height grids (tests/shadow_reference.py).",
             "Site 1, opening plan (landing 2027-03-01 00:00 UTC). Only ground that faces the light is counted.",
             "'wrong' = the two differ by more than half (lit against dark).", ""]
    for shot in got["shadows"]:
        light = shot["light"]
        for name, size, half, zones in (("wide", 251, 20080.0, [("whole shadowed mesh, to 19.2 km", (0, 19200)),
                                                              ("2 to 7 km, 80 m grid", (2000, 7000))]),
                                        ("middle", 201, 2010.0, [("240 m to 1 km, finer shadow map", (250, 980)),
                                                                 ("1 to 1.6 km, wide shadow map", (1010, 1600))])):
            pixels = np.array(shot[name], dtype=float).reshape(size, size, 4)
            faces, reached = pixels[..., 0] > 127, pixels[..., 1] / 255
            points, ring = shadow_reference.mesh_points(surf, size, half)
            ref = shadow_reference.lit_share(surf, points, light["az"], light["el"], light["diameter"])
            for label, band in zones:
                use = faces & (ring >= band[0]) & (ring < band[1])
                wrong = float(np.mean(np.abs(reached - ref)[use] > 0.5))
                lines.append(f"MET {shot['met']:3d}  light az {light['az']:7.2f} el {light['el']:6.3f}  {label:34} "
                             f"lit share: rays {ref[use].mean():.3f}, 3D {reached[use].mean():.3f}; wrong {100 * wrong:4.1f} %")
                # limits a little above what was first measured; the file keeps the numbers
                assert wrong < (0.015 if band[1] < 1000 else 0.06), label
                assert abs(reached[use].mean() - ref[use].mean()) < 0.04, label

    # ---- the Sun's disc: 3D pixels beside the 2D number ----
    table = sky.read_bin(os.path.join(ROOT, "site", "data", "sky.bin"))
    lines += ["", "Share of the Sun's disc in view: the 3D scene (pixels through a long lens, disc about 180 px wide)",
              "beside the 2D number (32 slices against the 720-point horizon). Panels at 2 m.",
              "'mesh alone' and 'strip alone': what the near mesh and the strip of far mountains each leave in view.", ""]
    agree = []
    for m in got["moments"]:
        want, distance = moment_reference(table, m)
        assert m["fraction2d"] == pytest.approx(want, abs=1e-9)           # the page's 2D number is the Python number
        assert m["discPixels"] > 20000
        same = (m["seenPixels"] > 0) == (want > 0)
        agree.append(same)
        lines.append(f"{m['name']:40} {m['utc']} UTC  Sun az {m['sunAz']:7.2f} el {m['sunEl']:6.3f}  horizon there set at {distance:6.1f} km")
        lines.append(f"{'':40} 2D {want:.3f}   3D {m['fraction']:.3f} ({m['seenPixels']} of {m['discPixels']} px)   "
                     f"mesh alone {m['pastMeshOnly']:.3f}  strip alone {m['pastStripOnly']:.3f}   "
                     f"in view: 2D {'yes' if want > 0 else 'no'}, 3D {'yes' if m['seenPixels'] > 0 else 'no'}"
                     f"{'' if same else '   <-- DISAGREE'}")
    largest = max(abs(m["fraction"] - m["fraction2d"]) for m in got["moments"])
    lines += ["", f"In view / not in view agrees in {sum(agree)} of {len(agree)} moments. "
                  f"Largest difference of the share: {largest:.3f}.",
              f"Speed check in the test browser (software graphics): median {page['start']['frameMs']} ms over "
              f"{page['start']['frames']} pictures, "
              f"{page['triangles']:.0f} triangles."]
    text = "\n".join(lines) + "\n"
    with open(os.path.join(ROOT, "data", "view3d_check.txt"), "w") as f:
        f.write(text)
    with capsys.disabled():
        print("\n" + text)
    # the two moments that leave no room for doubt must agree; the rest is reported as it is
    assert agree[0] and agree[1]
    assert got["moments"][0]["fraction"] == 1.0 and got["moments"][1]["seenPixels"] == 0
