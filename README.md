# Lunar Plan B

One screen that compares two landing plans for the lunar south pole: where the Sun and Earth sit relative to the real terrain horizon, and what that means for power and direct-to-Earth contact.

NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".

## Run

```
pip install -r requirements.txt
python pipeline/ephemeris.py      # downloads the Horizons table to data/raw/
python pipeline/sky.py            # writes site/data/sky.bin for the browser
python pipeline/check_sky.py      # compares with direct Horizons queries
python pipeline/build_sites.py    # writes data/sites/[id].json (needs the two terrain files)
python tests/make_vectors.py      # writes tests/vectors.json from the Python reference
python pipeline/monthly.py data/sites/site01.json 2027
python pipeline/compare_barker.py  # check against Barker et al. 2021 (needs extra downloads, see the file)
python pipeline/plot_horizon.py data/sites/site01.json data/site1_horizon.png
python -m pytest tests
```

The two terrain files listed under Sources go in `data/raw/` (not stored in this repository).
The JavaScript tests need Node.js.

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

Heights are above the 1737.4 km sphere, read from `LDEM_80S_80MPP_ADJ.TIF`. The observer is 2 m above the ground.

## Limits

- Earth direction: the azimuth of Earth differs from JPL Horizons asked directly for a point on the Moon by 0.004 degrees (median) and up to 0.006 degrees; elevation by up to 0.0006 degrees (`data/sky_check.txt`). The Sun agrees to 0.0002 degrees. Likely cause, not proven here: the sub-Earth point in the Horizons table is corrected for light travel time only, while the direct query also applies the aberration of light (about 0.0057 degrees). No correction is applied. Earth's disc is about 1.9 degrees wide.
- Terrain detail: the horizon within 100 km comes from an 80 m terrain model and the observer is 2 m above it. At these sites the horizon is often set by ground only a few hundred metres away (most directions at Site 1), which an 80 m model shows only roughly. Rocks, the lander itself and slopes smaller than 80 m are not in the result.
- Terrain beyond 300 km is ignored.
- The Moon is treated as a sphere of radius 1737.4 km with the terrain heights on top. No refraction (there is no air).
- Sun: the power number is the visible fraction of the disc cut into 32 vertical slices. It ignores the dimmer edge of the Sun (limb darkening), panel pointing and anything about the hardware.
- Earth link: counted when Earth's centre is above the terrain. No antenna, no ground stations on Earth, no link budget.
- Mission metrics are sampled once per step (one hour by default), so durations and times to first sunset are known to one step.
- The browser table is sampled every 3 hours and stored as 16-bit numbers; against the hourly table this adds at most 0.001 degrees.

## Check against Barker et al. (2021)

Table 2 of Barker et al. (2021) gives average illumination and the longest dark period for seven regions of interest (RoIs) at Site 1, for an observer 1 m and 5 m above the ground, from 2024-01-01 to 2026-01-01. We computed the same two numbers with this pipeline at the point stored with each RoI, with a separate hourly Horizons table for those two years (`pipeline/compare_barker.py`, output in `data/barker_comparison.txt`). Means over the seven RoIs:

| Observer | Quantity | Barker Case A | Ours, 80 m terrain | Ours, 5 m map for the first 5 km | Barker Case C |
|---|---|---|---|---|---|
| 5 m | average illumination, % | 86.61 | 87.34 | 87.93 | |
| 5 m | longest dark, days | 5.59 | 4.96 | 4.57 | |
| 1 m | average illumination, % | 69.19 | 78.87 | 79.49 | 84.34 |
| 1 m | longest dark, days | 16.06 | 9.80 | 9.78 | |

At 5 m we are 0.0 to 2.5 points above Case A and 0.1 to 2.3 days shorter, the direction expected for one unperturbed map against a pessimistic percentile. At 1 m we are 4 to 14 points above Case A and 4 to 9 days shorter. The two do not measure the same thing. Case A is the average over all pixels inside the RoI polygon, taken as the 1st percentile (illumination) or 99th percentile (dark) over 100 "clone" maps with plausible height errors added. Case C takes the best-lit pixel in the RoI every hour. Ours is one point on one map; it lies between A and C in all seven RoIs.

What was measured:

- Terrain detail. Replacing the first 5 km of our 80 m terrain with PGDA's 5 m map changes the average by 1.7 points at 1 m (largest 3.4) and 0.6 points at 5 m (largest 2.5), and the longest dark period by about half a day (largest 1.9). This is the size of the terrain uncertainty in the site numbers of this project. It does not explain the gap at 1 m.
- Clone percentiles. With our code on the paper's 100 clones, still at one point per RoI (`pipeline/compare_barker_clones.py`, `data/barker_clones.txt`): at 5 m the 1st percentile of average illumination is within -0.1 to +0.5 points of Case A, and the 99th percentile of the dark period is 0.0 to 2.0 days shorter. At 1 m a single point ranges over 48 to 86 % across the clones; its 1st percentile is 0.9 to 13.5 points below Case A, and the 99th percentile of its dark period runs from 3.3 days shorter to 7.2 days longer than Case A.
- Area average, RoI 4 only, on the unperturbed 5 m map, 1 m observer (`pipeline/compare_barker_area.py`, `data/barker_area_roi4.txt`): the average over all 532 pixels is 77.5 % (single point 82.4 %, Case A 69.6 %), the mean longest dark period 10.0 days (single point 6.9, Case A 13.3), and the best-lit pixel every hour gives 86.85 % against Case C 86.81 %.

What was not measured: the area average on the clones, which is the exact Case A statistic; the other six RoIs as areas; and the effect of limb darkening, which the paper applies to the Sun's disc and we do not. For RoI 4 the area average closes about 5 of the 13 points between our single point and Case A. The rest is consistent with the clone percentile, but that was not computed directly, and the paper itself was not available to this build; the Table 2 values and the meaning of the cases were supplied by the project author.

## Sources

- Terrain: Barker, M. K., et al. (2023), "A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)", Planetary Science Journal 4, 183. Files `LDEM_80S_80MPP_ADJ.TIF` and `LDEM_60S_240MPP_ADJ.TIF` from NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/90 (south polar stereographic, MOON_ME frame, heights in metres above a 1737.4 km sphere).
- Sun and Earth positions: NASA/JPL Horizons, https://ssd.jpl.nasa.gov/horizons/ (API https://ssd-api.jpl.nasa.gov/doc/horizons.html). One table, Moon (301) seen from Earth's centre (500@399), quantities 14, 15, 19, 20, hourly, 2026-01-01 to 2031-01-01, ephemeris DE441, frame MOON_ME. Check values come from the same service asked for points on the Moon (`coord@301`); the result is in `data/sky_check.txt`.
- Map projection formulas: Snyder, J. P. (1987), "Map Projections: A Working Manual", USGS Professional Paper 1395, polar stereographic on a sphere.
- Sites and their regions: Barker, M. K., et al. (2021), "Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions", Planetary and Space Science 203, 105119, https://doi.org/10.1016/j.pss.2020.105119. Data: NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/78 (5 m tiles and `*_ROIs.tgz` shapefiles). Site numbering follows Mazarico, E., et al. (2011), "Illumination conditions of the lunar polar regions using LOLA topography", Icarus 211, 1066-1081, https://doi.org/10.1016/j.icarus.2010.10.030.
