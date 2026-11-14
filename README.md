# Lunar Plan B

One screen that compares two landing plans for the lunar south pole: where the Sun and Earth sit relative to the real terrain horizon, and what that means for power and direct-to-Earth contact.

NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".

Live page: https://lunarplanb.vercel.app/

## Run

```
pip install -r requirements.txt
python pipeline/ephemeris.py      # downloads the Horizons table to data/raw/
python pipeline/sky.py            # writes site/data/sky.bin for the browser
python pipeline/check_sky.py      # compares with direct Horizons queries
python pipeline/build_sites.py    # writes data/sites/ (needs the terrain files, see the file)
python pipeline/realsky.py        # writes site/data/stars.bin, earth.bin, earth.jpg (needs data/raw/sky/, see the file)
python pipeline/check_stars.py    # checks the star positions against Horizons
python tests/make_vectors.py      # writes tests/vectors.json from the Python reference
python pipeline/monthly.py data/sites/site01.json 2027
python pipeline/compare_barker.py  # check against Barker et al. 2021 (needs extra downloads, see the file)
python pipeline/plot_horizon.py data/sites/site01.json data/site1_horizon.png
python pipeline/publish.py        # gathers site/ and data/sites/ into dist/ (what gets published)
python -m pytest tests
```

To look at the page on your own computer: `python pipeline/publish.py`, then `python -m http.server --directory dist` and open http://localhost:8000. The page is published with Vercel: on every push to `main` it runs `python3 pipeline/publish.py dist` and serves `dist/` (settings in `vercel.json`).

The terrain files listed under Sources go in `data/raw/` (the two large maps) and `data/raw/pgda78/` (the 5 m site maps); they are not stored in this repository.
The JavaScript tests need Node.js; the page test also needs Playwright.

## Using the page

- The plan is a sentence. Every underlined word with a small triangle can be changed. The landing time is typed as `2027-03-01 00:00` (24-hour clock, UTC); in that box the up and down keys step the part under the caret.
- Time is the scroll position of the flight plan. The strip under the views shows the whole stay for both plans: tap it to jump to a moment, drag along it to run the time. A tap on an hour of the flight plan brings that hour to the cursor.
- Arrow keys left and right move the time 1 hour, with Shift 1 day; Home and End go to landing and to the end of the stay. While a box of the sentence has the focus the arrow keys edit that box; Escape, or a click on the view or the flight plan, hands them back to time.

## Sites

