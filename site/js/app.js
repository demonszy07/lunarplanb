// First page: the raw numbers of plan A in a plain table.
// The page opens first; the sky table and the site file load after it.

import { parseSky, hoursSinceEpoch } from "./sky.js";
import { metrics } from "./visibility.js";

const planA = { site: "site01", landing: "2027-03-01T00:00:00Z", days: 10 };
const STEP_HOURS = 1;

const status = document.getElementById("status");
const main = document.getElementById("plan");

async function load(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " answered " + response.status);
  return kind === "json" ? response.json() : response.arrayBuffer();
}

function hours(value) {
  return value === null ? "not in this stay" : value + " h";
}

function row(table, group, label, text, key, value) {
  const tr = table.insertRow();
  if (group) tr.className = group;
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = label;
  tr.append(th);
  const td = tr.insertCell();
  td.textContent = text;
  td.dataset.key = key;                 // exact value, for checking against the Python reference
  td.dataset.value = JSON.stringify(value);
}

function show(plan, site, m) {
  const total = m.samples * STEP_HOURS;
  const landing = plan.landing.replace("T", " ").replace(":00Z", " UTC");

  const sentence = document.createElement("p");
  sentence.textContent = `Plan A: land at ${site.name} on ${landing} and stay ${plan.days} days (${total} hours).`;

  const table = document.createElement("table");
  const caption = table.createCaption();
  caption.textContent = "What the terrain allows during the stay";
  row(table, "sun", "Sun in view, any part of it", hours(m.sunlitHours), "sunlit_hours", m.sunlitHours);
  row(table, "sun", "Average share of the Sun's disc in view (power proxy)",
      (100 * m.meanSunFraction).toFixed(1) + " %", "mean_sun_fraction", m.meanSunFraction);
  row(table, "sun", "Longest time with no Sun", hours(m.longestDarkHours), "longest_dark_hours", m.longestDarkHours);
  row(table, "sun", "Time from landing to the first sunset", hours(m.hoursToFirstSunset),
      "hours_to_first_sunset", m.hoursToFirstSunset);
  row(table, "earth", "Earth in view, its centre above the terrain (direct link)", hours(m.earthHours),
      "earth_hours", m.earthHours);
  row(table, "earth", "Longest time without Earth", hours(m.longestOutageHours),
      "longest_outage_hours", m.longestOutageHours);
  row(table, "earth", "Time from landing to the first loss of Earth", hours(m.hoursToFirstEarthset),
      "hours_to_first_earthset", m.hoursToFirstEarthset);
  row(table, "", "Sun and Earth in view together", hours(m.bothHours), "both_hours", m.bothHours);

  const note = document.createElement("p");
  note.className = "dim";
  const small = document.createElement("small");
  const lat = Math.abs(site.lat).toFixed(4) + (site.lat < 0 ? " S" : " N");
  small.textContent =
    `${site.name}: ${lat}, ${site.lon.toFixed(4)} E, ground ${Math.round(site.site_height_m)} m above the ` +
    `1737.4 km sphere, observer ${site.observer_height_m} m above the ground. One sample every ` +
    `${STEP_HOURS} hour, so times are good to ${STEP_HOURS} hour. Terrain: LOLA elevation models, ` +
    `NASA GSFC PGDA. Sun and Earth positions: NASA/JPL Horizons. `;
  const link = document.createElement("a");
  link.href = "https://github.com/demonszy07/lunarplanb#readme";
  link.textContent = "Method, sources and limits";
  small.append(link, ".");
  note.append(small);

  main.replaceChildren(sentence, table, note);
}

async function start() {
  try {
    const [skyBuffer, site] = await Promise.all([
      load("data/sky.bin", "binary"),
      load(`data/sites/${planA.site}.json`, "json"),
    ]);
    const sky = parseSky(skyBuffer);
    const startHours = hoursSinceEpoch(sky, Date.parse(planA.landing));
    const m = metrics(sky, site, startHours, planA.days * 24, STEP_HOURS);
    show(planA, site, m);
    status.hidden = true;
    document.documentElement.dataset.ready = "yes";
  } catch (error) {
    status.textContent = "Could not load sky data. " + error.message;
  }
}

start();
