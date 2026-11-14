"""Write data/sites/[id].json for every site: horizon profile, distances,
site facts and where the coordinates come from.

All coordinates trace back to one NASA source that this build can reach:
NASA GSFC Planetary Geodynamics Data Archive, product 78,
"High-Resolution LOLA Topography for Lunar South Pole Sites"
(Barker et al. 2021), https://pgda.gsfc.nasa.gov/products/78

That product gives regions, not single points: a 5 m/pixel terrain tile per
site and, for Sites 1, 4, 7 and 11, a shapefile of regions of interest (RoIs).
How one point was chosen inside each region is written per site below and
copied into every output file. Nothing here is typed in from memory.
"""

from __future__ import annotations

import json
import os

import numpy as np

from horizon import Dem, horizon

PGDA = "https://pgda.gsfc.nasa.gov/products/78"
PGDA_DATA = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
CITATION = ("Barker, M. K., et al. (2021), Improved LOLA elevation maps for south pole landing "
            "sites: error estimates and their impact on illumination conditions, Planetary and "
            "Space Science 203, 105119, https://doi.org/10.1016/j.pss.2020.105119")
OBSERVER_HEIGHT_M = 2.0

ROI_RULE = ("The source gives regions of interest as polygons, each stored with one X, Y point "
            "(south polar stereographic metres). The point of the largest polygon by area was "
            "taken and converted to latitude and longitude on the 1737.4 km sphere.")
PEAK_RULE = ("The source gives only a 5 m/pixel terrain tile for this region. The point is the "
             "centre of the highest 80 m cell of LDEM_80S_80MPP_ADJ.TIF inside the footprint of "
             "that tile.")

# kind "roi":   X, Y point stored with a polygon in [Site]_ROIs.shp
# kind "peak":  highest 80 m DEM cell inside the tile footprint (x0, x1, y0, y1 in metres)
SITES = [
    {"id": "site01", "name": "Site 1, connecting ridge", "pgda_name": "Site01: Connecting ridge",
     "kind": "roi", "roi": 4, "xy": (-11287.5, -12167.5),
     "file": f"{PGDA_DATA}/Site01/Site01_ROIs.tgz", "rule": ROI_RULE + " RoI 4 of 7, 11900 m2."},
    {"id": "site04", "name": "Site 4, Shackleton rim", "pgda_name": "Site04: Shackleton rim",
     "kind": "roi", "roi": 1, "xy": (-2812.5, -6647.5),
     "file": f"{PGDA_DATA}/Site04/Site04_ROIs.tgz", "rule": ROI_RULE + " RoI 1 of 4, 5450 m2."},
    {"id": "site07", "name": "Site 7, peak near Shackleton", "pgda_name": "Site07: Peak near Shackleton",
     "kind": "roi", "roi": 2, "xy": (30062.5, -20107.5),
     "file": f"{PGDA_DATA}/Site07/Site07_ROIs.tgz", "rule": ROI_RULE + " RoI 2 of 2, 14738 m2."},
    {"id": "site11", "name": "Site 11, de Gerlache rim", "pgda_name": "Site11: de Gerlache rim",
     "kind": "roi", "roi": 1, "xy": (-37542.5, 14882.5),
     "file": f"{PGDA_DATA}/Site11/Site11_ROIs.tgz", "rule": ROI_RULE + " RoI 1 of 4, 11812 m2."},
    {"id": "malapert", "name": "Malapert massif", "pgda_name": "Site23: Malapert massif",
     "kind": "peak", "tile": (-11000.0, 10000.0, 111000.0, 132000.0),
     "file": f"{PGDA_DATA}/Site23/Site23_final_adj_5mpp_surf.tif", "rule": PEAK_RULE},
    {"id": "mouton", "name": "Mons Mouton plateau", "pgda_name": "Site20: Leibnitz beta plateau",
     "kind": "peak", "tile": (65000.0, 81000.0, 110000.0, 126000.0),
     "file": f"{PGDA_DATA}/Site20/Site20_final_adj_5mpp_surf.tif",
     "rule": PEAK_RULE + " Leibnitz beta is the earlier name of Mons Mouton."},
    {"id": "haworth", "name": "Haworth", "pgda_name": "Haworth",
     "kind": "peak", "tile": (-52900.0, -23100.0, 75600.0, 105400.0),
     "file": f"{PGDA_DATA}/Haworth/Haworth_final_adj_5mpp_surf.tif",
     "rule": PEAK_RULE + (" This is the landing region named Haworth in the source, on high "
                          "ground beside the crater, not the crater floor.")},
]


