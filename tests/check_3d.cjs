// Opens the published folder (dist/) with the 3D view forced on ("?3d=force",
// so the test browser's slow software graphics do not switch it off) and
// reports, as JSON on stdout:
//   moments   for each moment given on stdin: the share of the Sun's disc the
//             3D scene leaves in view (pixels through a long lens) beside the 2D number
//   shadows   the light reaching the ground, seen from above, for three moments
//             of the opening plan (compared with rays by tests/test_view3d.py)
//   page      what the page says about the view, and what turning does
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
  const data = () => page.evaluate(() => ({ ...document.documentElement.dataset }));
  const goTo = async (met) => {
    // in a box of the sentence the keys belong to the box, so hand them to time first
    await page.evaluate(() => document.getElementById("plan-col").focus({ preventScroll: true }));
    await page.keyboard.press("Home");
    for (let d = 0; d < Math.floor(met / 24); d++) await page.keyboard.press("Shift+ArrowRight");
    for (let h = 0; h < met % 24; h++) await page.keyboard.press("ArrowRight");
    await page.waitForFunction((m) => document.documentElement.dataset.met === String(m), met);
    await page.waitForTimeout(150);
  };
  const out = { errors, page: { start: await data() }, moments: [], shadows: [] };
  out.page.stretch = await page.textContent("#stretch-a");
  out.page.modeShown = await page.locator("#view-mode").isVisible();
  out.page.triangles = await page.evaluate(() => window.lunar3d.view.triangles);

  // cast shadows from above, at three moments of the opening plan
  for (const met of [30, 100, 150]) {
    await goTo(met);
    out.shadows.push(await page.evaluate((m) => {
      const at = window.lunar3d.moment(), view = window.lunar3d.view;
      return { met: m, light: at.light, wide: Array.from(view.mapPicture(at, 251, 20080)),
               middle: Array.from(view.mapPicture(at, 201, 2010)) };
    }, met));
  }

  // turning: the select, then a drag of 200 px to the right (the scene follows the pointer)
  await page.selectOption("#look-at", "90");
  await page.waitForTimeout(150);
  const canvas = await page.locator("#scene-a").boundingBox();
  out.page.lookEast = await page.evaluate(() => window.lunar3d.moment().lookAz);
  await page.mouse.move(canvas.x + 400, canvas.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 600, canvas.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  out.page.afterDrag = { lookAz: await page.evaluate(() => window.lunar3d.moment().lookAz),
                         choice: await page.inputValue("#look-at"), width: canvas.width };
  // back to the panorama and to 3D again
  await page.selectOption("#view-mode", "2d");
  await page.waitForTimeout(150);
  out.page.panorama = { ...(await data()), stretch: await page.textContent("#stretch-a"),
                        canvasHidden: await page.evaluate(() => document.getElementById("scene-3d").hidden) };
  await page.selectOption("#view-mode", "3d");
  await page.selectOption("#look-at", "sun");
  await page.waitForTimeout(150);
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
      document.documentElement.dataset.view === "3d" && window.lunar3d.moment().view === window.lunar3d.moment().view,
      moment, { timeout: 60000 });
    await page.waitForTimeout(300);
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
  await page.waitForFunction(() => document.documentElement.dataset.view === "3d" &&
    window.lunar3d.moment().view === window.lunar3d.moment().view && document.getElementById("when-a").textContent !== "", null, { timeout: 60000 });
  await page.waitForFunction(() => window.lunar3d.view.triangles > 0 && document.documentElement.dataset.view === "3d");
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

  // a browser without WebGL2: the 3D code is not even downloaded
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
  out.noWebgl2 = { ...(await plain.evaluate(() => ({ ...document.documentElement.dataset }))),
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