All seven come from one NASA source, the PGDA product "High-Resolution LOLA Topography for Lunar South Pole Sites" (https://pgda.gsfc.nasa.gov/products/78). It gives regions, not single points, so each point below was chosen by a stated rule. The rule is repeated inside every `data/sites/[id].json`.

| id | Region in the source | Latitude | Longitude (E) | Ground height (m) | How the point was chosen |
|---|---|---|---|---|---|
| site01 | Site01: Connecting ridge | -89.4527 | 222.8513 | 1955 | Point stored with the largest region of interest (RoI 4) in `Site01_ROIs.shp` |
| site04 | Site04: Shackleton rim | -89.7620 | 202.9328 | 1725 | Point stored with the largest region of interest (RoI 1) in `Site04_ROIs.shp` |
| site07 | Site07: Peak near Shackleton | -88.8073 | 123.7768 | 1648 | Point stored with the largest region of interest (RoI 2) in `Site07_ROIs.shp` |
| site11 | Site11: de Gerlache rim | -88.6683 | 291.6242 | 1812 | Point stored with the largest region of interest (RoI 1) in `Site11_ROIs.shp` |
| malapert | Site23: Malapert massif | -85.9876 | 2.0528 | 5173 | Highest 80 m terrain cell inside the footprint of the source's 5 m tile |
| mouton | Site20: Leibnitz beta plateau (Leibnitz beta is the earlier name of Mons Mouton) | -85.4034 | 31.6796 | 6461 | Highest 80 m terrain cell inside the footprint of the source's 5 m tile |
| haworth | Haworth | -86.3628 | 336.7905 | 2841 | Highest 80 m terrain cell inside the footprint of the source's 5 m tile |

Ground heights in this table were read from `LDEM_80S_80MPP_ADJ.TIF` when the points were chosen; the site files use the height in the 5 m map of each site, which differs by up to 4 m. Each site has two horizon files, for panels 2 m and 5 m above the ground, and for each a `_view.bin` file that says which way the ground faces below the skyline.

## Limits

- Earth direction: the azimuth of Earth differs from JPL Horizons asked directly for a point on the Moon by 0.004 degrees (median) and up to 0.006 degrees; elevation by up to 0.0006 degrees (`data/sky_check.txt`). The Sun agrees to 0.0002 degrees. Likely cause, not proven here: the sub-Earth point in the Horizons table is corrected for light travel time only, while the direct query also applies the aberration of light (about 0.0057 degrees). No correction is applied. Earth's disc is about 1.9 degrees wide.
- Terrain detail: the first 5 km around each site come from PGDA's 5 m site maps, then an 80 m map to 100 km and a 240 m map to 300 km. All seven sites have a 5 m map; at Haworth the chosen point is 4 km from the edge of its map, so 2.9 % of the near samples are read from the 80 m map. The 5 m maps are mostly interpolated between laser tracks (about 90 % of their pixels, per the source), so rocks, small craters, the lander itself and bumps of a metre or two are still not in the result. With panels at 2 m the horizon is often set by ground a few hundred metres away, which is why the page warns that real sunlight is likely lower.
- Terrain beyond 300 km is ignored.
- The Moon is treated as a sphere of radius 1737.4 km with the terrain heights on top. No refraction (there is no air).
- Sun: the power number is the visible fraction of the disc cut into 32 vertical slices. It ignores the dimmer edge of the Sun (limb darkening), panel pointing and anything about the hardware.
- Earth link: counted when Earth's centre is above the terrain. No antenna, no ground stations on Earth, no link budget.
- Mission metrics are sampled once per step (one hour by default), so durations and times to first sunset are known to one step.
- The browser table is sampled every 3 hours and stored as 16-bit numbers; against the hourly table this adds at most 0.001 degrees. The Sun's distance is kept once a day (largest error 2,600 km of 150 million, which changes the Sun's apparent size by less than 0.00001 degrees).
- The picture of the ground: slopes are lit by the Lommel-Seeliger law from which way they face, at one point per degree of azimuth and 0.2 degrees of elevation, blended between neighbours. The edge between light and shadow is softened by the width of the Sun's disc (0.53 degrees), which is physical; the blending is not, and it hides that the ground a few metres from the observer rests on a handful of 5 m terrain cells. Shadows that one hill casts on another are not computed, and the brightness of all the ground follows the share of the Sun seen from the site, so distant peaks that would still catch the Sun after local sunset go dark with it. When the Sun is down the ground is drawn by Earthlight with the exposure raised; the drawn brightness is a display choice, not the true ratio (about 1 to 10,000, see Sources), and it scales with the lit share of Earth's disc, which is a simplification of how Earth's brightness changes with phase. The picture is for orientation; the numbers do not use it.
- Stars: 2,887 stars of magnitude 5.5 and brighter at their catalogue places for the year 2000; their own motion since then (at most about 0.03 degrees for the nearest stars) and the aberration of light are left out. The Moon's orientation for the stars comes from the IAU series, good to about 0.005 degrees. Checked against Horizons with far planets standing in for stars, 72 comparisons: largest difference 0.008 degrees (`data/stars_check.txt`). "Seen by the eye" always shows the stars, as for an eye shaded from the Sun; "a camera" hides them whenever any part of the Sun is in view, a simple rule.
- Earth's picture: NASA's cloud-free Blue Marble, 256 pixels wide, brightened for the screen; real Earth has clouds. It is turned to the point that faces the Moon's centre (the site sees up to 0.26 degrees more of one side), kept every 12 hours (within 0.07 degrees), and Earth's pole is taken where it was in 2000 (0.15 degrees off). The night side is black.

