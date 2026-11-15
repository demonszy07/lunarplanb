// Opens the published folder (dist/) with the 3D views forced on ("?3d=force",
// so the test browser's slow software graphics do not switch them off) and
// reports, as JSON on stdout:
//   page      what the page says about each view, and what turning and zooming do
//   shadows   the light reaching the ground, seen from straight above, for three
//             moments of the opening plan (compared with rays by tests/test_view3d.py)
//   moments   for each moment given on stdin: the share of the Sun's disc the 3D
//             scene leaves in view (pixels through a long lens) beside the 2D number
//   touch     fingers on the view from above, on a phone
//   noWebgl2, switchedOff   the page without 3D
const { chromium } = require("playwright");
const { serve } = require("./shoot.cjs");

(async () => {
  const moments = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + "?3d=force");
  await page.waitForSelector("html[data-view3d]", { timeout: 120000 });
  const data = (p = page) => p.evaluate(() => ({ ...document.documentElement.dataset }));
  const settle = (p = page) => p.waitForTimeout(250);
  const goTo = async (met) => {
    // in a box of the sentence the keys belong to the box, so hand them to time first
    await page.evaluate(() => document.getElementById("plan-col").focus({ preventScroll: true }));
    await page.keyboard.press("Home");
    for (let d = 0; d < Math.floor(met / 24); d++) await page.keyboard.press("Shift+ArrowRight");
    for (let h = 0; h < met % 24; h++) await page.keyboard.press("ArrowRight");
    await page.waitForFunction((m) => document.documentElement.dataset.met === String(m), met);
    await settle();
  };
  const look = () => page.evaluate(() => window.lunar3d.moment().lookAz);
  const distance = () => page.evaluate(() => window.lunar3d.three.distance);
  const out = { errors, page: { start: await data() }, moments: [], shadows: [] };
  out.page.modeShown = await page.locator("#view-mode").isVisible();
  out.page.triangles = await page.evaluate(() => window.lunar3d.view.triangles);
  const canvas = await page.locator("#scene-a").boundingBox();

  // ---- from above ----
  await page.selectOption("#view-mode", "above");
  await settle();
  out.page.notesHiddenIn3d = !(await page.locator("#look-at").isVisible());
  await page.click("#notes-toggle");                    // over a 3D picture the notes are behind the "i" button
  const limits = await page.evaluate(() => window.lunar3d.view.constructor.name && window.lunar3d.three.lib.ABOVE_DISTANCE);
  out.page.above = { view: (await data()).view, stretch: await page.textContent("#stretch-a"), lookAz: await look(),
                     distance: await distance(), nearest: limits.nearest, farthest: limits.farthest };
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(canvas.x + 500, canvas.y + 200);
  await page.mouse.wheel(0, -300);
  await settle();
  out.page.above.afterWheelIn = await distance();
  await page.mouse.wheel(0, 900);
  await settle();
  out.page.above.afterWheelOut = await distance();
  out.page.above.pageScrolledByWheel = (await page.evaluate(() => window.scrollY)) - scrollBefore;
  await page.mouse.move(canvas.x + 400, canvas.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 500, canvas.y + 200, { steps: 4 });
  await page.mouse.up();
  await settle();
  out.page.above.afterDrag = { lookAz: await look(), choice: await page.inputValue("#look-at") };

  // cast shadows from straight above, at three moments of the opening plan
  for (const met of [30, 100, 150]) {
    await goTo(met);
    out.shadows.push(await page.evaluate((m) => {
      const at = window.lunar3d.moment(), view = window.lunar3d.view;
      return { met: m, light: at.light, wide: Array.from(view.mapPicture(at, 251, 20080)),
               middle: Array.from(view.mapPicture(at, 201, 2010)) };
    }, met));
  }

  // ---- standing on the surface ----
  await page.selectOption("#view-mode", "surface");
  await settle();
  out.page.surface = await data();
  out.page.stretch = await page.textContent("#stretch-a");
  out.page.horizonAt = await page.evaluate(() => window.lunar3d.three.map.y(0) / document.getElementById("scene-a").clientHeight);
  // turning: the select, then a drag of 200 px to the right (the scene follows the pointer)
  await page.selectOption("#look-at", "90");
  await settle();
  out.page.lookEast = await look();
  await page.mouse.move(canvas.x + 400, canvas.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 600, canvas.y + 150, { steps: 5 });
  await page.mouse.up();
  await settle();
  out.page.afterDrag = { lookAz: await look(), choice: await page.inputValue("#look-at"), width: canvas.width };
  // back to the panorama and to the surface again
  await page.selectOption("#view-mode", "2d");
  await settle();
  out.page.panorama = { ...(await data()), stretch: await page.textContent("#stretch-a"),
                        canvasHidden: await page.evaluate(() => document.getElementById("scene-3d").hidden) };
  await page.selectOption("#view-mode", "surface");
  await page.selectOption("#look-at", "sun");
  await settle();
  out.page.again = await data();

  // the check moments: plan A lands at that time, the clock stays at landing
  await goTo(0);
  for (const moment of moments) {
    await page.selectOption("#a-site", moment.site);
    await page.click("#a-date");
    await page.fill("#a-date", moment.utc);
    await page.keyboard.press("Enter");
    // wait until that plan is on screen in 3D (the terrain of another site arrives a moment later)
    await page.waitForFunction((m) => document.getElementById("when-a").textContent === m.utc + " UTC" &&
      document.documentElement.dataset.view === "surface", moment, { timeout: 60000 });
    await settle();
    out.moments.push({ ...moment, ...(await page.evaluate(() => {
      const at = window.lunar3d.moment();
      return { sunAz: at.view.sunAz, sunEl: at.view.sunEl, fraction2d: at.view.sunFraction,
               farShare: at.light.source === "sun" ? at.light.strength : null, lightSource: at.light.source,
               ...window.lunar3d.measureSun() };
    })) });
  }

  // another site: its terrain is fetched, the panorama stands in meanwhile, then 3D again
  const seen = [];
  page.on("response", (r) => seen.push(r.url().replace(base, "")));
  await page.selectOption("#a-site", "malapert");
  await page.waitForFunction(() => document.documentElement.dataset.view === "surface" &&
    window.lunar3d.three.terrainSite === "malapert", null, { timeout: 60000 });
  await page.waitForTimeout(500);
  out.page.otherSite = { files: seen.filter((u) => u.endsWith("_3d.bin")), view: (await data()).view,
                         eye: await page.evaluate(() => window.lunar3d.view.eye.y) };
  await page.selectOption("#a-height", "5");
  await page.waitForFunction(() => window.lunar3d.view.eye.y === 5, null, { timeout: 60000 });
  out.page.panelsAt5m = { eye: await page.evaluate(() => window.lunar3d.view.eye.y), view: (await data()).view };
  // nothing is drawn while nothing changes
  const frames = () => page.evaluate(() => window.lunar3d.view.renderer.info.render.frame);
  const idleFrom = await frames();
  await page.waitForTimeout(1000);
  out.page.framesWhileIdle = (await frames()) - idleFrom;
  await goTo(1);
  await page.waitForTimeout(300);
  out.page.framesForOneHour = (await frames()) - idleFrom;
  await page.close();

  // ---- fingers on the view from above, on a phone ----
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  const touchErrors = [];
  phone.on("pageerror", (e) => touchErrors.push(String(e)));
  await phone.goto(base + "?3d=force");
  await phone.waitForSelector("html[data-view3d]", { timeout: 120000 });
  await phone.selectOption("#view-mode", "above");
  await settle(phone);
  const cdp = await context.newCDPSession(phone);
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const state = () => phone.evaluate(() => ({ lookAz: window.lunar3d.moment().lookAz, distance: window.lunar3d.three.distance,
    scrollY: window.scrollY, met: Number(document.documentElement.dataset.met) }));
  const gesture = async (from, to, steps = 8) => {
    await send("touchStart", from);
    for (let k = 1; k <= steps; k++) {
      await send("touchMove", from.map(([x, y], i) => [x + (to[i][0] - x) * k / steps, y + (to[i][1] - y) * k / steps]));
      await phone.waitForTimeout(16);
    }
    await send("touchEnd", []);
    await phone.waitForTimeout(400);
  };
  const box = await phone.locator("#scene-a").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.3;
  const touch = { errors: touchErrors, start: await state() };
  let before = await state();
  await gesture([[cx - 60, cy]], [[cx + 60, cy]]);                          // one finger sideways
  let after = await state();
  touch.sideways = { turnedDeg: after.lookAz - before.lookAz, scrolled: after.scrollY - before.scrollY };
  before = after;
  await gesture([[cx, cy + 60]], [[cx, cy - 60]]);                          // one finger up: the page scrolls
  after = await state();
  touch.upDown = { turnedDeg: after.lookAz - before.lookAz, scrolled: after.scrollY - before.scrollY, metBefore: before.met, metAfter: after.met };
  before = after;
  await gesture([[cx - 20, cy - 20], [cx + 20, cy + 20]], [[cx - 70, cy - 70], [cx + 70, cy + 70]]);   // two fingers apart: nearer
  after = await state();
  touch.pinchOut = { distance: after.distance, scrolled: after.scrollY - before.scrollY };
  before = after;
  await gesture([[cx, cy - 80], [cx, cy + 80]], [[cx, cy - 25], [cx, cy + 25]]);                       // together, up and down: farther
  after = await state();
  touch.pinchIn = { distance: after.distance, scrolled: after.scrollY - before.scrollY };
  out.touch = touch;
  await context.close();

  // ---- a browser without WebGL2: the 3D code is not even downloaded ----
  const plain = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await plain.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === "webgl2" ? null : real.call(this, kind, ...rest); };
  });
  const fetched = [];
  plain.on("response", (r) => fetched.push(r.url().replace(base, "")));
  await plain.goto(base);
  await plain.waitForSelector("html[data-view3d]", { timeout: 60000 });
  await plain.waitForTimeout(300);
  out.noWebgl2 = { ...(await data(plain)),
                   bundleFetched: fetched.some((u) => u.includes("view3d")), terrainFetched: fetched.some((u) => u.endsWith("_3d.bin")),
                   modeShown: await plain.locator("#view-mode").isVisible() };
  // "?3d=off" does the same on request
  await plain.goto(base + "?3d=off");
  await plain.waitForSelector("html[data-view3d]", { timeout: 60000 });
  out.switchedOff = await plain.evaluate(() => document.documentElement.dataset.view3d);

  await browser.close();
  server.close();
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
