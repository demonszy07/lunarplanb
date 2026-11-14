// The real sky: stars where they are, and the Earth turning with its face lit
// the right way. Same calculation as pipeline/realsky.py (the reference).
// Loaded after the first view is on screen.
//
// Moon orientation: IAU model (Archinal et al. 2011, Celestial Mechanics and
// Dynamical Astronomy 109, 101-135). Stars: Yale Bright Star Catalogue, 5th
// revised edition. Earth's facing point: NASA/JPL Horizons. Picture of Earth:
// NASA Blue Marble Next Generation.

const RAD = Math.PI / 180;
const EPOCH_DAYS_FROM_J2000 = 2461041.5 - 2451545.0;   // table epoch 2026-01-01 00:00 UTC
const TDB_MINUS_UTC_S = 69.184;

const E = [
  [125.045, -0.0529921], [250.089, -0.1059842], [260.008, 13.0120009], [176.625, 13.3407154],
  [357.529, 0.9856003], [311.589, 26.4057084], [134.963, 13.0649930], [276.617, 0.3287146],
  [34.226, 1.7484877], [15.134, -0.1589763], [119.743, 0.0036096], [239.961, 0.1643573],
  [25.053, 12.9590088],
];
const RA_TERMS = [[1, -3.8787], [2, -0.1204], [3, 0.0700], [4, -0.0172], [6, 0.0072], [10, -0.0052], [13, 0.0043]];
const DEC_TERMS = [[1, 1.5419], [2, 0.0239], [3, -0.0278], [4, 0.0068], [6, -0.0029], [7, 0.0009], [10, 0.0008], [13, -0.0009]];
const W_TERMS = [[1, 3.5610], [2, 0.1208], [3, -0.0642], [4, 0.0158], [5, 0.0252], [6, -0.0066], [7, -0.0047],
                 [8, -0.0046], [9, 0.0028], [10, 0.0052], [11, 0.0040], [12, 0.0019], [13, -0.0044]];

const multiply = (a, b) => {
  const out = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    out[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  }
  return out;
};

