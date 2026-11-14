// Recomputes every row of tests/vectors.json with site/js/visibility.js and
// prints the results in the same shape. Used by tests/test_visibility.py.
import { readFileSync } from "node:fs";
import { parseSky } from "../site/js/sky.js";
import { viewAt, metrics } from "../site/js/visibility.js";

const root = new URL("..", import.meta.url).pathname;
const file = readFileSync(root + "site/data/sky.bin");
const table = parseSky(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const rows = JSON.parse(readFileSync(root + "tests/vectors.json", "utf8"));
const sites = {};
const site = (id) => (sites[id] ??= JSON.parse(readFileSync(root + "data/sites/" + id + ".json", "utf8")));

const out = rows.map((r) => {
  if (r.kind === "view") {
    const v = viewAt(table, site(r.site), r.hours);
    return {
      kind: "view", site: r.site, hours: r.hours,
      sun_az: v.sunAz, sun_el: v.sunEl, sun_fraction: v.sunFraction,
      earth_az: v.earthAz, earth_el: v.earthEl, earth_fraction: v.earthFraction,
      earth_state: v.earthState, earth_link: v.earthLink,
    };
  }
  const m = metrics(table, site(r.site), r.start_hours, r.duration_hours, r.step_hours);
  return {
    kind: "metrics", site: r.site, start_hours: r.start_hours,
    duration_hours: r.duration_hours, step_hours: r.step_hours,
    samples: m.samples, sunlit_hours: m.sunlitHours, mean_sun_fraction: m.meanSunFraction,
    longest_dark_hours: m.longestDarkHours, earth_hours: m.earthHours,
    longest_outage_hours: m.longestOutageHours, both_hours: m.bothHours,
    hours_to_first_sunset: m.hoursToFirstSunset, hours_to_first_earthset: m.hoursToFirstEarthset,
  };
});
process.stdout.write(JSON.stringify(out));
