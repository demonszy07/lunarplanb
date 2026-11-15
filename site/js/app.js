// The screen: a photograph-like view from the site that stays in place, and
// a flight plan beside it. Scrolling the flight plan is moving through time.
// The page opens first; the sky table and site files load after it.

import { parseSky } from "./sky.js";
import { SITES, B_CHOICES, planB, siteFile, runPlan, verdict, countdownText, formatMet, formatUtc, parseUtc } from "./plan.js";
import { drawScene, drawOverlay, drawAboveMarks, backCaption, offFrameNote, parseView, lighting, shadeGround, earthPictureSize } from "./scene.js";
import { discFraction } from "./visibility.js";
import { drawHead, drawTrack, drawOverview, stripWidth, PX_PER_HOUR, TRACK_TOP } from "./flightplan.js";
import { dateField } from "./datefield.js";

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia("(max-width: 899px)");

const state = { sky: null, sites: new Map(), grounds: new Map(), runs: null, met: 0, drawn: "", scale: null,
                real: null, stars: null, earth: null, texture: null };
// per view: reused star positions and the canvas that holds the picture of Earth
const skies = [{ places: null, earthCanvas: document.createElement("canvas"), earthKey: "" },
               { places: null, earthCanvas: document.createElement("canvas"), earthKey: "" }];

// ---- the two sentences -----------------------------------------------------

function fillSelect(select, pairs, value) {
  select.replaceChildren(...pairs.map(([v, label]) => new Option(label, v)));
  select.value = value;
}
// A select is as wide as its longest option; make it as wide as the chosen
// words so it sits in the sentence like any other word. The date box too.
const ruler = document.createElement("canvas").getContext("2d");
function fitField(field) {
  const style = getComputedStyle(field);
  ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const label = field.matches("select") ? (field.selectedOptions[0] ? field.selectedOptions[0].text : "") : field.value;
  field.style.width = Math.ceil(ruler.measureText(label).width) + 2 + "px";
}
function fitFields() { document.querySelectorAll("select, input[type=text]").forEach(fitField); }

fillSelect($("a-site"), SITES, "site01");
fillSelect($("b-choice"), B_CHOICES, "week");
fillSelect($("b-site"), SITES, "malapert");

// The landing time is typed as text or picked in a calendar, always shown as
// "2027-03-01 00:00" (UTC); see datefield.js.
const TIP = $("tip").textContent;
function readDate() {
  const field = $("a-date"), ms = parseUtc(field.value);
  field.setAttribute("aria-invalid", String(!Number.isFinite(ms)));
  if (Number.isFinite(ms)) field.value = formatUtc(ms).slice(0, 16);
  return ms;
}

function readPlans() {
  const days = Math.min(60, Math.max(1, Math.round(Number($("a-days").value) || 1)));
  const a = {
    site: $("a-site").value,
    landingMs: readDate(),
    days,
    height: Number($("a-height").value),
  };
  $("b-site-wrap").hidden = $("b-choice").value !== "site";
  fitFields();
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
    }).catch(() => state.grounds.delete(name)).finally(realSky);
  }
  return state.grounds.get(name);
}

// The real sky comes last, one piece after another: the code, the stars,
// then where Earth is facing and its picture. The view works without them.
let realSkyStarted = false;
async function realSky() {
  if (realSkyStarted) return;
  realSkyStarted = true;
  const stage = (name) => { document.documentElement.dataset.stage = name; };
  stage("ground");
  try {
    state.real = await import("./realsky.js");
    state.stars = state.real.parseStars(await load("data/stars.bin", "binary"));
    showMoment(true);
    stage("stars");
    state.earth = state.real.parseEarth(await load("data/earth.bin", "binary"));
    const picture = new Image();
    picture.src = "data/earth.jpg";
    await picture.decode();
    const canvas = document.createElement("canvas");
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(picture, 0, 0);
    state.texture = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.earthImage = canvas;
    showMoment(true);
    stage("sky");
  } catch (error) {
    stage("sky-failed");                    // the drawn Earth and an empty sky stay
  }
  start3d();
}

