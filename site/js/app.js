// The screen: a photograph-like view from the site that stays in place, and
// a flight plan beside it. Scrolling the flight plan is moving through time.
// The page opens first; the sky table and site files load after it.

import { parseSky } from "./sky.js";
import { SITES, B_CHOICES, planB, siteFile, runPlan, verdict, countdownText, formatMet, formatUtc } from "./plan.js";
import { drawScene, offFrameNote, parseView, lighting } from "./scene.js";
import { drawHead, drawTrack, PX_PER_HOUR } from "./flightplan.js";

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia("(max-width: 899px)");

const state = { sky: null, sites: new Map(), grounds: new Map(), runs: null, met: 0, drawn: "" };

// ---- the two sentences -----------------------------------------------------

function fillSelect(select, pairs, value) {
  select.replaceChildren(...pairs.map(([v, label]) => new Option(label, v)));
  select.value = value;
}
// A select is as wide as its longest option; make it as wide as the chosen
// words so it sits in the sentence like any other word.
const ruler = document.createElement("canvas").getContext("2d");
function fitSelect(select) {
  const style = getComputedStyle(select);
  ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const label = select.selectedOptions[0] ? select.selectedOptions[0].text : "";
  select.style.width = Math.ceil(ruler.measureText(label).width) + 2 + "px";
}
function fitSelects() { document.querySelectorAll("select").forEach(fitSelect); }

fillSelect($("a-site"), SITES, "site01");
fillSelect($("b-choice"), B_CHOICES, "week");
fillSelect($("b-site"), SITES, "malapert");

function readPlans() {
  const days = Math.min(60, Math.max(1, Math.round(Number($("a-days").value) || 1)));
  const a = {
    site: $("a-site").value,
    landingMs: Date.parse($("a-date").value + ":00Z"),
    days,
    height: Number($("a-height").value),
  };
  $("b-site-wrap").hidden = $("b-choice").value !== "site";
  fitSelects();
  return [a, planB(a, $("b-choice").value, $("b-site").value)];
}

// ---- loading ---------------------------------------------------------------

async function load(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " answered " + response.status);
  return kind === "json" ? response.json() : response.arrayBuffer();
}

// One download per file, also when plans A and B ask for the same one at once.
function site(plan) {
  const name = siteFile(plan);
  if (!state.sites.has(name)) {
    const pending = load("data/sites/" + name, "json");
    pending.catch(() => state.sites.delete(name));
    state.sites.set(name, pending);
  }
  return state.sites.get(name);
}

// The lit and shadowed ground comes in after the view is already on screen.
function ground(plan) {
  const name = siteFile(plan).replace(".json", "_view.bin");
  if (!state.grounds.has(name)) {
    state.grounds.set(name, null);
    load("data/sites/" + name, "binary").then((buffer) => {
      state.grounds.set(name, parseView(buffer));
      showMoment(true);
    }).catch(() => state.grounds.delete(name));
  }
  return state.grounds.get(name);
}

// ---- time: the scroll position is the clock --------------------------------

function cursorY() {
  return narrow.matches ? $("scene-col").getBoundingClientRect().bottom : $("cursor").getBoundingClientRect().top;
}

function metFromScroll() {
  if (!state.runs) return 0;
  const hours = (cursorY() - $("track").getBoundingClientRect().top) / PX_PER_HOUR;
  return Math.round(Math.min(state.runs[0].n, Math.max(0, hours)));
}

function scrollToMet(hours) {
  const target = Math.min(state.runs[0].n, Math.max(0, hours));
  window.scrollBy(0, $("track").getBoundingClientRect().top + target * PX_PER_HOUR - cursorY());
}

// ---- drawing ---------------------------------------------------------------

function showMoment(force) {
  if (!state.runs) return;
  const met = metFromScroll();
  const key = [met, window.innerWidth, window.innerHeight, $("look-at").value].join();
  if (!force && key === state.drawn) return;
  state.drawn = key;
  state.met = met;
  const [a, b] = state.runs;
  const lookAt = $("look-at").value;

  const ga = drawScene($("scene-a"), a.site, a.views[met], { lookAt, ground: ground(a.plan) });
  const gb = drawScene($("scene-b"), b.site, b.views[met], { forceFull: true, compass: false, ground: ground(b.plan) });
  const light = lighting(a.views[met]).source;
  $("stretch-a").textContent = `vertical scale stretched ${ga.stretch.toFixed(0)}×, Sun and Earth widened to match`;
  $("light-a").textContent = light === "earth"
    ? "The Sun is down. The ground is shown by Earthlight, roughly ten thousand times fainter than sunlight, with the exposure raised."
    : light === "none" ? "No Sun and no Earth: the ground is dark." : "";
  $("stretch-b").textContent = `stretched ${gb.stretch.toFixed(0)}×`;
  $("look").hidden = ga.full;
  $("off-frame").textContent = offFrameNote(ga, a.views[met], lookAt);

  const label = formatMet(met);
  $("met").textContent = label;
  $("cursor-met").textContent = label;
  for (const [name, run] of [["a", a], ["b", b]]) {
    const c = countdownText(run, met);
    $("when-" + name).textContent = formatUtc(run.plan.landingMs + met * 3600000);
    $("count-" + name).textContent = c.sun + " · " + c.earth;
  }
  const col = $("plan-col");
  col.setAttribute("aria-valuenow", met);
  col.setAttribute("aria-valuemax", a.n);
  col.setAttribute("aria-valuetext", label + ". Plan A: " + $("count-a").textContent + ". Plan B: " + $("count-b").textContent);
  document.documentElement.dataset.met = met;
}

