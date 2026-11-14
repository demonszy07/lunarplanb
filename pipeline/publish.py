"""Put everything the web page needs into one folder, ready to publish.

  site/                 -> dist/           (page, scripts, sky table)
  data/sites/*          -> dist/data/sites/   (horizon .json and ground _view.bin)

The site files keep a single home in data/sites/; dist/ is rebuilt every
time and is not stored in the repository. Uses only the standard library
so the publishing job needs nothing installed.

Also prints the sizes, on disk and compressed, and fails if the first screen
grows past about 300 kB compressed (the one size rule of the project).
"""

import glob
import gzip
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIRST_LOAD = ["index.html", "style.css", "js/app.js", "js/sky.js", "js/visibility.js", "js/plan.js",
              "js/scene.js", "js/flightplan.js", "fonts/jost-latin-400-normal.woff2",
              "fonts/jost-latin-500-normal.woff2", "data/sky.bin", "data/sites/site01.json",
              "data/sites/site01_view.bin"]


SKY_LOAD = ["js/realsky.js", "data/stars.bin", "data/earth.bin", "data/earth.jpg"]
# the 3D view: three.js with only the parts used, and the terrain of the plan A site
THREE_LOAD = ["js/view3d.bundle.js", "data/sites/site01_3d.bin"]


TEXT = (".html", ".css", ".js", ".json")       # what a web host compresses on the way out


def sizes(path: str):
    """Bytes on disk, and bytes on the wire if the host gzips text files."""
    with open(path, "rb") as f:
        data = f.read()
    return len(data), (len(gzip.compress(data, 6)) if path.endswith(TEXT) else len(data))


def main(out: str = "dist") -> int:
    out = os.path.join(ROOT, out)
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "site"), out)
    os.makedirs(os.path.join(out, "data", "sites"), exist_ok=True)
    site_files = sorted(glob.glob(os.path.join(ROOT, "data", "sites", "*.json")) +
                        glob.glob(os.path.join(ROOT, "data", "sites", "*_view.bin")) +
                        glob.glob(os.path.join(ROOT, "data", "sites", "*_3d.bin")))
    for path in site_files:
        shutil.copy(path, os.path.join(out, "data", "sites"))

    totals = {}
    for title, names in (("first screen (2D view and flight plan)", FIRST_LOAD),
                         ("after it, in the background (real sky)", SKY_LOAD),
                         ("last, in the background (3D view)", THREE_LOAD)):
        print(title + ":")
        raw_sum = wire_sum = 0
        for name in names:
            raw, wire = sizes(os.path.join(out, name))
            raw_sum += raw
            wire_sum += wire
            print(f"  {name:36} {raw:8d} bytes  {wire:8d} compressed")
        print(f"  {'total':36} {raw_sum:8d} bytes  {wire_sum:8d} compressed")
        totals[title] = (raw_sum, wire_sum)
    first, later, three = totals.values()
    print(f"everything: {first[0] + later[0] + three[0]} bytes, {first[1] + later[1] + three[1]} compressed")
    largest = max(os.path.getsize(p) for p in site_files)
    print(f"{len(site_files)} site files, largest {largest} bytes")
    # The one budget: the first screen stays near 300 kB compressed. No limit on the rest.
    return 0 if first[1] < 320000 else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