// ---- the 3D view ------------------------------------------------------------
// Loaded last. The page is complete without it: with no WebGL2, or when the
// device draws it too slowly, it is taken out again and the panorama stays.
// "?3d=off" and "?3d=force" in the address override this, for checks.
//
// The speed check waits until the page and all its data have arrived and the
// browser is idle, draws two pictures that are not counted (the graphics card
// prepares its programs then), and then times 30 pictures, one per screen
// refresh so the page stays responsive meanwhile. 3D stays if the median is
// 60 ms or less. A device whose first five pictures all take more than three
// times that is stopped there, so a weak device is not held up for long.
const SLOW_MS = 60, FRAMES = 30, WARM_UP = 2, CLEARLY_SLOW = 3 * SLOW_MS;
const nextFrame = () => new Promise((done) => requestAnimationFrame(() => done()));
const pageLoaded = () => new Promise((done) => {
  if (document.readyState === "complete") done();
  else window.addEventListener("load", () => done(), { once: true });
});
const idle = () => new Promise((done) => {
  if (window.requestIdleCallback) requestIdleCallback(() => done(), { timeout: 1500 });
  else setTimeout(done, 200);
});

async function timePictures(view, at, width, height, ratio) {
  for (let k = 0; k < WARM_UP; k++) { view.timeOne(at, width, height, ratio); await nextFrame(); }
  const times = [];
  for (let k = 0; k < FRAMES; k++) {
    times.push(view.timeOne(at, width, height, ratio));
    if (times.length === 5 && times.every((ms) => ms > CLEARLY_SLOW)) break;
    await nextFrame();
  }
  const sorted = [...times].sort((x, y) => x - y);
  return { median: sorted[Math.floor(sorted.length / 2)], count: times.length };
}
// The page opens with the panorama ("2d"). The two 3D views: "above" circles the
// landing point, "surface" stands on it. Each view remembers where it looks.
const three = { view: null, lib: null, terrains: new Map(), terrain: null, terrainSite: "", siteRef: null,
                map: null, distance: 6000,
                look: { "2d": "sun", above: "0", surface: "sun" }, freeAz: { "2d": 0, above: 0, surface: 0 } };
const viewMode = () => $("view-mode").value;
const flag = (name, value) => { document.documentElement.dataset[name] = value; };

async function start3d() {
  const wish = new URLSearchParams(location.search).get("3d");
  if (wish === "off") return flag("view3d", "off");
  let probe = null;
  try { probe = document.createElement("canvas").getContext("webgl2"); } catch (error) { /* none */ }
  if (!probe) return flag("view3d", "no-webgl2");
  try {
    if (!state.runs) return flag("view3d", "no-plan");
    three.lib = await import("./view3d.bundle.js");
    const view = new three.lib.View3D($("scene-3d"));
    if (state.stars) view.setStars(state.stars);
    if (state.earthImage) view.setEarthPicture(state.earthImage);
    // The pictures of the speed check are drawn while the 3D canvas is still
    // hidden, so nothing flickers.
    const [a] = state.runs, siteId = a.plan.site, canvas = $("scene-a");
    const terrain = await terrain3d(siteId);
    view.setTerrain(terrain);
    view.setSite(a.site, terrain.farStrip[a.plan.height]);
    three.distance = three.lib.ABOVE_DISTANCE.start;
    await pageLoaded();
    await idle();
    flag("view3dCheck", "timing");
    const speed = await timePictures(view, moment3d(a, state.met, terrain, "above"),
      canvas.clientWidth, canvas.clientHeight, pixelRatio3d());
    const median = speed.median;
    flag("frameMs", median.toFixed(1));
    flag("frames", String(speed.count));
    if (median > SLOW_MS && wish !== "force") {
      view.dispose();
      return flag("view3d", "slow");
    }
    // if the browser takes the graphics context away later, the panorama comes back
    $("scene-3d").addEventListener("webglcontextlost", () => {
      if (!three.view) return;
      three.view = null;
      $("mode").hidden = true;
      flag("view3d", "lost");
      showMoment(true);
    });
    three.view = view;
    three.terrain = terrain;
    three.terrainSite = siteId;
    three.siteRef = a.site;
    $("mode").hidden = false;
    fitFields();
    flag("view3d", "on");
    if (three.wanted) {                                 // a view asked for in the address
      $("view-mode").value = three.wanted;
      $("view-mode").dispatchEvent(new Event("change"));
    }
    // for the checks in tests/check_3d.cjs
    window.lunar3d = { view, three, moment: () => moment3d(state.runs[0], state.met),
                       measureSun: () => three.view.measureSun(moment3d(state.runs[0], state.met)) };
    showMoment(true);
  } catch (error) {
    if (three.view) three.view.dispose();
    three.view = null;
    flag("view3d", "failed");
    flag("view3dError", String(error));
    showMoment(true);
  }
}

