// The terrain of the 3D view, from a [site]_3d.bin file (written by
// pipeline/build_3d.py, the reference): three square height grids, one inside
// the other, turned into positions and normals. No drawing here, so the same
// code runs in the tests.
//
// Scene axes: x east, y up, z south (so north is -z). The origin is the
// ground at the site. Lengths in metres.

export const R_M = 1737400;

// Where each grid is drawn and how it meets the coarser one around it.
//   half:  the mesh of this grid reaches this far from the site (m)
//   blend: over this width inside that edge its heights lean toward the
//          coarser grid, so the two meet without a step
//   hole:  the part left out because the next finer grid is drawn there
// The edges sit on grid lines of both grids (1920 = 12 x 160 = 96 x 20,
// 240 = 12 x 20 = 48 x 5), so no gaps open between them.
export const DRAW = {
  wide: { half: 20000, blend: 0, hole: 1920 },
  middle: { half: 1920, blend: 320, hole: 240 },
  near: { half: 240, blend: 40, hole: 0 },
};

export function parseTerrain(buffer) {
  const bytes = new DataView(buffer);
  const magic = String.fromCharCode(bytes.getUint8(0), bytes.getUint8(1), bytes.getUint8(2), bytes.getUint8(3));
  if (magic !== "L3DT") throw new Error("not a 3D terrain file");
  const length = bytes.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  let pos = 8 + length;
  const levels = {};
  for (const level of header.levels) {
    const n = level.size, heights = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) heights[k] = level.offset + level.scale * bytes.getInt16(pos + 2 * k, true);
    pos += 2 * n * n;
    levels[level.name] = { name: level.name, n, step: level.step_m, heights };
  }
  const far = {};
  for (const entry of header.far_horizon) {
    const profile = new Float32Array(entry.count);
    for (let k = 0; k < entry.count; k++) profile[k] = entry.scale_deg * bytes.getInt16(pos + 2 * k, true);
    pos += 2 * entry.count;
    far[entry.observer_height_m] = profile;
  }
  return { header, levels, far, siteHeight: levels.near.heights[(levels.near.n * levels.near.n - 1) / 2] };
}

// A grid point x m east and y m north of the site, at height h above the
// sphere, in the site's east / north / up frame (origin: ground at the site,
// height h0). The Moon's curvature comes in here: level ground 20 km away is
// 115 m below the site's horizontal. Same as local_position in build_3d.py.
export function localPosition(x, y, h, h0) {
  const d = Math.hypot(x, y), angle = d / R_M, rt = R_M + h;
  const reach = d > 0 ? rt * Math.sin(angle) / d : rt / R_M;
  return [x * reach, y * reach, rt * Math.cos(angle) - (R_M + h0)];
}

// Height of a grid at any point inside it, straight lines between neighbours.
export function heightAt(level, heights, x, y) {
  const n = level.n, c = (n - 1) / 2;
  const fx = Math.min(n - 1, Math.max(0, x / level.step + c)), fy = Math.min(n - 1, Math.max(0, y / level.step + c));
  const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fy)), tx = fx - i, ty = fy - j;
  const k = j * n + i;
  return (1 - ty) * ((1 - tx) * heights[k] + tx * heights[k + 1]) + ty * ((1 - tx) * heights[k + n] + tx * heights[k + n + 1]);
}

// Heights of a grid after leaning toward the coarser grid near its edge.
// `outer` is { level, heights } of the coarser grid (already blended), or null.
export function blendedHeights(level, draw, outer) {
  if (!outer || !draw.blend) return level.heights;
  const n = level.n, c = (n - 1) / 2, out = new Float32Array(n * n);
  const start = draw.half - draw.blend;
  for (let j = 0; j < n; j++) {
    const y = (j - c) * level.step;
    for (let i = 0; i < n; i++) {
      const x = (i - c) * level.step, k = j * n + i;
      const t = Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(y)) - start) / draw.blend));
      const w = t * t * (3 - 2 * t);
      out[k] = w === 0 ? level.heights[k] : (1 - w) * level.heights[k] + w * heightAt(outer.level, outer.heights, x, y);
    }
  }
  return out;
}

// Positions, normals and triangles of one grid. Normals come from the
// positions themselves (differences to the neighbours on both sides), so the
// curvature is in them too.
export function buildLevel(level, heights, draw, siteHeight) {
  const n = level.n, c = (n - 1) / 2;
  const enu = new Float64Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, p = localPosition((i - c) * level.step, (j - c) * level.step, heights[k], siteHeight);
      enu[3 * k] = p[0]; enu[3 * k + 1] = p[1]; enu[3 * k + 2] = p[2];
    }
  }
  const position = new Float32Array(n * n * 3), normal = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), k = 3 * (j * n + i);
      const a = 3 * (j * n + i0), b = 3 * (j * n + i1), s = 3 * (j0 * n + i), t = 3 * (j1 * n + i);
      const ex = enu[b] - enu[a], ey = enu[b + 1] - enu[a + 1], ez = enu[b + 2] - enu[a + 2];        // toward east
      const nx = enu[t] - enu[s], ny = enu[t + 1] - enu[s + 1], nz = enu[t + 2] - enu[s + 2];        // toward north
      let ux = ey * nz - ez * ny, uy = ez * nx - ex * nz, uz = ex * ny - ey * nx;                    // east x north = up
      const len = Math.hypot(ux, uy, uz);
      ux /= len; uy /= len; uz /= len;
      position[k] = enu[k]; position[k + 1] = enu[k + 2]; position[k + 2] = -enu[k + 1];
      normal[k] = ux; normal[k + 1] = uz; normal[k + 2] = -uy;
    }
  }
  // triangles: every cell inside the drawn square and not inside the hole
  const first = Math.round(c - draw.half / level.step), last = Math.round(c + draw.half / level.step);
  const holeFirst = Math.round(c - draw.hole / level.step), holeLast = Math.round(c + draw.hole / level.step);
  const index = [];
  for (let j = first; j < last; j++) {
    for (let i = first; i < last; i++) {
      if (draw.hole && i >= holeFirst && i < holeLast && j >= holeFirst && j < holeLast) continue;
      const k = j * n + i;
      index.push(k, k + 1, k + n + 1, k, k + n + 1, k + n);      // counter-clockwise seen from above
    }
  }
  return { position, normal, index: new Uint32Array(index), enu };
}

// All three grids, finest last.
export function buildTerrain(terrain) {
  const { wide, middle, near } = terrain.levels;
  const hWide = blendedHeights(wide, DRAW.wide, null);
  const hMiddle = blendedHeights(middle, DRAW.middle, { level: wide, heights: hWide });
  const hNear = blendedHeights(near, DRAW.near, { level: middle, heights: hMiddle });
  return [[wide, hWide, DRAW.wide], [middle, hMiddle, DRAW.middle], [near, hNear, DRAW.near]]
    .map(([level, heights, draw]) => ({ name: level.name, heights, ...buildLevel(level, heights, draw, terrain.siteHeight) }));
}
