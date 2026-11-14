// Where the Sun and Earth are in the sky of a site on the Moon.
// Same calculation as pipeline/sky.py (the reference); tests compare the two.
//
// Frame MOON_ME, east-positive longitude, sphere R = 1737.4 km, no refraction.
// Azimuth clockwise from north (N 0, E 90). All angles in degrees.
// Source of the table: NASA/JPL Horizons (see data/sky.bin header).

const RAD = Math.PI / 180;

// Read data/sky.bin (an ArrayBuffer).
// Layout: "LSKY", uint32 header length, JSON header, then int16 values,
// one block per channel. value = offset + rate * hours + scale * int16.
export function parseSky(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "LSKY") throw new Error("not a sky table");
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  const table = {
    header,
    epochMs: Date.parse(header.epoch),
    stepHours: header.step_hours,
    count: header.count,
    lastHour: (header.count - 1) * header.step_hours,
    channels: {},
  };
  let pos = 8 + headerLength;
  for (const ch of header.channels) {
    const values = new Float64Array(header.count);
    for (let i = 0; i < header.count; i++) {
      values[i] = ch.offset + ch.rate * (i * header.step_hours) + ch.scale * view.getInt16(pos + 2 * i, true);
    }
    table.channels[ch.name] = values;
    pos += 2 * header.count;
  }
  return table;
}

// Hours since the table epoch for a JavaScript time in milliseconds (UT).
export function hoursSinceEpoch(table, timeMs) {
  return (timeMs - table.epochMs) / 3600000;
}

// Straight-line interpolation of every channel at the given hour.
function valuesAt(table, hours) {
  if (!(hours >= 0 && hours <= table.lastHour)) throw new RangeError("time outside the table");
  let i = Math.floor(hours / table.stepHours);
  if (i > table.count - 2) i = table.count - 2;
  const f = hours / table.stepHours - i;
  const out = {};
  for (const name in table.channels) {
    const v = table.channels[name];
    out[name] = v[i] + (v[i + 1] - v[i]) * f;
  }
  return out;
}

// Unit vectors at a site: position p, local north n, local east e.
function localFrame(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  return {
    p: [cl * co, cl * so, sl],
    n: [-sl * co, -sl * so, cl],
    e: [-so, co, 0],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// One body from its sub-point on the Moon and its centre distance.
// v = D s - ro p is the vector from the site to the body (this is the parallax).
function direction(frame, roKm, subLatDeg, subLonDeg, distKm, bodyRadiusKm) {
  const la = subLatDeg * RAD, lo = subLonDeg * RAD;
  const s = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const v = [distKm * s[0] - roKm * frame.p[0], distKm * s[1] - roKm * frame.p[1], distKm * s[2] - roKm * frame.p[2]];
  const up = dot(v, frame.p), north = dot(v, frame.n), east = dot(v, frame.e);
  const range = Math.sqrt(up * up + north * north + east * east);
  let az = Math.atan2(east, north) / RAD;
  if (az < 0) az += 360;
  return {
    az,
    el: Math.atan2(up, Math.hypot(north, east)) / RAD,
    diameter: 2 * Math.asin(bodyRadiusKm / range) / RAD,
  };
}

// Sun and Earth seen from a site at `hours` since the table epoch.
// heightM is the height of the observer above the 1737.4 km sphere.
export function skyAt(table, hours, latDeg, lonDeg, heightM = 0) {
  const h = table.header;
  const v = valuesAt(table, hours);
  const frame = localFrame(latDeg, lonDeg);
  const ro = h.moon_radius_km + heightM / 1000;
  return {
    sun: direction(frame, ro, v.sun_lat, v.sun_lon, v.sun_km, h.sun_radius_km),
    earth: direction(frame, ro, v.earth_lat, v.earth_lon, v.earth_km, h.earth_radius_km),
  };
}