const pixelRatio3d = () => Math.min(window.devicePixelRatio || 1, 2);

// The terrain file of a site, fetched once; the mesh is built when it is needed.
function terrain3d(siteId) {
  if (!three.terrains.has(siteId)) {
    const pending = load("data/sites/" + siteId + "_3d.bin", "binary").then((buffer) => three.lib.parseTerrain(buffer));
    pending.catch(() => three.terrains.delete(siteId));
    three.terrains.set(siteId, pending);
  }
  return three.terrains.get(siteId).then((terrain) => {
    if (three.view && state.runs && state.runs[0].plan.site === siteId && three.terrainSite !== siteId) {
      three.view.setTerrain(terrain);
      three.terrain = terrain;
      three.terrainSite = siteId;
      showMoment(true);
    }
    return terrain;
  });
}

// Which 3D picture view A shows right now: "above", "surface", or "" for the panorama.
function in3d(run) {
  if (!three.view || viewMode() === "2d") return "";
  if (three.terrainSite !== run.plan.site) { terrain3d(run.plan.site).catch(() => {}); return ""; }
  return viewMode();
}

// Azimuth at the middle of view A (from above: the way the camera faces).
function lookAzimuth(view) {
  const choice = $("look-at").value;
  return choice === "earth" ? view.earthAz : choice === "free" ? three.freeAz[viewMode()] : choice === "sun" ? view.sunAz : Number(choice);
}

// Everything the 3D view needs to know about one moment.
function moment3d(run, met, terrain = three.terrain, mode = viewMode() === "above" ? "above" : "surface") {
  const view = run.views[met], hours = run.start + met, site = run.site;
  const light = lighting(view);
  const picture = ground(run.plan);
  // far mountains are not in the mesh: the share of the Sun's disc they leave
  // in view dims all the near ground; near terrain is left to the mesh itself
  const far = terrain ? terrain.farMesh[run.plan.height] : null;
  const strength = light.source === "sun" && far ? discFraction(far, view.sunAz, view.sunEl, view.sunDiameter) : light.strength;
  const hideStars = $("seen-by").value === "camera" && view.sunFraction > 0;
  return {
    view, lookAz: lookAzimuth(view), mode, distance: three.distance,
    light: { source: light.source, strength,
             az: light.source === "earth" ? view.earthAz : view.sunAz, el: light.source === "earth" ? view.earthEl : view.sunEl,
             colour: light.source === "earth" ? [120 / 255, 140 / 255, 175 / 255] : [184 / 255, 180 / 255, 172 / 255],
             level: light.source === "earth" ? 0.32 : 1,
             diameter: light.source === "earth" ? view.earthDiameter : view.sunDiameter },
    starMatrix: state.stars && !hideStars ? state.real.siteMatrix(hours, site.lat, site.lon) : null,
    earth: state.earth ? { ...state.real.earthFacing(state.earth, hours),
                           pole: state.real.earthPoleAngle(hours, site.lat, site.lon, view.earthAz, view.earthEl) } : null,
    picture: picture ? shadeGround(picture, view) : null,
    pictureElTop: picture ? picture.elTop : 0, pictureElSpan: picture ? picture.rows * picture.elStep : 1,
  };
}

