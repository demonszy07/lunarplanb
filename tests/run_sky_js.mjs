// Runs site/js/sky.js on test cases given on stdin and prints the results.
// Used by tests/test_sky.py to compare the browser code with the Python reference.
// stdin:  {"bin": "path/to/sky.bin", "cases": [[hours, lat, lon, heightM], ...]}
// stdout: [[sunAz, sunEl, sunDiameter, earthAz, earthEl, earthDiameter], ...]
import { readFileSync } from "node:fs";
import { parseSky, skyAt } from "../site/js/sky.js";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = readFileSync(input.bin);
const table = parseSky(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const out = input.cases.map(([hours, lat, lon, height]) => {
  const r = skyAt(table, hours, lat, lon, height);
  return [r.sun.az, r.sun.el, r.sun.diameter, r.earth.az, r.earth.el, r.earth.diameter];
});
process.stdout.write(JSON.stringify(out));