// Row-major 3x3 matrix: ICRF (the frame of star catalogues) -> the Moon's
// mean Earth / polar axis frame, at `hours` since the table epoch (UTC).
export function moonMatrix(hours) {
  const d = EPOCH_DAYS_FROM_J2000 + hours / 24 + TDB_MINUS_UTC_S / 86400, t = d / 36525;
  const e = E.map(([a, b]) => (a + b * d) * RAD);
  let ra = 269.9949 + 0.0031 * t, dec = 66.5392 + 0.0130 * t, w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d;
  for (const [k, c] of RA_TERMS) ra += c * Math.sin(e[k - 1]);
  for (const [k, c] of DEC_TERMS) dec += c * Math.cos(e[k - 1]);
  for (const [k, c] of W_TERMS) w += c * Math.sin(e[k - 1]);
  const a = (ra + 90) * RAD, b = (90 - dec) * RAD, c = (((w % 360) + 360) % 360) * RAD;
  const r3a = [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const r1 = [1, 0, 0, 0, Math.cos(b), Math.sin(b), 0, -Math.sin(b), Math.cos(b)];
  const r3w = [Math.cos(c), Math.sin(c), 0, -Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return multiply(r3w, multiply(r1, r3a));
}

// ICRF -> the site's east / north / up.
export function siteMatrix(hours, latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  return multiply([-so, co, 0, -sl * co, -sl * so, cl, cl * co, cl * so, sl], moonMatrix(hours));
}

// stars.bin: "LSTR", uint32 count, then per star uint16 right ascension,
// int16 declination, uint8 magnitude. Unit vectors are worked out once.
export function parseStars(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(4, true);
  const stars = { count, x: new Float64Array(count), y: new Float64Array(count), z: new Float64Array(count),
                  ra: new Float64Array(count), dec: new Float64Array(count), mag: new Float32Array(count) };
  for (let i = 0; i < count; i++) {
    const at = 8 + 5 * i;
    const ra = view.getUint16(at, true) / 65536 * 360, dec = view.getInt16(at + 2, true) / 32767 * 90;
    stars.ra[i] = ra; stars.dec[i] = dec;
    stars.x[i] = Math.cos(dec * RAD) * Math.cos(ra * RAD);
    stars.y[i] = Math.cos(dec * RAD) * Math.sin(ra * RAD);
    stars.z[i] = Math.sin(dec * RAD);
    stars.mag[i] = view.getUint8(at + 4) / 30 - 2;
  }
  return stars;
}

// Azimuth and elevation of every star from a site. `out` is reused if given.
export function starPositions(stars, hours, latDeg, lonDeg, out) {
  const m = siteMatrix(hours, latDeg, lonDeg), n = stars.count;
  const place = out || { az: new Float32Array(n), el: new Float32Array(n), mag: stars.mag, count: n };
  for (let i = 0; i < n; i++) {
    const x = stars.x[i], y = stars.y[i], z = stars.z[i];
    const east = m[0] * x + m[1] * y + m[2] * z, north = m[3] * x + m[4] * y + m[5] * z;
    const up = m[6] * x + m[7] * y + m[8] * z;
    let az = Math.atan2(east, north) / RAD;
    if (az < 0) az += 360;
    place.az[i] = az;
    place.el[i] = Math.asin(Math.max(-1, Math.min(1, up))) / RAD;
  }
  return place;
}

// earth.bin: where on Earth the Moon is overhead, every 12 hours.
export function parseEarth(buffer) {
  const view = new DataView(buffer);
  const length = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  const table = { step: header.step_hours, count: header.count };
  let pos = 8 + length;
  for (const ch of header.channels) {
    const values = new Float64Array(header.count);
    for (let i = 0; i < header.count; i++) {
      values[i] = ch.offset + ch.rate * (i * header.step_hours) + ch.scale * view.getInt16(pos + 2 * i, true);
    }
    table[ch.name] = values;
    pos += 2 * header.count;
  }
  return table;
}

// Longitude (0..360, east) and latitude of the Earth point that faces the Moon.
export function earthFacing(table, hours) {
  let i = Math.floor(hours / table.step);
  i = Math.max(0, Math.min(table.count - 2, i));
  const f = hours / table.step - i;
  const lon = table.lon[i] + (table.lon[i + 1] - table.lon[i]) * f;
  return { lon: ((lon % 360) + 360) % 360, lat: table.lat[i] + (table.lat[i + 1] - table.lat[i]) * f };
}

// Which way Earth's north pole points on the site's sky: degrees from
// straight up, positive toward increasing azimuth (to the right).
export function earthPoleAngle(hours, latDeg, lonDeg, earthAz, earthEl) {
  const m = siteMatrix(hours, latDeg, lonDeg);
  const pole = [m[2], m[5], m[8]];                       // the ICRF pole in east, north, up
  const az = earthAz * RAD, el = earthEl * RAD;
  const right = pole[0] * Math.cos(az) - pole[1] * Math.sin(az);
  const up = -pole[0] * Math.sin(el) * Math.sin(az) - pole[1] * Math.sin(el) * Math.cos(az) + pole[2] * Math.cos(el);
  return Math.atan2(right, up) / RAD;
}

// Longitude and latitude on Earth of the point seen at (x, y) on its disc
// (x to the right, y up, disc radius 1), or null outside the disc.
export function earthPoint(x, y, facing, poleAngleDeg) {
  const rr = x * x + y * y;
  if (rr > 1) return null;
  const z = Math.sqrt(1 - rr), p = poleAngleDeg * RAD, b = facing.lat * RAD;
  const xp = x * Math.cos(p) - y * Math.sin(p), yp = x * Math.sin(p) + y * Math.cos(p);
  const lat = Math.asin(Math.max(-1, Math.min(1, yp * Math.cos(b) + z * Math.sin(b)))) / RAD;
  const lon = facing.lon + Math.atan2(xp, -yp * Math.sin(b) + z * Math.cos(b)) / RAD;
  return { lon: ((lon % 360) + 360) % 360, lat };
}

// The Sun's direction in the frame of Earth's disc: x right, y up, z toward us.
export function sunOnDisc(view) {
  const az = view.earthAz * RAD, el = view.earthEl * RAD, sa = view.sunAz * RAD, se = view.sunEl * RAD;
  const s = [Math.cos(se) * Math.sin(sa), Math.cos(se) * Math.cos(sa), Math.sin(se)];
  return [
    s[0] * Math.cos(az) - s[1] * Math.sin(az),
    -s[0] * Math.sin(el) * Math.sin(az) - s[1] * Math.sin(el) * Math.cos(az) + s[2] * Math.cos(el),
    -(s[0] * Math.cos(el) * Math.sin(az) + s[1] * Math.cos(el) * Math.cos(az) + s[2] * Math.sin(el)),
  ];
}

// Paint Earth's disc into a small canvas: the Blue Marble picture wrapped on
// a sphere, turned to the facing point and pole angle, lit from the Sun's
// side. The night side is black, as it is.
export function paintEarth(canvas, texture, size, facing, poleAngleDeg, sun) {
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size), data = image.data;
  const tw = texture.width, th = texture.height, tex = texture.data;
  let p = 0;
  for (let j = 0; j < size; j++) {
    const y = 1 - (j + 0.5) / size * 2;
    for (let i = 0; i < size; i++, p += 4) {
      const x = (i + 0.5) / size * 2 - 1;
      const edge = (1 - Math.sqrt(x * x + y * y)) * size / 2;       // pixels inside the limb
      if (edge <= -0.5) continue;
      const scale = edge < 0.5 ? 1 / Math.max(1, Math.sqrt(x * x + y * y)) : 1;
      const point = earthPoint(x * scale * 0.9999, y * scale * 0.9999, facing, poleAngleDeg);
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const mu0 = x * sun[0] + y * sun[1] + z * sun[2];
      let r = 0, g = 0, b = 0;
      if (mu0 > 0 && point) {
        const u = Math.min(tw - 1, Math.floor(((point.lon + 180) % 360) / 360 * tw));
        const v = Math.min(th - 1, Math.floor((90 - point.lat) / 180 * th));
        const k = 4 * (v * tw + u), light = 1.9 * Math.sqrt(mu0);     // brightened for the screen
        r = tex[k] * light; g = tex[k + 1] * light; b = tex[k + 2] * light;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b;
      data[p + 3] = 255 * Math.min(1, edge + 0.5);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
