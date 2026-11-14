// The flight plan: time runs down the page, one row per hour, the way an
// Apollo flight plan reads. Two plans side by side; for each a power band
// (width = share of the Sun's disc in view) and an Earth band (link or none).

import { formatMet } from "./plan.js";

export const PX_PER_HOUR = 6;
export const TRACK_TOP = 8;          // the hour-zero line sits this far below the top of the drawing
const POWER = "#F5D68A", LINK = "#6AA9FF", LINE = "#2E2E2E", TEXT = "#E6E6E6", DIM = "#9A9A9A";
// x positions for a strip of the given width: time labels first, then for
// each plan a power band, an Earth band and room for words
function columns(width) {
  const time = 86, group = (width - time) / 2;
  const power = Math.min(64, Math.round(group * 0.3)), link = Math.max(8, Math.round(power * 0.22));
  return [0, 1].map((i) => {
    const x = Math.round(time + i * group);
    return { power: x, powerWidth: power, link: x + power + 6, linkWidth: link, words: x + power + link + 12 };
  });
}
// The strip is as wide as its column allows, within these limits.
export function stripWidth(available) {
  return Math.max(328, Math.min(600, Math.floor(available)));
}
const NS = "http://www.w3.org/2000/svg";

function el(name, attrs, text) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Column headings, drawn with the same x positions as the bands.
export function drawHead(svg, WIDTH) {
  const COLS = columns(WIDTH);
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} 58`);
  svg.setAttribute("width", WIDTH);
  svg.setAttribute("height", 58);
  const small = { "font-size": 12, fill: DIM };
  svg.append(
    el("text", { x: 0, y: 14, fill: TEXT, "font-size": 13 }, "MET"),
    el("text", { x: 0, y: 30, ...small }, "(hours since"),
    el("text", { x: 0, y: 44, ...small }, "landing)"));
  ["A", "B"].forEach((name, i) => {
    const c = COLS[i];
    svg.append(
      el("text", { x: c.power, y: 14, fill: TEXT, "font-size": 15, "font-weight": 500 }, "Plan " + name),
      el("text", { x: c.power, y: 44, ...small }, "power"),
      el("text", { x: c.link, y: 44, ...small }, "Earth"));
  });
}

function band(svg, x, width, height) {
  svg.append(el("rect", { x: x - 0.5, y: 0, width: width + 1, height, fill: "none", stroke: LINE }));
}

// The long strip itself. runs = [runA, runB] from runPlan().
export function drawTrack(svg, runs, WIDTH) {
  const COLS = columns(WIDTH);
  const n = runs[0].n, height = n * PX_PER_HOUR;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 ${-TRACK_TOP} ${WIDTH} ${height + 34}`);
  svg.setAttribute("width", WIDTH);
  svg.setAttribute("height", height + 34);

  for (let t = 0; t <= n; t += 12) {
    const y = t * PX_PER_HOUR;
    if (t % 24 === 0) svg.append(el("line", { x1: 0, x2: WIDTH, y1: y, y2: y, stroke: LINE }));
    svg.append(el("text", { x: 0, y: y + (t % 24 === 0 ? 14 : 4), fill: t % 24 === 0 ? TEXT : DIM, "font-size": 13 },
      formatMet(t)));
  }
  svg.append(el("text", { x: 0, y: height + 30, fill: DIM, "font-size": 12 }, "end of stay"));

  runs.forEach((run, i) => {
    const c = COLS[i];
    // power: one step per hour, width = share of the Sun's disc in view
    let d = `M${c.power} 0`;
    for (let t = 0; t < n; t++) {
      d += `H${(c.power + c.powerWidth * run.fraction[t]).toFixed(2)}V${(t + 1) * PX_PER_HOUR}`;
    }
    svg.append(el("path", { d: d + `H${c.power}Z`, fill: POWER }));
    band(svg, c.power, c.powerWidth, height);

    // Earth: filled while the link is up
    let start = -1;
    for (let t = 0; t <= n; t++) {
      const on = t < n && run.link[t];
      if (on && start < 0) start = t;
      if (!on && start >= 0) {
        svg.append(el("rect", { x: c.link, y: start * PX_PER_HOUR, width: c.linkWidth,
                               height: (t - start) * PX_PER_HOUR, fill: LINK }));
        start = -1;
      }
    }
    band(svg, c.link, c.linkWidth, height);

    // words beside the bands: how long each gap lasts, and what happens when
    const taken = [];
    const free = (y) => taken.every((other) => Math.abs(other - y) >= 14);
    const words = (x, y, text, anchor) => {
      if (!free(y)) return;
      taken.push(y);
      svg.append(el("text", { x, y: y + 4, fill: DIM, "font-size": 12, "text-anchor": anchor }, text));
    };
    for (const gap of run.sunGaps) {
      if (gap.hours < 3) continue;
      svg.append(el("text", { x: c.power + c.powerWidth / 2, y: (gap.start + gap.hours / 2) * PX_PER_HOUR + 4,
                             fill: DIM, "font-size": 12, "text-anchor": "middle" }, gap.hours + " h"));
    }
    const longest = run.linkGaps.reduce((best, gap) => (gap.hours > (best ? best.hours : 0) ? gap : best), null);
    for (const gap of run.linkGaps) {
      if (gap.hours >= 6 || gap === longest) {
        words(c.words, (gap.start + gap.hours / 2) * PX_PER_HOUR, gap.hours + " h", "start");
      }
    }
    for (const event of run.events) words(c.words, event.hour * PX_PER_HOUR, event.text, "start");
  });
}

// The whole stay in one thin strip: time runs left to right. For each plan a
// power row (height = share of the Sun's disc in view) and an Earth row.
// Returns where the hours sit, so a pointer position can be turned into a time.
const OV_LABEL = 16;
export function overviewScale(width, n) {
  const band = Math.max(1, width - OV_LABEL);
  return { left: OV_LABEL, band, x: (hours) => OV_LABEL + (hours / n) * band,
           hours: (x) => Math.round(Math.min(n, Math.max(0, ((x - OV_LABEL) / band) * n))) };
}
export function drawOverview(canvas, runs) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const n = runs[0].n, scale = overviewScale(width, n);
  const row = Math.floor((height - 4) / 2), link = Math.max(3, Math.round(row * 0.22)), power = row - link - 3;
  ctx.font = "500 12px Jost, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  runs.forEach((run, i) => {
    const top = i * (row + 4);
    ctx.fillStyle = TEXT;
    ctx.fillText(i ? "B" : "A", 0, top + row / 2);
    ctx.fillStyle = POWER;
    ctx.beginPath();
    ctx.moveTo(scale.x(0), top + power);
    for (let t = 0; t < n; t++) {
      const y = top + power * (1 - run.fraction[t]);
      ctx.lineTo(scale.x(t), y);
      ctx.lineTo(scale.x(t + 1), y);
    }
    ctx.lineTo(scale.x(n), top + power);
    ctx.fill();
    ctx.fillStyle = LINK;
    for (let t = 0, start = -1; t <= n; t++) {
      const on = t < n && run.link[t];
      if (on && start < 0) start = t;
      if (!on && start >= 0) { ctx.fillRect(scale.x(start), top + power + 2, scale.x(t) - scale.x(start), link); start = -1; }
    }
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(scale.left - 0.5, top + 0.5, scale.band, power);
    ctx.strokeRect(scale.left - 0.5, top + power + 1.5, scale.band, link + 1);
  });
  // a thin break at every day
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  for (let t = 24; t < n; t += 24) ctx.fillRect(Math.round(scale.x(t)), 0, 1, 2 * row + 4);
  return scale;
}
