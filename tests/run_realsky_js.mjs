// Runs site/js/realsky.js on cases given on stdin; tests/test_realsky.py
// compares the answers with pipeline/realsky.py.
import { readFileSync } from "node:fs";
import { parseStars, starPositions, parseEarth, earthFacing, earthPoleAngle, earthPoint, sunOnDisc, moonMatrix } from "../site/js/realsky.js";

const input = JSON.parse(readFileSync(0, "utf8"));
const buffer = (path) => { const f = readFileSync(path); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength); };
const stars = parseStars(buffer(input.stars));
const earth = parseEarth(buffer(input.earth));
process.stdout.write(JSON.stringify({
  count: stars.count,
  matrix: input.matrix.map((h) => moonMatrix(h)),
  stars: input.sky.map(([hours, lat, lon, index]) => {
    const p = starPositions(stars, hours, lat, lon);
    return index.map((i) => [p.az[i], p.el[i], p.mag[i]]);
  }),
  facing: input.facing.map((h) => { const f = earthFacing(earth, h); return [f.lon, f.lat]; }),
  pole: input.pole.map((c) => earthPoleAngle(...c)),
  point: input.point.map(([x, y, lon, lat, angle]) => { const p = earthPoint(x, y, { lon, lat }, angle); return [p.lon, p.lat]; }),
  sun: input.sun.map(([sunAz, sunEl, earthAz, earthEl]) => sunOnDisc({ sunAz, sunEl, earthAz, earthEl })),
}));
