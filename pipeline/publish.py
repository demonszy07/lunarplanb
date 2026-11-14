"""Put everything the web page needs into one folder, ready to publish.

  site/                 -> dist/           (page, scripts, sky table)
  data/sites/*          -> dist/data/sites/   (horizon .json and ground _view.bin)

The site files keep a single home in data/sites/; dist/ is rebuilt every
time and is not stored in the repository. Uses only the standard library
so the publishing job needs nothing installed.

Also checks the size budgets: first load under 300 kB, each site file under 100 kB.
"""

import glob
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIRST_LOAD = ["index.html", "style.css", "js/app.js", "js/sky.js", "js/visibility.js", "js/plan.js",
              "js/scene.js", "js/flightplan.js", "fonts/jost-latin-400-normal.woff2",
              "fonts/jost-latin-500-normal.woff2", "data/sky.bin", "data/sites/site01.json",
              "data/sites/site01_view.bin"]


def main(out: str = "dist") -> int:
    out = os.path.join(ROOT, out)
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "site"), out)
    os.makedirs(os.path.join(out, "data", "sites"), exist_ok=True)
    site_files = sorted(glob.glob(os.path.join(ROOT, "data", "sites", "*.json")) +
                        glob.glob(os.path.join(ROOT, "data", "sites", "*_view.bin")))
    for path in site_files:
        shutil.copy(path, os.path.join(out, "data", "sites"))

    ok = True
    total = 0
    print("first load:")
    for name in FIRST_LOAD:
        size = os.path.getsize(os.path.join(out, name))
        total += size
        print(f"  {name:36} {size:8d} bytes")
    print(f"  {'total':36} {total:8d} bytes  (budget 300000)")
    ok &= total < 300000
    largest = max(os.path.getsize(p) for p in site_files)
    print(f"{len(site_files)} site files, largest {largest} bytes (budget 100000)")
    ok &= largest < 100000
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
