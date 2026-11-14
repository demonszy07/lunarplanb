"""What the terrain lets a site see: how much of the Sun's disc, and the Earth.

Power proxy: visible fraction of the Sun's disc (0 to 1).
Earth link:  the centre of the Earth is above the terrain.

The disc is cut into 32 vertical slices of equal width. Each slice uses the
horizon at its own azimuth; the part of the slice above that horizon counts.
fraction = (sum of visible slice heights) / (sum of slice heights).

Mission metrics sample the window every step_hours (default 1 h); every
sample stands for step_hours. Times are therefore known to one step.

This file is the reference. site/js/visibility.js must give the same numbers.
"""

from __future__ import annotations

import numpy as np

import sky

N_SLICES = 32
EARTH_NONE, EARTH_PARTIAL, EARTH_FULL = 0, 1, 2


def horizon_at(profile_deg, az_deg):
    """Horizon angle at any azimuth: straight line between the stored
    directions (evenly spaced from north, clockwise), wrapping at 360."""
    profile = np.asarray(profile_deg, dtype=float)
    n = len(profile)
    pos = (np.asarray(az_deg, dtype=float) % 360.0) * (n / 360.0)
    i0 = np.floor(pos).astype(int) % n
    f = pos - np.floor(pos)
    return profile[i0] + (profile[(i0 + 1) % n] - profile[i0]) * f


def disc_fraction(profile_deg, az_deg, el_deg, diameter_deg):
    """Visible fraction of a disc centred at (az, el). Inputs may be arrays."""
    az = np.asarray(az_deg, dtype=float)[..., None]
    el = np.asarray(el_deg, dtype=float)[..., None]
    radius = np.asarray(diameter_deg, dtype=float)[..., None] / 2.0
    k = np.arange(N_SLICES)
    x = radius * ((2 * k + 1) / N_SLICES - 1.0)        # slice centre, left to right
    half = np.sqrt(radius * radius - x * x)            # half height of the slice
    # a sideways offset x on the sky is x / cos(elevation) in azimuth
    ground = horizon_at(profile_deg, az + x / np.cos(np.radians(el)))
    seen = np.clip(el + half - ground, 0.0, 2.0 * half)
    return seen.sum(axis=-1) / (2.0 * half).sum(axis=-1)


def earth_state(fraction):
    """0 none, 1 partial, 2 full, from the visible fraction of Earth's disc."""
    f = np.asarray(fraction)
    return np.where(f <= 0.0, EARTH_NONE, np.where(f >= 1.0, EARTH_FULL, EARTH_PARTIAL))


def view(table: dict, site: dict, hours):
    """Sun and Earth over a site's terrain at the given hours since epoch.

    site needs lat, lon, site_height_m, observer_height_m, elevation_deg.
    Returns arrays: sun_az, sun_el, sun_fraction, earth_az, earth_el,
    earth_fraction, earth_state, earth_link.
    """
    height = site["site_height_m"] + site["observer_height_m"]
    s = sky.sky(table, hours, site["lat"], site["lon"], height)
    profile = site["elevation_deg"]
    sun_az, sun_el, sun_d = s["sun"]
    earth_az, earth_el, earth_d = s["earth"]
    earth_fraction = disc_fraction(profile, earth_az, earth_el, earth_d)
    return {
        "sun_az": sun_az, "sun_el": sun_el,
        "sun_fraction": disc_fraction(profile, sun_az, sun_el, sun_d),
        "earth_az": earth_az, "earth_el": earth_el,
        "earth_fraction": earth_fraction,
        "earth_state": earth_state(earth_fraction),
        "earth_link": earth_el > horizon_at(profile, earth_az),
    }


def longest_run(flags) -> int:
    """Length of the longest unbroken run of True."""
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def first_true(flags):
    """Index of the first True, or None."""
    for i, f in enumerate(flags):
        if f:
            return i
    return None


def metrics(table: dict, site: dict, start_hours: float, duration_hours: float,
            step_hours: float = 1.0) -> dict:
    """Numbers for one mission window.

    Samples at start, start + step, ... (duration / step samples).
      sunlit_hours          any part of the Sun's disc is visible
      mean_sun_fraction     average visible fraction of the disc over the window
      longest_dark_hours    longest unbroken time with no Sun at all
      earth_hours           Earth's centre is above the terrain
      longest_outage_hours  longest unbroken time without that
      both_hours            Sun visible and Earth link at the same time
      hours_to_first_sunset time from the start until the Sun is first fully
                            hidden (0 if hidden at the start, None if never)
      hours_to_first_earthset  the same for the Earth link
    """
    n = int(round(duration_hours / step_hours))
    hours = start_hours + step_hours * np.arange(n)
    v = view(table, site, hours)
    sun = v["sun_fraction"] > 0.0
    link = v["earth_link"]
    sunset = first_true(~sun)
    earthset = first_true(~link)
    return {
        "samples": n,
        "sunlit_hours": float(sun.sum() * step_hours),
        "mean_sun_fraction": float(v["sun_fraction"].mean()),
        "longest_dark_hours": float(longest_run(~sun) * step_hours),
        "earth_hours": float(link.sum() * step_hours),
        "longest_outage_hours": float(longest_run(~link) * step_hours),
        "both_hours": float((sun & link).sum() * step_hours),
        "hours_to_first_sunset": None if sunset is None else float(sunset * step_hours),
        "hours_to_first_earthset": None if earthset is None else float(earthset * step_hours),
    }
