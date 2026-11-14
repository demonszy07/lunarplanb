// What the terrain lets a site see: how much of the Sun's disc, and the Earth.
// Same calculation as pipeline/visibility.py (the reference); tests compare the two.
//
// Power proxy: visible fraction of the Sun's disc (0 to 1).
// Earth link:  the centre of the Earth is above the terrain.

import { skyAt } from "./sky.js";

const RAD = Math.PI / 180;
export const N_SLICES = 32;
export const EARTH_NONE = 0, EARTH_PARTIAL = 1, EARTH_FULL = 2;

// Horizon angle at any azimuth: straight line between the stored directions
// (evenly spaced from north, clockwise), wrapping at 360.
export function horizonAt(profile, azDeg) {
  const n = profile.length;
  const pos = (((azDeg % 360) + 360) % 360) * (n / 360);
  const whole = Math.floor(pos);
  const i0 = whole % n;
  const f = pos - whole;
  return profile[i0] + (profile[(i0 + 1) % n] - profile[i0]) * f;
}

// Visible fraction of a disc centred at (az, el): 32 vertical slices, each
// against the horizon at its own azimuth.
export function discFraction(profile, azDeg, elDeg, diameterDeg) {
  const radius = diameterDeg / 2;
  const cosEl = Math.cos(elDeg * RAD);
  let seen = 0, total = 0;
  for (let k = 0; k < N_SLICES; k++) {
    const x = radius * ((2 * k + 1) / N_SLICES - 1);
    const half = Math.sqrt(radius * radius - x * x);
    const ground = horizonAt(profile, azDeg + x / cosEl);
    seen += Math.min(Math.max(elDeg + half - ground, 0), 2 * half);
    total += 2 * half;
  }
  return seen / total;
}

export function earthState(fraction) {
  return fraction <= 0 ? EARTH_NONE : fraction >= 1 ? EARTH_FULL : EARTH_PARTIAL;
}

// Sun and Earth over a site's terrain at `hours` since the table epoch.
// site needs lat, lon, site_height_m, observer_height_m, elevation_deg.
export function viewAt(table, site, hours) {
  const s = skyAt(table, hours, site.lat, site.lon, site.site_height_m + site.observer_height_m);
  const profile = site.elevation_deg;
  const earthFraction = discFraction(profile, s.earth.az, s.earth.el, s.earth.diameter);
  return {
    sunAz: s.sun.az, sunEl: s.sun.el,
    sunFraction: discFraction(profile, s.sun.az, s.sun.el, s.sun.diameter),
    earthAz: s.earth.az, earthEl: s.earth.el,
    earthFraction,
    earthState: earthState(earthFraction),
    earthLink: s.earth.el > horizonAt(profile, s.earth.az),
  };
}

// Numbers for one mission window. Samples at start, start + step, ...
// Every sample stands for stepHours, so times are known to one step.
export function metrics(table, site, startHours, durationHours, stepHours = 1) {
  const n = Math.round(durationHours / stepHours);
  let sunlit = 0, fractionSum = 0, earth = 0, both = 0;
  let dark = 0, longestDark = 0, outage = 0, longestOutage = 0;
  let sunset = null, earthset = null;
  for (let i = 0; i < n; i++) {
    const v = viewAt(table, site, startHours + stepHours * i);
    const sun = v.sunFraction > 0;
    fractionSum += v.sunFraction;
    if (sun) { sunlit++; dark = 0; } else {
      dark++;
      if (dark > longestDark) longestDark = dark;
      if (sunset === null) sunset = i;
    }
    if (v.earthLink) { earth++; outage = 0; } else {
      outage++;
      if (outage > longestOutage) longestOutage = outage;
      if (earthset === null) earthset = i;
    }
    if (sun && v.earthLink) both++;
  }
  return {
    samples: n,
    sunlitHours: sunlit * stepHours,
    meanSunFraction: fractionSum / n,
    longestDarkHours: longestDark * stepHours,
    earthHours: earth * stepHours,
    longestOutageHours: longestOutage * stepHours,
    bothHours: both * stepHours,
    hoursToFirstSunset: sunset === null ? null : sunset * stepHours,
    hoursToFirstEarthset: earthset === null ? null : earthset * stepHours,
  };
}
