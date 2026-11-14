// The flight plan: time runs down the page, one row per hour, the way an
// Apollo flight plan reads. Two plans side by side; for each a power band
// (width = share of the Sun's disc in view) and an Earth band (link or none).

import { formatMet } from "./plan.js";

export const PX_PER_HOUR = 6;
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
  svg.setAttribute("viewBox", `0 -8 ${WIDTH} ${height + 34}`);
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
