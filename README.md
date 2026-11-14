# Lunar Plan B

One screen that compares two landing plans for the lunar south pole: where the Sun and Earth sit relative to the real terrain horizon, and what that means for power and direct-to-Earth contact.

NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".

## Run

```
pip install -r requirements.txt
python -m pytest tests
python pipeline/horizon.py --lat -89.45 --lon 222.69 --height 2 --out data/site1_horizon.json
python pipeline/plot_horizon.py data/site1_horizon.json data/site1_horizon.png
python pipeline/ephemeris.py      # downloads the Horizons table to data/raw/
python pipeline/sky.py            # writes site/data/sky.bin for the browser
python pipeline/check_sky.py      # compares with direct Horizons queries
```

The JavaScript test needs Node.js.

The two terrain files listed under Sources go in `data/raw/` (not stored in this repository).

## Sources

- Terrain: Barker, M. K., et al. (2023), "A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)", Planetary Science Journal 4, 183. Files `LDEM_80S_80MPP_ADJ.TIF` and `LDEM_60S_240MPP_ADJ.TIF` from NASA GSFC Planetary Geodynamics Data Archive, https://pgda.gsfc.nasa.gov/products/90 (south polar stereographic, MOON_ME frame, heights in metres above a 1737.4 km sphere).
- Sun and Earth positions: NASA/JPL Horizons, https://ssd.jpl.nasa.gov/horizons/ (API https://ssd-api.jpl.nasa.gov/doc/horizons.html). One table, Moon (301) seen from Earth's centre (500@399), quantities 14, 15, 19, 20, hourly, 2026-01-01 to 2031-01-01, ephemeris DE441, frame MOON_ME. Check values come from the same service asked for points on the Moon (`coord@301`); the result is in `data/sky_check.txt`.
- Map projection formulas: Snyder, J. P. (1987), "Map Projections: A Working Manual", USGS Professional Paper 1395, polar stereographic on a sphere.