def highest_cell(dem: Dem, tile):
    x0, x1, y0, y1 = tile
    c0, c1 = int(round((x0 - dem.x0) / dem.dx)), int(round((x1 - dem.x0) / dem.dx))
    r0, r1 = int(round((dem.y0 - y1) / dem.dy)), int(round((dem.y0 - y0) / dem.dy))
    sub = dem.data[r0:r1, c0:c1]
    r, c = np.unravel_index(np.nanargmax(sub), sub.shape)
    edge = min(r, c, sub.shape[0] - 1 - r, sub.shape[1] - 1 - c)
    if edge < 5:
        raise ValueError("highest cell is on the tile edge; the real top is outside the tile")
    return dem.pixel_centre_xy(r0 + r, c0 + c)


def site_point(site: dict, dem: Dem):
    x, y = site["xy"] if site["kind"] == "roi" else highest_cell(dem, site["tile"])
    lat, lon = dem.unproject(x, y)
    return round(float(lat), 4), round(float(lon), 4)


def main(out_dir: str = "data/sites"):
    near = Dem.from_geotiff("data/raw/LDEM_80S_80MPP_ADJ.TIF")
    far = Dem.from_geotiff("data/raw/LDEM_60S_240MPP_ADJ.TIF")
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for site in SITES:
        lat, lon = site_point(site, near)
        h = horizon(lat, lon, OBSERVER_HEIGHT_M, near, far)
        out = {
            "id": site["id"], "name": site["name"],
            "lat": lat, "lon": lon,
            "observer_height_m": OBSERVER_HEIGHT_M,
            "site_height_m": round(h["site_height_m"], 2),
            "frame": "MOON_ME, east-positive longitude, sphere 1737.4 km, no refraction",
            "azimuth": "clockwise from north; index i is i * 0.5 degrees",
            "source": {
                "name": "NASA GSFC Planetary Geodynamics Data Archive, High-Resolution LOLA "
                        "Topography for Lunar South Pole Sites",
                "url": PGDA, "region": site["pgda_name"], "file": site["file"],
                "citation": CITATION, "point_choice": site["rule"],
            },
            "terrain": {"near_dem": "LDEM_80S_80MPP_ADJ.TIF", "near_limit_km": 100.0,
                        "far_dem": "LDEM_60S_240MPP_ADJ.TIF", "far_limit_km": 300.0,
                        "samples": h["samples"], "skipped_no_data": h["skipped"],
                        "url": "https://pgda.gsfc.nasa.gov/products/90"},
            "near_limit_km": 100.0, "far_limit_km": 300.0,
            "elevation_deg": [round(float(v), 4) for v in h["elevation_deg"]],
            "distance_km": [round(float(v), 3) for v in h["distance_km"]],
        }
        path = os.path.join(out_dir, site["id"] + ".json")
        with open(path, "w") as f:
            json.dump(out, f, separators=(",", ":"))
            f.write("\n")
        el = h["elevation_deg"]
        index.append({"id": site["id"], "name": site["name"], "lat": lat, "lon": lon,
                      "site_height_m": out["site_height_m"]})
        print(f"{site['id']:9} lat {lat:9.4f} lon {lon:9.4f} height {h['site_height_m']:8.1f} m  "
              f"horizon {el.min():6.2f}..{el.max():6.2f} deg  no-data {h['skipped']:6d}  "
              f"{os.path.getsize(path)} bytes")
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
