"""Month-by-month sunlit and Earth-visible hours for one site and year.

Uses the hourly Horizons table (the reference), one sample per hour.
Sunlit = any part of the Sun's disc above the terrain.
Earth visible = Earth's centre above the terrain.
"""

import argparse
import calendar
import datetime as dt
import json

import ephemeris
import visibility

ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
ap.add_argument("site_json")
ap.add_argument("year", type=int)
args = ap.parse_args()

with open(args.site_json) as f:
    site = json.load(f)
table = ephemeris.load()

print(f"{site['name']} ({site['lat']}, {site['lon']} E), {args.year}, observer "
      f"{site['observer_height_m']:g} m above ground, hourly samples (UT)")
print(f"{'month':9} {'hours':>6} {'sunlit':>7} {'%':>6} {'mean disc':>10} {'longest dark':>13} "
      f"{'Earth':>7} {'%':>6} {'longest outage':>15} {'both':>6}")
total = None
for month in range(1, 13):
    start = ephemeris.hours_since_epoch(dt.datetime(args.year, month, 1))
    hours = calendar.monthrange(args.year, month)[1] * 24
    m = visibility.metrics(table, site, start, hours)
    print(f"{calendar.month_abbr[month]:9} {hours:6d} {m['sunlit_hours']:7.0f} "
          f"{100 * m['sunlit_hours'] / hours:6.1f} {m['mean_sun_fraction']:10.3f} "
          f"{m['longest_dark_hours']:13.0f} {m['earth_hours']:7.0f} "
          f"{100 * m['earth_hours'] / hours:6.1f} {m['longest_outage_hours']:15.0f} "
          f"{m['both_hours']:6.0f}")
start = ephemeris.hours_since_epoch(dt.datetime(args.year, 1, 1))
hours = (366 if calendar.isleap(args.year) else 365) * 24
m = visibility.metrics(table, site, start, hours)
print(f"{'year':9} {hours:6d} {m['sunlit_hours']:7.0f} {100 * m['sunlit_hours'] / hours:6.1f} "
      f"{m['mean_sun_fraction']:10.3f} {m['longest_dark_hours']:13.0f} {m['earth_hours']:7.0f} "
      f"{100 * m['earth_hours'] / hours:6.1f} {m['longest_outage_hours']:15.0f} {m['both_hours']:6.0f}")
