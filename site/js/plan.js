// A landing plan and what follows from it: hour-by-hour Sun and Earth,
// gaps, events, countdowns and the one-sentence verdict. No drawing here.

import { viewAt, metrics } from "./visibility.js";
import { hoursSinceEpoch } from "./sky.js";

export const SITES = [
  ["site01", "Site 1, connecting ridge"],
  ["site04", "Site 4, Shackleton rim"],
  ["site07", "Site 7, peak near Shackleton"],
  ["site11", "Site 11, de Gerlache rim"],
  ["malapert", "Malapert massif"],
  ["mouton", "Mons Mouton plateau"],
  ["haworth", "Haworth"],
];

// Plan B is plan A with one thing changed.
export const B_CHOICES = [
  ["day", "one day later", 24],
  ["week", "one week later", 168],
  ["lunarday", "29.5 days later", 708],
  ["site", "at another site", 0],
];

export function planB(planA, choice, otherSite) {
  const shift = B_CHOICES.find((c) => c[0] === choice)[2];
  return {
    site: choice === "site" ? otherSite : planA.site,
    landingMs: planA.landingMs + shift * 3600000,
    days: planA.days,
    height: planA.height,
  };
}

// File name of the horizon for a site and panel height.
export function siteFile(plan) {
  return plan.site + (plan.height === 5 ? "_5m" : "") + ".json";
}

// "MET 096:00": mission elapsed time, whole hours since landing.
export function formatMet(hours) {
  return "MET " + String(Math.round(hours)).padStart(3, "0") + ":00";
}

export function formatUtc(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

// Read a time typed as "2027-03-01 00:00" (UTC, 24-hour clock). The marks
// between the numbers may be anything or missing ("202703010000"), and the
// time of day may be left out. Returns milliseconds, or NaN if it is not a date.
export function parseUtc(text) {
  let parts = String(text).match(/\d+/g) || [];
  if (parts.length === 1 && /^\d{8}(\d{2}){0,2}$/.test(parts[0])) {
    const d = parts[0];
    parts = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
  }
  if (parts.length < 3 || parts.length > 5 || parts[0].length !== 4 || /[a-z]/i.test(String(text).replace(/utc|t/gi, ""))) return NaN;
  const [year, month, day, hour = 0, minute = 0] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return NaN;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(ms).getUTCDate() === day ? ms : NaN;          // 31 February is not a date
}

// Unbroken runs where flags[i] is false, over samples 0..n-1.
export function gaps(flags, n) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const off = i < n && !flags[i];
    if (off && start < 0) start = i;
    if (!off && start >= 0) { out.push({ start, hours: i - start }); start = -1; }
  }
  return out;
}

// Hours at which a flag changes: [{hour, on}] where on is the new state.
export function changes(flags, n) {
  const out = [];
  for (let i = 1; i < n; i++) {
    if (!!flags[i] !== !!flags[i - 1]) out.push({ hour: i, on: !!flags[i] });
  }
  return out;
}

// From hour t: how long until the flag changes, or null if it does not
// change before the end of the stay.
export function untilChange(flags, n, t) {
  const now = !!flags[Math.min(t, n - 1)];
  for (let i = t + 1; i < n; i++) if (!!flags[i] !== now) return { now, hours: i - t };
  return { now, hours: null };
}

export function countdownText(run, t) {
  const sun = untilChange(run.sunUp, run.n, t);
  const earth = untilChange(run.link, run.n, t);
  return {
    sun: sun.hours !== null ? (sun.now ? "Sunset in " : "Sunrise in ") + sun.hours + " h"
      : sun.now ? "Sun stays up" : "Sun stays down",
    earth: earth.hours !== null ? (earth.now ? "Earthset in " : "Earthrise in ") + earth.hours + " h"
      : earth.now ? "Earth stays in view" : "Earth stays hidden",
  };
}

// Everything about one plan, one sample per hour (n + 1 samples, the last
// one is the end of the stay and is used only for drawing).
export function runPlan(table, site, plan) {
  const start = hoursSinceEpoch(table, plan.landingMs);
  const n = Math.round(plan.days * 24);
  if (!(start >= 0) || start + n > table.lastHour) throw new RangeError("outside the sky table");
  const views = new Array(n + 1);
  const sunUp = new Uint8Array(n + 1), link = new Uint8Array(n + 1);
  const fraction = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const v = viewAt(table, site, start + i);
    views[i] = v;
    fraction[i] = v.sunFraction;
    sunUp[i] = v.sunFraction > 0 ? 1 : 0;
    link[i] = v.earthLink ? 1 : 0;
  }
  const run = { plan, site, start, n, views, fraction, sunUp, link };
  run.metrics = metrics(table, site, start, n, 1);
  run.sunGaps = gaps(sunUp, n);
  run.linkGaps = gaps(link, n);
  run.events = [
    ...changes(sunUp, n).map((c) => ({ hour: c.hour, text: c.on ? "Sunrise" : "Sunset" })),
    ...changes(link, n).map((c) => ({ hour: c.hour, text: c.on ? "Earthrise" : "Earthset" })),
  ].sort((a, b) => a.hour - b.hour);
  return run;
}

// One plain sentence from the numbers. Sunlight is the average share of the
// Sun's disc in view; Earth contact is hours with Earth's centre in view.
// Differences under 2 points of sunlight or 2 % of the stay count as "the same".
export function verdict(a, b, hours) {
  const pa = 100 * a.meanSunFraction, pb = 100 * b.meanSunFraction;
  const dp = pb - pa, dl = b.earthHours - a.earthHours;
  const powerSame = Math.abs(dp) < 2, linkSame = Math.abs(dl) < 0.02 * hours;
  const pct = (x) => x.toFixed(0) + " %";
  const more = (x) => Math.abs(Math.round(x));
  if (powerSame && linkSame) {
    return `The two plans are nearly the same: about ${pct(pa)} sunlight and ${a.earthHours} hours of Earth contact.`;
  }
  if (powerSame) {
    return `Sunlight is about the same; plan ${dl > 0 ? "B" : "A"} has ${more(dl)} more hours of Earth contact.`;
  }
  if (linkSame) {
    return `Earth contact is about the same; plan ${dp > 0 ? "B" : "A"} gets more sunlight (${pct(Math.max(pa, pb))} against ${pct(Math.min(pa, pb))}).`;
  }
  if ((dp > 0) === (dl > 0)) {
    return `Plan ${dp > 0 ? "B" : "A"} is better on both counts: ${more(dp)} points more sunlight and ${more(dl)} more hours of Earth contact.`;
  }
  const sunny = dp > 0 ? "B" : "A", linked = dl > 0 ? "B" : "A";
  return `A trade-off: plan ${sunny} gets more sunlight (${pct(Math.max(pa, pb))} against ${pct(Math.min(pa, pb))}), ` +
    `plan ${linked} more Earth contact (${Math.max(a.earthHours, b.earthHours)} h against ${Math.min(a.earthHours, b.earthHours)} h).`;
}
