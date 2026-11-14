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

const RAD = Math.PI / 180;
const SUN = "#FFF8E7";
const REGOLITH = [184, 180, 172];               // sunlit regolith at its brightest on screen
const EARTHLIT = [120, 140, 175];               // regolith under Earthlight, exposure raised
const EARTHLIT_LEVEL = 0.32;                    // how bright full Earthlight is drawn (not a physical ratio)
const EARTH_LIT = "#CFE2FF";
const EARTH_DARK = "#0B1830";
const GROUND = "#121212";
const SKYLINE = "#3A3A3A";
const LABEL = "#9A9A9A";

const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// Read a [site]_view.bin file: for every degree of azimuth and every 0.2
// degrees of elevation below the skyline, which way the ground faces.
export function parseView(buffer) {
  const bytes = new DataView(buffer);
  const magic = String.fromCharCode(bytes.getUint8(0), bytes.getUint8(1), bytes.getUint8(2), bytes.getUint8(3));
  if (magic !== "LVEW") throw new Error("not a view file");
  const length = bytes.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  return {
    columns: header.columns, rows: header.rows,
    elTop: header.elevation_top_deg, elStep: header.elevation_step_deg,
    // stored as signed square roots (finest steps for nearly level ground); undo that once
    normals: Float32Array.from(new Int8Array(buffer, 8 + length, header.columns * header.rows * 2),
      (q) => Math.sign(q) * (q / 127) * (q / 127)),
    canvas: null, key: "",
  };
}

// The light is a disc about 0.53 degrees wide, not a point: while the ground's
// own horizon cuts through that disc the brightness rises smoothly instead of
// switching on (the average of max(0, mu0) over the disc's half width).
const DISC = Math.sin(0.2666 * RAD);
function softMu0(mu0) {
  return mu0 >= DISC ? mu0 : mu0 <= -DISC ? 0 : (mu0 + DISC) * (mu0 + DISC) / (4 * DISC);
}

// Brightness of a patch of ground by the Lommel-Seeliger law, the usual
// first model for the dark, dusty lunar surface:
//   I = mu0 / (mu0 + mu)
// mu0 = cosine of the angle between the ground normal and the light,
// mu  = cosine of the angle between the ground normal and the line to the eye.
// The normal is given by its east and north parts (unit vector, up is the rest);
// the patch is seen in direction (az, el); the light is at (lightAz, lightEl).
export function lommelSeeliger(nEast, nNorth, az, el, lightAz, lightEl) {
  const nUp = Math.sqrt(Math.max(0, 1 - nEast * nEast - nNorth * nNorth));
  const ce = Math.cos(lightEl * RAD);
  const mu0 = softMu0(nEast * ce * Math.sin(lightAz * RAD) + nNorth * ce * Math.cos(lightAz * RAD) + nUp * Math.sin(lightEl * RAD));
  if (mu0 <= 0) return 0;
  const cv = Math.cos(el * RAD);
  const mu = Math.max(0.01, -(nEast * cv * Math.sin(az * RAD) + nNorth * cv * Math.cos(az * RAD) + nUp * Math.sin(el * RAD)));
  return mu0 / (mu0 + mu);
}

// What lights the ground at this moment. The Sun counts by the share of its
// disc seen from the site. With no Sun at all, Earthlight takes over, drawn
// with the exposure raised (it is roughly ten thousand times fainter).
export function lighting(view) {
  if (view.sunFraction > 0) return { source: "sun", strength: view.sunFraction };
  const phase = earthPhase(view.sunAz, view.sunEl, view.earthAz, view.earthEl);
  if (view.earthFraction > 0) return { source: "earth", strength: view.earthFraction * phase.lit };
  return { source: "none", strength: 0 };
}