const ROWS = [
  ["power", "Sun in view, any part of it", "sunlitHours", "sunlit_hours", "h"],
  ["power", "Average share of the Sun's disc in view (power proxy)", "meanSunFraction", "mean_sun_fraction", "%"],
  ["power", "Longest time with no Sun", "longestDarkHours", "longest_dark_hours", "h"],
  ["link", "Earth in view, its centre above the terrain (direct link)", "earthHours", "earth_hours", "h"],
  ["link", "Longest time without Earth", "longestOutageHours", "longest_outage_hours", "h"],
  ["", "Sun and Earth in view together", "bothHours", "both_hours", "h"],
];

function showSummary(a, b) {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const text of ["", "A", "B", "B minus A"]) {
    const th = document.createElement("th");
    th.textContent = text;
    th.scope = "col";
    head.append(th);
  }
  const body = table.createTBody();
  for (const [group, label, field, key, unit] of ROWS) {
    const tr = body.insertRow();
    tr.className = group;
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    tr.append(th);
    const va = a.metrics[field], vb = b.metrics[field];
    const text = (v) => (unit === "%" ? (100 * v).toFixed(1) + " %" : v + " h");
    const diff = unit === "%" ? 100 * (vb - va) : vb - va;
    const cells = [["a", va, text(va)], ["b", vb, text(vb)],
      ["diff", vb - va, (diff > 0 ? "+" : diff < 0 ? "−" : "") + (unit === "%" ? Math.abs(diff).toFixed(1) : Math.abs(diff) + " h")]];
    for (const [who, value, shown] of cells) {
      const td = tr.insertCell();
      td.textContent = shown;
      td.className = who === "diff" ? "diff" : "";
      td.dataset.key = who + "." + key;          // exact value, for checking against the Python reference
      td.dataset.value = JSON.stringify(value);
    }
  }
  $("summary-table").replaceChildren(table);
  $("low-note").hidden = a.plan.height !== 2;

  const describe = (run) => {
    const s = run.site, lat = Math.abs(s.lat).toFixed(4) + (s.lat < 0 ? " S" : " N");
    return `${s.name}: ${lat}, ${s.lon.toFixed(4)} E, ground ${Math.round(s.site_height_m)} m above the 1737.4 km sphere`;
  };
  const note = $("site-note");
  note.textContent = (a.site === b.site ? describe(a) : describe(a) + "; " + describe(b)) +
    `. Panels ${a.plan.height} m above the ground. One sample every hour, so times are good to one hour. ` +
    "Terrain: LOLA elevation models, NASA GSFC PGDA. Sun and Earth positions: NASA/JPL Horizons. ";
  const link = document.createElement("a");
  link.href = "https://github.com/demonszy07/lunarplanb#readme";
  link.textContent = "Method, sources and limits";
  note.append(link, ".");
}

// ---- putting a pair of plans on screen -------------------------------------

let request = 0;
async function showPlans() {
  const mine = ++request;
  const status = $("status");
  try {
    const plans = readPlans();
    if (!Number.isFinite(plans[0].landingMs)) throw new RangeError("date");
    const sites = await Promise.all(plans.map(site));
    if (mine !== request) return;                 // a newer change is already on its way
    const keep = state.met;
    state.runs = plans.map((plan, i) => runPlan(state.sky, sites[i], plan));
    const [a, b] = state.runs;
    $("verdict").textContent = verdict(a.metrics, b.metrics, a.n);
    drawHead($("plan-head"));
    drawTrack($("track"), state.runs);
    showSummary(a, b);
    status.hidden = true;
    $("hint").hidden = false;
    if (keep > 0) scrollToMet(Math.min(keep, a.n));
    showMoment(true);
    document.documentElement.dataset.ready = String(mine);
  } catch (error) {
    status.hidden = false;
    status.textContent = error instanceof RangeError
      ? "That plan runs outside the sky table (2026 to 2030). Pick an earlier date or a shorter stay."
      : "Could not load sky data. " + error.message;
  }
}

for (const id of ["a-site", "a-date", "a-days", "a-height", "b-choice", "b-site"]) {
  $(id).addEventListener("change", showPlans);
}
$("look-at").addEventListener("change", () => { fitSelects(); showMoment(true); });
window.addEventListener("resize", fitSelects);

let queued = false;
function onMove() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; showMoment(false); });
}
window.addEventListener("scroll", onMove, { passive: true });
window.addEventListener("resize", onMove);

// arrow keys: one hour, with Shift one day; Home and End: landing and end of stay
window.addEventListener("keydown", (event) => {
  if (!state.runs || event.target.matches("input, select, textarea")) return;
  const step = event.shiftKey ? 24 : 1, now = metFromScroll();
  const to = { ArrowRight: now + step, ArrowLeft: now - step,
               Home: 0, End: state.runs[0].n }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  scrollToMet(to);
});

// dragging the flight plan with a mouse moves it like a sheet of paper
const col = $("plan-col");
let dragY = null;
col.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  dragY = event.clientY;
  col.setPointerCapture(event.pointerId);
});
col.addEventListener("pointermove", (event) => {
  if (dragY === null) return;
  window.scrollBy(0, dragY - event.clientY);
  dragY = event.clientY;
});
for (const type of ["pointerup", "pointercancel"]) col.addEventListener(type, () => { dragY = null; });

async function start() {
  try {
    const [buffer] = await Promise.all([load("data/sky.bin", "binary"), document.fonts.load("15px Jost")]);
    state.sky = parseSky(buffer);
    fitSelects();
    await showPlans();
  } catch (error) {
    $("status").textContent = "Could not load sky data. " + error.message;
  }
}
start();