// What the real sky adds to one view at one moment.
function skyFor(index, run, met, canvas) {
  const sky = skies[index], view = run.views[met], hours = run.start + met;
  const out = { stars: null, earthPicture: null };
  if (state.stars) {
    const hidden = $("seen-by").value === "camera" && view.sunFraction > 0;
    sky.places = state.real.starPositions(state.stars, hours, run.site.lat, run.site.lon, sky.places);
    out.stars = hidden ? null : sky.places;
  }
  if (state.texture) {
    const size = earthPictureSize(view, canvas.clientHeight);
    const key = [run.plan.site, hours, size].join();
    if (sky.earthKey !== key) {
      sky.earthKey = key;
      state.real.paintEarth(sky.earthCanvas, state.texture, size, state.real.earthFacing(state.earth, hours),
        state.real.earthPoleAngle(hours, run.site.lat, run.site.lon, view.earthAz, view.earthEl),
        state.real.sunOnDisc(view));
    }
    out.earthPicture = sky.earthCanvas;
  }
  return out;
}

// ---- time: the scroll position is the clock --------------------------------
// One source of truth: how far the flight plan is scrolled. The arrow keys, a
// tap on an hour and the strip under the views all scroll the page, and
// everything on screen is drawn from where the page then is.

// The line the flight plan is read at: the lower edge of the fixed views on a
// narrow screen, otherwise where the cursor line holds still.
function readLine() {
  return narrow.matches ? $("scene-col").getBoundingClientRect().bottom : parseFloat(getComputedStyle($("cursor")).top);
}
const trackZero = () => $("track").getBoundingClientRect().top + TRACK_TOP;

function metFromScroll() {
  if (!state.runs) return 0;
  const hours = (readLine() - trackZero()) / PX_PER_HOUR;
  return Math.round(Math.min(state.runs[0].n, Math.max(0, hours)));
}

function scrollToMet(hours) {
  const target = Math.round(Math.min(state.runs[0].n, Math.max(0, hours)));
  const y = window.scrollY + trackZero() + target * PX_PER_HOUR - readLine();
  // landing is every position above the first hour line: stay where the page is if it is there
  window.scrollTo(0, target === 0 ? Math.min(window.scrollY, y) : y);
}

// ---- drawing ---------------------------------------------------------------

