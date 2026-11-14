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

## Sources

- Terrain: Barker, M. K., et al. (2023), "A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)", Planetary Science Journal 4, 183. Files `LDEM_80S_80MPP_ADJ.TIF` and `LDEM_60S_240MPP_ADJ.TIF` from NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/90 (south polar stereographic, MOON_ME frame, heights in metres above a 1737.4 km sphere).
- Sun and Earth positions: NASA/JPL Horizons, https://ssd.jpl.nasa.gov/horizons/ (API https://ssd-api.jpl.nasa.gov/doc/horizons.html). One table, Moon (301) seen from Earth's centre (500@399), quantities 14, 15, 19, 20, hourly, 2026-01-01 to 2031-01-01, ephemeris DE441, frame MOON_ME. Check values come from the same service asked for points on the Moon (`coord@301`); the result is in `data/sky_check.txt`.
- Map projection formulas: Snyder, J. P. (1987), "Map Projections: A Working Manual", USGS Professional Paper 1395, polar stereographic on a sphere.
- Sites and their regions: Barker, M. K., et al. (2021), "Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions", Planetary and Space Science 203, 105119, https://doi.org/10.1016/j.pss.2020.105119. Data: NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/78 (5 m tiles and `*_ROIs.tgz` shapefiles). Site numbering follows Mazarico, E., et al. (2011), "Illumination conditions of the lunar polar regions using LOLA topography", Icarus 211, 1066-1081, https://doi.org/10.1016/j.icarus.2010.10.030.