// Paint the picture of the ground. The stored normals (one per degree and
// per 0.2 degrees of elevation) are blended between neighbours first and lit
// afterwards, so the edge between light and shadow stays smooth.
const FINER_AZ = 3, FINER_EL = 2;
function shadeGround(ground, view) {
  const light = lighting(view);
  const lightAz = light.source === "earth" ? view.earthAz : view.sunAz;
  const lightEl = light.source === "earth" ? view.earthEl : view.sunEl;
  const key = [light.source, light.strength.toFixed(3), lightAz.toFixed(2), lightEl.toFixed(2)].join();
  if (ground.canvas && ground.key === key) return ground.canvas;
  const columns = ground.columns, rows = ground.rows;
  const wide = columns * FINER_AZ, high = rows * FINER_EL;
  if (!ground.canvas) {
    ground.canvas = document.createElement("canvas");
    ground.canvas.width = wide;
    ground.canvas.height = high;
    ground.image = ground.canvas.getContext("2d").createImageData(wide, high);
    // direction of every picture column and row, worked out once
    ground.sinAz = new Float64Array(wide); ground.cosAz = new Float64Array(wide);
    for (let x = 0; x < wide; x++) {
      const az = ((x + 0.5) / FINER_AZ - 0.5) * RAD;
      ground.sinAz[x] = Math.sin(az); ground.cosAz[x] = Math.cos(az);
    }
    ground.sinEl = new Float64Array(high); ground.cosEl = new Float64Array(high);
    for (let y = 0; y < high; y++) {
      const el = (ground.elTop - ((y + 0.5) / FINER_EL) * ground.elStep) * RAD;
      ground.sinEl[y] = Math.sin(el); ground.cosEl[y] = Math.cos(el);
    }
  }
  ground.key = key;
  const data = ground.image.data, normals = ground.normals;
  const colour = light.source === "earth" ? EARTHLIT : REGOLITH;
  const level = light.source === "earth" ? EARTHLIT_LEVEL : 1;
  const lx = Math.cos(lightEl * RAD) * Math.sin(lightAz * RAD);
  const ly = Math.cos(lightEl * RAD) * Math.cos(lightAz * RAD);
  const lz = Math.sin(lightEl * RAD);
  let p = 0;
  for (let y = 0; y < high; y++) {
    const fr = Math.min(rows - 1, Math.max(0, (y + 0.5) / FINER_EL - 0.5));
    const r0 = Math.min(rows - 2, Math.floor(fr)), tr = fr - r0;
    const se = ground.sinEl[y], ce = ground.cosEl[y];
    for (let x = 0; x < wide; x++, p += 4) {
      let value = 0;
      if (light.strength > 0) {
        const fc = (x + 0.5) / FINER_AZ - 0.5 + columns;
        const c0 = Math.floor(fc), tc = fc - c0;
        const a = 2 * (r0 * columns + c0 % columns), b = 2 * (r0 * columns + (c0 + 1) % columns);
        const c = a + 2 * columns, d = b + 2 * columns;
        const w00 = (1 - tr) * (1 - tc), w01 = (1 - tr) * tc, w10 = tr * (1 - tc), w11 = tr * tc;
        const ne = w00 * normals[a] + w01 * normals[b] + w10 * normals[c] + w11 * normals[d];
        const nn = w00 * normals[a + 1] + w01 * normals[b + 1] + w10 * normals[c + 1] + w11 * normals[d + 1];
        const nu = Math.sqrt(Math.max(0, 1 - ne * ne - nn * nn));
        const mu0 = softMu0(ne * lx + nn * ly + nu * lz);
        if (mu0 > 0) {
          // the same Lommel-Seeliger law as lommelSeeliger() above
          const mu = Math.max(0.01, -(ne * ce * ground.sinAz[x] + nn * ce * ground.cosAz[x] + nu * se));
          value = level * Math.pow(light.strength * mu0 / (mu0 + mu), 1 / 2.2);   // display gamma, like a camera
        }
      }
      data[p] = colour[0] * value;
      data[p + 1] = colour[1] * value;
      data[p + 2] = colour[2] * value;
      data[p + 3] = 255;
    }
  }
  ground.canvas.getContext("2d").putImageData(ground.image, 0, 0);
  return ground.canvas;
}

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

// Stars at their real places (azimuth, elevation, magnitude from realsky.js).
// Brighter stars are a little larger and whiter; the faintest are barely there.
function drawStars(ctx, g, stars) {
  ctx.fillStyle = "#fff";
  const half = g.windowDeg / 2;
  const faintest = g.width < 600 && g.full ? 4.5 : 5.5;     // a small full panorama gets fewer stars
  for (let i = 0; i < stars.count; i++) {
    if (stars.mag[i] > faintest) break;                     // the list is sorted, brightest first
    const el = stars.el[i];
    if (el < EL_BOTTOM || el > EL_TOP) continue;
    const offset = wrap180(stars.az[i] - g.centre);
    if (Math.abs(offset) > half) continue;
    const mag = stars.mag[i];
    ctx.globalAlpha = Math.min(1, Math.max(0.28, 1 - 0.11 * (mag + 1.5)));
    const size = mag < 0.5 ? 2 : mag < 2.5 ? 1.5 : 1;
    ctx.fillRect(g.width / 2 + offset * g.h - size / 2, g.y(el) - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

// Size in device pixels of the picture of Earth for a canvas of this size.
export function earthPictureSize(view, height) {
  const ratio = window.devicePixelRatio || 1;
  return Math.max(8, Math.ceil(view.earthDiameter * (height / (EL_TOP - EL_BOTTOM)) * ratio));
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

  if (options.stars) drawStars(ctx, g, options.stars);
  if (options.earthPicture) {
    const x = g.x(view.earthAz), y = g.y(view.earthEl), r = (view.earthDiameter / 2) * g.v;
    ctx.drawImage(options.earthPicture, x - r, y - r, 2 * r, 2 * r);
  } else {
    drawEarth(ctx, g, view);
  }
  drawSun(ctx, g, view);

  // ground: everything under the skyline, then the skyline itself
  terrainPath(ctx, g, site.elevation_deg);
  ctx.lineTo(width + 2, height + 2);
  ctx.lineTo(-2, height + 2);
  ctx.closePath();
  if (options.ground) {
    // lit and shadowed slopes, stretched from the small picture and cut along the skyline
    const picture = shadeGround(options.ground, view);
    const top = g.y(options.ground.elTop), span = options.ground.rows * options.ground.elStep * g.v;
    const left = width / 2 + (-0.5 - g.centre) * g.h, wide = 360 * g.h;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const turn of [-1, 0, 1]) {
      const x = left + turn * wide;
      if (x < width && x + wide > 0) ctx.drawImage(picture, x, top, wide, span);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = GROUND;
    ctx.fill();
  }
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