function showMoment(force) {
  if (!state.runs) return;
  const met = metFromScroll();
  const [a, b] = state.runs;
  const solid = in3d(a);
  const key = [met, window.innerWidth, window.innerHeight, $("look-at").value, three.freeAz[viewMode()], three.distance,
               $("seen-by").value, solid].join();
  if (!force && key === state.drawn) return;
  state.drawn = key;
  state.met = met;
  const lookAz = lookAzimuth(a.views[met]);

  // view A: one of the 3D pictures with its marks over it, or the panorama
  const canvasA = $("scene-a");
  $("scene-3d").hidden = !solid;
  // over a 3D picture the words stand on black (style.css); set before measuring where they are
  const wasSolid = $("view-a").classList.contains("solid");
  $("view-a").classList.toggle("solid", !!solid);
  $("view-a").classList.toggle("above", solid === "above");
  if (wasSolid !== !!solid) fitFields();       // the sentence's words may change size with the view
  let frame;                                    // { full, centre, windowDeg } of what view A shows
  if (solid) {
    if (three.siteRef !== a.site) { three.view.setSite(a.site, three.terrain.farStrip[a.plan.height]); three.siteRef = a.site; }
    three.map = three.view.draw(moment3d(a, met), canvasA.clientWidth, canvasA.clientHeight, pixelRatio3d());
    if (solid === "above") {
      const caption = document.querySelector("#view-a figcaption").getBoundingClientRect();
      const frameA = canvasA.getBoundingClientRect();
      drawAboveMarks(canvasA, three.map, a.views[met], Math.min(caption.top, frameA.bottom - 4) - frameA.top - 8);
      frame = { full: false, centre: lookAz, windowDeg: 60, above: true };
      $("stretch-a").textContent = `from ${(three.distance / 1000).toFixed(1)} km away, no vertical stretch`;
      $("draw-note").textContent = "The ground is a 3D model from the LOLA heights. Shadows are cast by terrain within 20 km of the landing point. The arrows lie on the ground and point toward the Sun and Earth.";
    } else {
      drawOverlay(canvasA, three.map);
      frame = { full: false, centre: lookAz, windowDeg: three.map.windowDeg };
      $("stretch-a").textContent = `${three.map.windowDeg}° wide, no vertical stretch`;
      $("draw-note").textContent = "The ground is a 3D model from the LOLA heights. Shadows are cast by terrain within 20 km. Sun and Earth have their true size.";
    }
  } else {
    three.map = null;
    frame = drawScene(canvasA, a.site, a.views[met],
      { lookAz, ground: ground(a.plan), ...skyFor(0, a, met, canvasA) });
    $("stretch-a").textContent = `vertical scale stretched ${frame.stretch.toFixed(0)}×`;
    $("draw-note").textContent = "Sun and Earth are drawn round, so they are widened by the same stretch.";
  }
  three.frame = frame;
  $("view-a").classList.toggle("turns", !frame.full);
  if (solid) backCaption(canvasA, document.querySelector("#view-a figcaption"));
  flag("view", solid || "2d");
  const gb = drawScene($("scene-b"), b.site, b.views[met],
    { forceFull: true, compass: false, ground: ground(b.plan), ...skyFor(1, b, met, $("scene-b")) });
  document.documentElement.dataset.stars = !state.stars ? "none yet" : $("seen-by").value === "camera" && a.views[met].sunFraction > 0 ? "hidden" : "shown";
  $("seen-note").textContent = $("seen-by").value === "eye"
    ? "Stars as an eye shaded from the Sun would see them."
    : a.views[met].sunFraction > 0
      ? "With the Sun in view, a camera set for sunlit ground records no stars, as in the Apollo photographs."
      : "The Sun is down, so a long exposure shows the stars.";
  const light = lighting(a.views[met]).source;
  const lightNote = light === "earth"
    ? "The Sun is down. The ground is shown by Earthlight, roughly ten thousand times fainter than sunlight, with the exposure raised."
    : light === "none" ? "No Sun and no Earth: the ground is dark." : "";
  $("light-a").textContent = lightNote;
  // narrow screens: a short form over plan B's view; the full sentence is behind "i"
  $("light-short").textContent = light === "earth" ? "A: Earthlight only, exposure raised"
    : light === "none" ? "A: no Sun, no Earth, ground dark" : "";
  $("stretch-b").textContent = `stretched ${gb.stretch.toFixed(0)}×`;
  $("look").hidden = frame.full;
  $("off-frame").textContent = frame.above ? "" : offFrameNote(frame, a.views[met]);

  const label = formatMet(met);
  $("met").textContent = label;
  $("cursor-met").textContent = label;
  if (state.scale) $("overview-marker").style.transform = `translateX(${state.scale.x(met).toFixed(1)}px)`;
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
  ["power", "Sun in view, any part", "sunlitHours", "sunlit_hours", "h"],
  ["power", "Sun's disc in view, average (power proxy)", "meanSunFraction", "mean_sun_fraction", "%"],
  ["power", "Longest time with no Sun", "longestDarkHours", "longest_dark_hours", "h"],
  ["link", "Earth in view (direct link)", "earthHours", "earth_hours", "h"],
  ["link", "Longest time without Earth", "longestOutageHours", "longest_outage_hours", "h"],
  ["", "Sun and Earth together", "bothHours", "both_hours", "h"],
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

// The flight plan strip is as wide as its column lets it be.
let planWidth = 0;
function drawPlan(onlyIfChanged) {
  if (!state.runs) return;
  const col = $("plan-col"), style = getComputedStyle(col);
  const width = stripWidth(col.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  if (onlyIfChanged && width === planWidth) return;
  planWidth = width;
  drawHead($("plan-head"), width);
  drawTrack($("track"), state.runs, width);
}

function drawStrip() {
  if (state.runs) state.scale = drawOverview($("overview-bands"), state.runs);
}

// the "i" button on narrow screens opens the notes about the view
$("notes-toggle").addEventListener("click", () => {
  const open = $("top").classList.toggle("open");
  $("notes-toggle").setAttribute("aria-expanded", String(open));
});

// ---- putting a pair of plans on screen -------------------------------------

let request = 0;
async function showPlans() {
  const mine = ++request;
  const status = $("status");
  try {
    const plans = readPlans();
    if (!Number.isFinite(plans[0].landingMs)) throw new SyntaxError("date");
    const sites = await Promise.all(plans.map(site));
    if (mine !== request) return;                 // a newer change is already on its way
    const keep = state.met;
    state.runs = plans.map((plan, i) => runPlan(state.sky, sites[i], plan));
    const [a, b] = state.runs;
    $("verdict").textContent = verdict(a.metrics, b.metrics, a.n);
    drawPlan();
    drawStrip();
    showSummary(a, b);
    status.hidden = true;
    $("tip").textContent = TIP;
    $("hint").hidden = false;
    scrollToMet(Math.min(keep, a.n));             // the page above the plan may have changed height
    showMoment(true);
    document.documentElement.dataset.ready = String(mine);
  } catch (error) {
    status.hidden = false;
    status.textContent = error instanceof SyntaxError
      ? "Write the landing time like 2027-03-01 00:00 (24-hour clock, UTC)."
      : error instanceof RangeError
        ? "That plan runs outside the sky table (2026 to 2030). Pick another date or a shorter stay."
        : "Could not load sky data. " + error.message;
    // a mistake in the sentence is answered right under the sentence
    if (error instanceof SyntaxError || error instanceof RangeError) $("tip").textContent = status.textContent;
  }
}

for (const id of ["a-site", "a-date", "a-days", "a-height", "b-choice", "b-site"]) {
  $(id).addEventListener("change", showPlans);
}
for (const id of ["look-at", "seen-by"]) $(id).addEventListener("change", () => { fitFields(); showMoment(true); });
// each view keeps its own direction
$("look-at").addEventListener("change", () => { three.look[viewMode()] = $("look-at").value; });
$("view-mode").addEventListener("change", () => {
  const pick = $("look-at"), want = three.look[viewMode()];
  pick.querySelector("[value=free]").hidden = want !== "free";
  pick.value = want;
  fitFields();
  showMoment(true);
});

// ---- turning and zooming view A ----------------------------------------------
// One finger or the mouse dragged sideways turns the view (when it shows a
// window and not the whole circle). From above, two fingers or the wheel move
// the camera nearer or farther. A finger moving up or down still scrolls the
// page, that is, the time: the canvas has "touch-action: pan-y".
const sceneA = $("scene-a");
const fingers = new Map();                     // pointers that are down on view A: id -> [x, y]
let turned = 0, spread = 0;
const touchSpread = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
function zoomBy(factor) {
  if (!three.lib || viewMode() !== "above") return;
  const { nearest, farthest } = three.lib.ABOVE_DISTANCE;
  three.distance = Math.min(farthest, Math.max(nearest, three.distance * factor));
  onMove();
}
function turnBy(dx) {
  const mode = viewMode(), pick = $("look-at");
  if (pick.value !== "free") {
    three.freeAz[mode] = lookAzimuth(state.runs[0].views[state.met]);
    pick.querySelector("[value=free]").hidden = false;
    pick.value = "free";
    three.look[mode] = "free";
    fitFields();
  }
  // the scene follows the pointer: degrees per pixel at the middle of the picture
  three.freeAz[mode] = (three.freeAz[mode] - dx * three.frame.windowDeg / sceneA.clientWidth + 360) % 360;
  onMove();
}
sceneA.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !three.frame || three.frame.full) return;
  fingers.set(event.pointerId, [event.clientX, event.clientY]);
  sceneA.setPointerCapture(event.pointerId);
  if (fingers.size === 1) turned = 0;
});
sceneA.addEventListener("pointermove", (event) => {
  const last = fingers.get(event.pointerId);
  if (!last || !state.runs) return;
  fingers.set(event.pointerId, [event.clientX, event.clientY]);
  if (fingers.size >= 2) return;                       // two fingers: see touchmove below
  const dx = event.clientX - last[0];
  turned += Math.abs(dx);
  if (turned >= 4) turnBy(dx);                        // less than that is a click, not a drag
});
for (const type of ["pointerup", "pointercancel"]) {
  sceneA.addEventListener(type, (event) => { fingers.delete(event.pointerId); });
}
// Two fingers on the view from above belong to the view, not to the page:
// moving them apart brings the camera nearer, together takes it farther.
// (Touch events, because the browser may take two moving fingers for a scroll
// and stop sending pointer events.)
sceneA.addEventListener("touchstart", (event) => { spread = event.touches.length === 2 ? touchSpread(event.touches) : 0; }, { passive: true });
sceneA.addEventListener("touchend", () => { spread = 0; }, { passive: true });
sceneA.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 2 || viewMode() !== "above" || !three.view) return;
  if (event.cancelable) event.preventDefault();
  const now = touchSpread(event.touches);
  if (spread > 0 && now > 0) zoomBy(spread / now);
  spread = now;
}, { passive: false });
sceneA.addEventListener("wheel", (event) => {
  if (viewMode() !== "above" || !three.view || three.frame.full) return;
  event.preventDefault();                              // over the view from above the wheel moves the camera
  zoomBy(Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)));
}, { passive: false });
window.addEventListener("resize", fitFields);

