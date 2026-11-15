// Builds the 3D mesh of a terrain file with web3d/terrain.js and prints what
// tests/test_view3d.py compares with the Python reference (pipeline/build_3d.py).
// usage: node tests/run_3d_js.mjs data/sites/site01_3d.bin
import { readFileSync } from "node:fs";
import { parseTerrain, buildTerrain, localPosition, heightAt, DRAW } from "../web3d/terrain.js";

const file = readFileSync(process.argv[2]);
const terrain = parseTerrain(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const levels = buildTerrain(terrain);
const out = { siteHeight: terrain.siteHeight, drop20km: localPosition(20000, 0, 0, 0)[2], levels: {}, seams: {}, far: {} };

for (const level of levels) {
  const grid = terrain.levels[level.name], n = grid.n, c = (n - 1) / 2, draw = DRAW[level.name];
  // every 7th point of the raw grid: position (east, north, up) from the stored heights
  const sample = [];
  for (let j = 0; j < n; j += 7) for (let i = 0; i < n; i += 7) {
    sample.push(localPosition((i - c) * grid.step, (j - c) * grid.step, grid.heights[j * n + i], terrain.siteHeight));
  }
  // largest change the blending made, inside and outside the blended band
  let inner = 0, lengthError = 0, minUp = 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, r = Math.max(Math.abs(i - c), Math.abs(j - c)) * grid.step;
    if (r <= draw.half - draw.blend) inner = Math.max(inner, Math.abs(level.heights[k] - grid.heights[k]));
    const nx = level.normal[3 * k], ny = level.normal[3 * k + 1], nz = level.normal[3 * k + 2];
    lengthError = Math.max(lengthError, Math.abs(Math.hypot(nx, ny, nz) - 1));
    minUp = Math.min(minUp, ny);
  }
  out.levels[level.name] = { n, sample, changedInside: inner, normalLengthError: lengthError, lowestNormalUp: minUp,
                             triangles: level.index.length / 3, centreNormal: Array.from(level.normal.slice(3 * (c * n + c), 3 * (c * n + c) + 3)) };
}
// seams: along the edge of each finer mesh, its heights against the coarser surface at the same place
const byName = Object.fromEntries(levels.map((level) => [level.name, level]));
for (const [fine, coarse] of [["middle", "wide"], ["near", "middle"]]) {
  const grid = terrain.levels[fine], n = grid.n, c = (n - 1) / 2, edge = Math.round(DRAW[fine].half / grid.step);
  let gap = 0;
  for (let t = -edge; t <= edge; t++) {
    for (const [i, j] of [[c + t, c - edge], [c + t, c + edge], [c - edge, c + t], [c + edge, c + t]]) {
      const x = (i - c) * grid.step, y = (j - c) * grid.step;
      gap = Math.max(gap, Math.abs(byName[fine].heights[j * n + i] - heightAt(terrain.levels[coarse], byName[coarse].heights, x, y)));
    }
  }
  out.seams[fine + " meets " + coarse] = gap;
}
for (const height in terrain.far) out.far[height] = Array.from(terrain.far[height].slice(0, 720));
process.stdout.write(JSON.stringify(out));
