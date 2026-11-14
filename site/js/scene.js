// The view from the site: a 360 degree panorama drawn like a photograph.
// Black sky, the real skyline, the Sun, the Earth with its phase.
//
// Scales: one degree of elevation is `v` pixels, one degree of azimuth `h`
// pixels. v / h is the vertical exaggeration and is always written on screen.
// Sun and Earth are drawn round at the vertical scale, so the terrain cuts
// them at the right height; sideways they are wider than life by that factor.

import { horizonAt } from "./visibility.js";
import { earthPhase } from "./sky.js";

export const EL_TOP = 12, EL_BOTTOM = -8;       // degrees shown, top and bottom
const MAX_STRETCH_FULL = 10;                    // show all 360 degrees if the stretch stays under this
const STRETCH_WINDOW = 8;                       // otherwise show a window at this stretch

const SUN = "#FFF8E7";
const EARTH_LIT = "#CFE2FF";
const EARTH_DARK = "#0B1830";
const GROUND = "#121212";
const SKYLINE = "#3A3A3A";
const LABEL = "#9A9A9A";

const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// Placeholder star field: fixed points, the same on every visit.
const STARS = (() => {
  let seed = 20261114;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 70 }, () => ({
    az: next() * 360, el: -2 + next() * 14, alpha: 0.25 + next() * 0.2,
  }));
})();

// How the panorama maps to the canvas for a given size.
export function geometry(width, height, centreAz, forceFull) {
  const v = height / (EL_TOP - EL_BOTTOM);
  const full = forceFull || width / 360 >= v / MAX_STRETCH_FULL;
  const h = full ? width / 360 : v / STRETCH_WINDOW;
  const centre = full ? 180 : centreAz;
  return {
    width, height, v, h, full, centre,
    windowDeg: width / h,
    stretch: v / h,
    x: (az) => width / 2 + wrap180(az - centre) * h,
    y: (el) => (EL_TOP - el) * v,
  };
}

function drawSun(ctx, g, view) {
  const x = g.x(view.sunAz), y = g.y(view.sunEl), r = (view.sunDiameter / 2) * g.v;
  ctx.fillStyle = SUN;
  // small hard-edged flare: four thin spikes, no blur
  ctx.globalAlpha = 0.55;
  const reach = r * 3.2 + 4, half = Math.max(0.75, r * 0.16);
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * reach, y + dy * reach);
    ctx.lineTo(x - dy * half, y + dx * half);
    ctx.lineTo(x + dy * half, y - dx * half);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

function drawEarth(ctx, g, view) {
  const x = g.x(view.earthAz), y = g.y(view.earthEl), r = (view.earthDiameter / 2) * g.v;
  const phase = earthPhase(view.sunAz, view.sunEl, view.earthAz, view.earthEl);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = EARTH_DARK;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fill();
  // turn so that +x points from Earth toward the Sun on the sky
  const q = phase.towardSun * Math.PI / 180;
  ctx.rotate(Math.atan2(-Math.cos(q), Math.sin(q)));
  ctx.fillStyle = EARTH_LIT;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);              // the limb facing the Sun
  const c = phase.cosAngle;                                         // > 0 crescent, < 0 gibbous
  ctx.ellipse(0, 0, r * Math.abs(c), r, 0, Math.PI / 2, -Math.PI / 2 + (c > 0 ? 0 : 2 * Math.PI), c > 0);
  ctx.fill();
  ctx.restore();
}

function terrainPath(ctx, g, profile) {
  const from = g.centre - g.windowDeg / 2 - 1, to = g.centre + g.windowDeg / 2 + 1;
  ctx.beginPath();
  for (let az = from; az <= to; az += 0.5) {
    const x = g.width / 2 + (az - g.centre) * g.h, y = g.y(horizonAt(profile, az));
    if (az === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

// Draw one view. `site` has elevation_deg (720 values); `view` is the result
// of viewAt for the moment shown. Returns the geometry used.
export function drawScene(canvas, site, view, options = {}) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const centreAz = options.lookAt === "earth" ? view.earthAz : view.sunAz;
  const g = geometry(width, height, centreAz, options.forceFull);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#fff";
  for (const s of STARS) {
    ctx.globalAlpha = s.alpha;
    ctx.fillRect(Math.round(g.x(s.az)), Math.round(g.y(s.el)), 1, 1);
  }
  ctx.globalAlpha = 1;

  drawEarth(ctx, g, view);
  drawSun(ctx, g, view);

  // ground: everything under the skyline, then the skyline itself
  terrainPath(ctx, g, site.elevation_deg);
  ctx.lineTo(width + 2, height + 2);
  ctx.lineTo(-2, height + 2);
  ctx.closePath();
  ctx.fillStyle = GROUND;
  ctx.fill();
  terrainPath(ctx, g, site.elevation_deg);
  ctx.strokeStyle = SKYLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (options.compass !== false) {
    ctx.fillStyle = LABEL;
    ctx.font = "12px Jost, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const names = ["north", "east", "south", "west"];
    for (let k = 0; k < 4; k++) {
      const offset = wrap180(k * 90 - g.centre);
      if (Math.abs(offset) > g.windowDeg / 2 + 0.01) continue;
      const x = g.width / 2 + offset * g.h;
      ctx.textAlign = x < 30 ? "left" : x > width - 30 ? "right" : "center";
      ctx.fillText(names[k], Math.min(Math.max(x, 4), width - 4), height - 7);
    }
    if (g.full) { ctx.textAlign = "right"; ctx.fillText("north", width - 4, height - 7); }
  }
  return g;
}

// Where the other body is when the window does not show it.
export function offFrameNote(g, view, lookAt) {
  if (g.full) return "";
  const other = lookAt === "earth" ? "The Sun" : "Earth";
  const az = lookAt === "earth" ? view.sunAz : view.earthAz;
  const offset = wrap180(az - g.centre);
  if (Math.abs(offset) <= g.windowDeg / 2) return "";
  const seen = lookAt === "earth" ? view.sunFraction > 0 : view.earthFraction > 0;
  return `${other} is ${Math.abs(Math.round(offset))}° to the ${offset < 0 ? "left" : "right"}, ` +
    (seen ? "above the terrain." : "behind the terrain.");
}