let queued = false;
function onMove() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; showMoment(false); });
}
window.addEventListener("scroll", onMove, { passive: true });
// A new window width moves everything above the flight plan; keep the moment.
// (A change of height alone is a phone hiding its address bar in mid-scroll.)
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  const keep = state.met, widthChanged = window.innerWidth !== lastWidth;
  lastWidth = window.innerWidth;
  drawPlan(true);
  drawStrip();
  if (state.runs && widthChanged) scrollToMet(keep);
  onMove();
});

// ---- who the arrow keys belong to ------------------------------------------
// In a box of the sentence the keys edit the box. Escape, Enter in a typed
// box, or a click on a view, the strip or the flight plan hands them to time.
const timeline = $("plan-col");
const isField = (node) => node instanceof Element && node.matches("input, select, textarea");
function focusTime() {
  if (document.activeElement !== timeline) timeline.focus({ preventScroll: true });
}
const KEYS_TIME = $("keys").textContent;
const KEYS_FIELD = "Arrow keys now edit this box. Esc returns them to time.";
function showKeys() {
  const inField = isField(document.activeElement);
  $("keys").textContent = inField ? KEYS_FIELD : KEYS_TIME;
  document.documentElement.dataset.keys = inField ? "box" : "time";
}
document.addEventListener("focusin", showKeys);
document.addEventListener("focusout", () => setTimeout(showKeys, 0));
for (const id of ["scene-col", "plan-col"]) {
  $(id).addEventListener("click", (event) => {
    if (!event.target.closest("select, input, button, a")) focusTime();
  });
}