## Check against Barker et al. (2021)

Table 2 of Barker et al. (2021) gives average illumination and the longest dark period for seven regions of interest (RoIs) at Site 1, for an observer 1 m and 5 m above the ground, from 2024-01-01 to 2026-01-01. We computed the same two numbers with this pipeline at the point stored with each RoI (the column "5 m map for the first 5 km" is the terrain the site files now use; the run was repeated after that change and gave identical numbers), with a separate hourly Horizons table for those two years (`pipeline/compare_barker.py`, output in `data/barker_comparison.txt`). Means over the seven RoIs:

| Observer | Quantity | Barker Case A | Ours, 80 m terrain | Ours, 5 m map for the first 5 km | Barker Case C |
|---|---|---|---|---|---|
| 5 m | average illumination, % | 86.61 | 87.34 | 87.93 | |
| 5 m | longest dark, days | 5.59 | 4.96 | 4.57 | |
| 1 m | average illumination, % | 69.19 | 78.87 | 79.49 | 84.34 |
| 1 m | longest dark, days | 16.06 | 9.80 | 9.78 | |

At 5 m we are 0.0 to 2.5 points above Case A and 0.1 to 2.3 days shorter, the direction expected for one unperturbed map against a pessimistic percentile. At 1 m we are 4 to 14 points above Case A and 4 to 9 days shorter. The two do not measure the same thing. Case A is the average over all pixels inside the RoI polygon, taken as the 1st percentile (illumination) or 99th percentile (dark) over 100 "clone" maps with plausible height errors added. Case C takes the best-lit pixel in the RoI every hour. Ours is one point on one map; it lies between A and C in all seven RoIs.

What was measured:

- Terrain detail. Replacing the first 5 km of our 80 m terrain with PGDA's 5 m map changes the average by 1.7 points at 1 m (largest 3.4) and 0.6 points at 5 m (largest 2.5), and the longest dark period by about half a day (largest 1.9). This was measured when the site numbers still used the 80 m map alone; it is why they now use the 5 m maps. It does not explain the gap at 1 m.
- Clone percentiles. With our code on the paper's 100 clones, still at one point per RoI (`pipeline/compare_barker_clones.py`, `data/barker_clones.txt`): at 5 m the 1st percentile of average illumination is within -0.1 to +0.5 points of Case A, and the 99th percentile of the dark period is 0.0 to 2.0 days shorter. At 1 m a single point ranges over 48 to 86 % across the clones; its 1st percentile is 0.9 to 13.5 points below Case A, and the 99th percentile of its dark period runs from 3.3 days shorter to 7.2 days longer than Case A.
- Area average, RoI 4 only, on the unperturbed 5 m map, 1 m observer (`pipeline/compare_barker_area.py`, `data/barker_area_roi4.txt`): the average over all 532 pixels is 77.5 % (single point 82.4 %, Case A 69.6 %), the mean longest dark period 10.0 days (single point 6.9, Case A 13.3), and the best-lit pixel every hour gives 86.85 % against Case C 86.81 %.

What was not measured: the area average on the clones, which is the exact Case A statistic; the other six RoIs as areas; and the effect of limb darkening, which the paper applies to the Sun's disc and we do not. For RoI 4 the area average closes about 5 of the 13 points between our single point and Case A. The rest is consistent with the clone percentile, but that was not computed directly, and the paper itself was not available to this build; the Table 2 values and the meaning of the cases were supplied by the project author.

## Sources