// arrow keys: one hour, with Shift one day; Home and End: landing and end of stay
window.addEventListener("keydown", (event) => {
  if (isField(event.target)) {
    if (event.key === "Escape" || (event.key === "Enter" && event.target.matches("input"))) {
      event.preventDefault();
      event.target.blur();                       // a typed change is taken on the way out
      focusTime();
    }
    return;
  }
  if (!state.runs) return;
  const step = event.shiftKey ? 24 : 1, now = metFromScroll();
  const to = { ArrowRight: now + step, ArrowLeft: now - step,
               Home: 0, End: state.runs[0].n }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  scrollToMet(to);
});

// in the date box, up and down step the part under the caret: year, month, day or hour
$("a-date").addEventListener("keydown", (event) => {
  const step = { ArrowUp: 1, ArrowDown: -1 }[event.key], field = event.target, ms = parseUtc(field.value);
  if (!step || !Number.isFinite(ms)) return;
  event.preventDefault();
  const at = field.selectionStart, date = new Date(ms);
  if (at <= 4) date.setUTCFullYear(date.getUTCFullYear() + step);
  else if (at <= 7) date.setUTCMonth(date.getUTCMonth() + step);
  else if (at <= 10) date.setUTCDate(date.getUTCDate() + step);
  else date.setUTCHours(date.getUTCHours() + step);
  field.value = formatUtc(date.getTime()).slice(0, 16);
  field.setSelectionRange(at, at);
  dateBox.taken();
  showPlans();
});