- Terrain: Barker, M. K., et al. (2023), "A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)", Planetary Science Journal 4, 183. Files `LDEM_80S_80MPP_ADJ.TIF` and `LDEM_60S_240MPP_ADJ.TIF` from NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/90 (south polar stereographic, MOON_ME frame, heights in metres above a 1737.4 km sphere).
- Sun and Earth positions: NASA/JPL Horizons, https://ssd.jpl.nasa.gov/horizons/ (API https://ssd-api.jpl.nasa.gov/doc/horizons.html). One table, Moon (301) seen from Earth's centre (500@399), quantities 14, 15, 19, 20, hourly, 2026-01-01 to 2031-01-01, ephemeris DE441, frame MOON_ME. Check values come from the same service asked for points on the Moon (`coord@301`); the result is in `data/sky_check.txt`.
- Map projection formulas: Snyder, J. P. (1987), "Map Projections: A Working Manual", USGS Professional Paper 1395, polar stereographic on a sphere.
- Sites and their regions: Barker, M. K., et al. (2021), "Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions", Planetary and Space Science 203, 105119, https://doi.org/10.1016/j.pss.2020.105119. Data: NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/78 (5 m tiles and `*_ROIs.tgz` shapefiles). Site numbering follows Mazarico, E., et al. (2011), "Illumination conditions of the lunar polar regions using LOLA topography", Icarus 211, 1066-1081, https://doi.org/10.1016/j.icarus.2010.10.030.
- Typeface: Jost by indestructible type (Owen Earl), SIL Open Font License 1.1, https://github.com/indestructible-type/Jost. Latin subset, weights 400 and 500, taken from the `@fontsource/jost` package 5.3.0; licence text in `site/fonts/OFL.txt`.
- Near terrain: the 5 m/pixel site maps of the same PGDA product, https://pgda.gsfc.nasa.gov/products/78 (`Site01`, `Site04`, `Site07`, `Site11`, `Site20`, `Site23` and `Haworth`, files `*_final_adj_5mpp_surf.tif`), used for the first 5 km around each site.
- Ground brightness: the Lommel-Seeliger law, I = mu0 / (mu0 + mu), as given in Hapke, B. (2012), "Theory of Reflectance and Emittance Spectroscopy", 2nd ed., Cambridge University Press.
- Earthlight: Glenar, D. A., et al. (2019), "Earthshine as an illumination source at the Moon", Icarus 321, 841-856, https://doi.org/10.1016/j.icarus.2018.12.025 (preprint https://arxiv.org/abs/1904.00236): about 0.15 W/m2 on the Moon from the full Earth, roughly half reflected sunlight and half thermal emission, about 0.01 % of sunlight. Only the abstract was read for this project.
- Stars: the Yale Bright Star Catalogue: Hoffleit, D., and Warren, W. H. Jr. (1991), "The Bright Star Catalogue, 5th Revised Edition (Preliminary Version)", Yale University Observatory (original files: http://tdc-www.harvard.edu/catalogs/bsc5.html; also catalogue V/50 at the CDS, https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50). Downloaded from: `bsc5-short.json` at https://github.com/brettonw/YaleBrightStarCatalog, a JSON conversion of the Harvard copy (conversion under the MIT licence), because the original hosts are not reachable from the build environment.
- Moon orientation for the stars: Archinal, B. A., et al. (2011), "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2009", Celestial Mechanics and Dynamical Astronomy 109, 101-135, https://doi.org/10.1007/s10569-010-9320-4. The paper could not be opened from the build environment; the coefficients were typed in and then checked numerically against Horizons (see Limits).
- Earth's facing point: NASA/JPL Horizons, Earth (399) seen from the Moon's centre (500@301), quantity 14, hourly, 2026-01-01 to 2031-01-01.
- Picture of Earth: NASA Blue Marble Next Generation, NASA Earth Observatory / NASA Visible Earth (Stöckli, R., et al. 2005), public domain; collection page https://visibleearth.nasa.gov/collection/1484/blue-marble (address written from memory, the NASA hosts are not reachable from the build environment). Downloaded from: the file `bmng.jpg` inside the `basemap-data` 2.0.0 Python package on PyPI (https://pypi.org/project/basemap-data/), which ships that NASA image; reduced here to 256 x 128 pixels. Which month of the series it shows is not stated in the package.