// dragging the flight plan with a mouse moves it like a sheet of paper;
// a click or tap on an hour brings that hour to the cursor
const col = $("plan-col");
let dragY = null, dragged = 0;
col.addEventListener("pointerdown", (event) => {
  dragged = 0;
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  dragY = event.clientY;
  col.setPointerCapture(event.pointerId);
});
col.addEventListener("pointermove", (event) => {
  if (dragY === null) return;
  dragged += Math.abs(dragY - event.clientY);
  window.scrollBy(0, dragY - event.clientY);
  dragY = event.clientY;
});
for (const type of ["pointerup", "pointercancel"]) col.addEventListener(type, () => { dragY = null; });
col.addEventListener("click", (event) => {
  if (!state.runs || dragged > 4) return;
  const hours = Math.round((event.clientY - trackZero()) / PX_PER_HOUR);
  if (hours >= 0 && hours <= state.runs[0].n) scrollToMet(hours);
});

// the strip under the views: a tap jumps to that moment, a drag runs the time
const strip = $("overview");
let scrubbing = false;
function scrub(event) {
  if (state.scale) scrollToMet(state.scale.hours(event.clientX - strip.getBoundingClientRect().left));
}
strip.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  scrubbing = true;
  strip.setPointerCapture(event.pointerId);
  scrub(event);
});
strip.addEventListener("pointermove", (event) => { if (scrubbing) scrub(event); });
for (const type of ["pointerup", "pointercancel"]) strip.addEventListener(type, () => { scrubbing = false; });

// ---- a plan, a moment and a view from the address ----------------------------
// ?site=mouton&date=2028-04-06T00:00&days=10&panels=2&b=site07&met=25&view=above
//   site    one of the site ids (site01, site04, site07, site11, malapert, mouton, haworth)
//   date    landing time, UTC, e.g. 2028-04-06T00:00
//   days    1 to 60;  panels  2 or 5 (metres)
//   b       day, week or lunarday (one day, one week, 29.5 days later), or a site id (at that site)
//   met     hours since landing, where the cursor stands
//   view    panorama, above or surface (the 3D views only where the device passes the speed check)
// A value that does not fit is left out and the default stays.
const asked = new URLSearchParams(location.search);
function fromAddress() {
  const ids = SITES.map(([id]) => id), choices = B_CHOICES.map(([id]) => id);
  const site = asked.get("site"), date = asked.get("date"), days = Number(asked.get("days"));
  const panels = asked.get("panels"), b = asked.get("b"), met = Number(asked.get("met"));
  if (ids.includes(site)) $("a-site").value = site;
  if (date && Number.isFinite(parseUtc(date))) $("a-date").value = formatUtc(parseUtc(date)).slice(0, 16);
  if (Number.isInteger(days) && days >= 1 && days <= 60) $("a-days").value = String(days);
  if (panels === "2" || panels === "5") $("a-height").value = panels;
  if (choices.includes(b) && b !== "site") $("b-choice").value = b;
  else if (ids.includes(b)) { $("b-choice").value = "site"; $("b-site").value = b; }
  if (asked.has("met") && Number.isInteger(met) && met >= 0) {
    state.met = met;                                    // showPlans() scrolls the flight plan to it
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }
  const view = { panorama: "2d", "2d": "2d", above: "above", surface: "surface" }[asked.get("view")];
  if (view && view !== "2d") three.wanted = view;      // set once the 3D views are offered
}

// the landing time box: typing changes digits only; a click opens the calendar
const dateBox = dateField($("a-date"), () => showPlans(), () => state.sky
  ? [state.sky.epochMs, state.sky.epochMs + state.sky.lastHour * 3600000]
  : [Date.UTC(2026, 0, 1), Date.UTC(2030, 11, 31, 23)]);

async function start() {
  try {
    const [buffer] = await Promise.all([load("data/sky.bin", "binary"), document.fonts.load("15px Jost")]);
    state.sky = parseSky(buffer);
    fromAddress();
    dateBox.taken();
    fitFields();
    await showPlans();
  } catch (error) {
    $("status").textContent = "Could not load sky data. " + error.message;
  }
}
start();
