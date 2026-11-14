// Opens the published folder (dist/) in a real browser, once as a desktop
// with mouse and keyboard and once as a phone with a touch screen, and
// reports how the clock answers keys, typing, taps and drags.
// stdout: JSON. Used by tests/test_page.py.
const { chromium } = require("playwright");
const { serve } = require("./shoot.cjs");

const met = (page) => page.evaluate(() => Number(document.documentElement.dataset.met));
const waitMet = (page, m) => page.waitForFunction((x) => document.documentElement.dataset.met === String(x), m, { timeout: 5000 });
const focusId = (page) => page.evaluate(() => document.activeElement.id);
const box = (page, id) => page.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
// where an hour sits on the strip, read from the marker the page itself draws
const stripX = async (page, hours, n) => { const b = await box(page, "overview"); return b.x + 16 + (hours / n) * (b.w - 16); };
const markerHours = (page, n) => page.evaluate((count) => {
  const strip = document.getElementById("overview").getBoundingClientRect(), mark = document.getElementById("overview-marker").getBoundingClientRect();
  return (mark.x - strip.x - 16) / (strip.width - 16) * count;
}, n);

async function open(browser, base, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector("html[data-ready]", { timeout: 20000 });
  await page.waitForSelector("html[data-stage^=sky]", { timeout: 20000 });
  return { context, page, errors };
}

async function desktop(browser, base) {
  const { context, page, errors } = await open(browser, base, { viewport: { width: 1440, height: 900 } });
  const out = { errors };
  const n = 240;

  // order on the page: verdict, mission summary, flight plan
  const [v, s, t] = [await box(page, "verdict"), await box(page, "summary"), await box(page, "track")];
  out.summaryBetween = v.y + v.h <= s.y && s.y + s.h <= t.y;
  out.tip = (await page.textContent("#tip")).trim();
  out.dateShown = await page.inputValue("#a-date");
  out.dateType = await page.getAttribute("#a-date", "type");

  // keys: in a box they belong to the box; Escape hands them to time
  out.keysAtStart = await page.textContent("#keys");
  await page.click("#a-days");
  out.focusInBox = await focusId(page);
  out.keysInBox = await page.textContent("#keys");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(150);
  out.metAfterArrowsInBox = await met(page);
  await page.keyboard.press("Escape");
  out.focusAfterEscape = await focusId(page);
  out.keysAfterEscape = await page.textContent("#keys");
  await page.keyboard.press("ArrowRight");
  await waitMet(page, 1);
  await page.keyboard.press("Shift+ArrowRight");
  await waitMet(page, 25);
  await page.keyboard.press("Shift+ArrowLeft");
  await waitMet(page, 1);
  await page.keyboard.press("ArrowLeft");
  await waitMet(page, 0);
  out.arrowsAfterEscape = true;

  // a select keeps the keys too, until a click on the view
  await page.focus("#a-height");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  out.metAfterArrowInSelect = await met(page);
  out.heightAfterArrowInSelect = await page.inputValue("#a-height");
  await page.selectOption("#a-height", "2");
  const view = await box(page, "scene-a");
  await page.mouse.click(view.x + view.w / 2, view.y + 80);
  out.focusAfterViewClick = await focusId(page);
  await page.keyboard.press("ArrowRight");
  await waitMet(page, 1);
  await page.keyboard.press("Home");
  await waitMet(page, 0);

  // the date: typed as text, 24-hour UTC; Enter takes it and returns the keys to time
  const type = async (text) => { await page.click("#a-date"); await page.fill("#a-date", text); await page.keyboard.press("Enter"); await page.waitForTimeout(250); };
  await type("2027-04-02 13:00");
  out.dateTyped = { value: await page.inputValue("#a-date"), whenA: await page.textContent("#when-a"), focus: await focusId(page) };
  await type("202704031830");
  out.dateDigits = { value: await page.inputValue("#a-date"), whenA: await page.textContent("#when-a") };
  await type("2027-04-05");
  out.dateOnly = await page.inputValue("#a-date");
  await type("05/04/2027 1 pm");
  out.dateWrong = { invalid: await page.getAttribute("#a-date", "aria-invalid"), tip: (await page.textContent("#tip")).trim(), whenA: await page.textContent("#when-a") };
  await type("2027-03-01 00:00");
  out.dateBack = { invalid: await page.getAttribute("#a-date", "aria-invalid"), tip: (await page.textContent("#tip")).trim(), whenA: await page.textContent("#when-a") };
  // up and down step the part under the caret
  await page.click("#a-date");
  await page.evaluate(() => document.getElementById("a-date").setSelectionRange(12, 12));
  await page.keyboard.press("ArrowUp");
  out.dateHourUp = await page.inputValue("#a-date");
  await page.evaluate(() => document.getElementById("a-date").setSelectionRange(9, 9));
  await page.keyboard.press("ArrowDown");
  out.dateDayDown = await page.inputValue("#a-date");
  await type("2027-03-01 00:00");

  // the strip under the views: a click jumps, a drag runs the time
  const strip = await box(page, "overview");
  const y = strip.y + strip.h / 2;
  await page.mouse.click(await stripX(page, 120, n), y);
  await waitMet(page, 120);
  out.stripClick = { met: await met(page), marker: await markerHours(page, n), focus: await focusId(page) };
  await page.mouse.move(await stripX(page, 120, n), y);
  await page.mouse.down();
  const seen = [];
  for (const h of [140, 160, 180, 200]) {
    await page.mouse.move(await stripX(page, h, n), y, { steps: 4 });
    await waitMet(page, h);
    seen.push(await met(page));
  }
  await page.mouse.up();
  out.stripDrag = seen;
  out.markerAfterDrag = await markerHours(page, n);

  // the same cursor: keys go on from where the strip left it, the wheel too
  await page.keyboard.press("ArrowRight");
  await waitMet(page, 201);
  await page.mouse.move(1200, 600);
  await page.mouse.wheel(0, 60);
  await waitMet(page, 211);
  out.afterWheel = { met: await met(page), marker: await markerHours(page, n), cursor: await page.textContent("#cursor-met"), label: await page.textContent("#met") };

  // a click on an hour of the flight plan brings it to the cursor; a drag moves the sheet
  const line = (await box(page, "cursor")).y;
  await page.mouse.click(1200, line + 6 * 10);
  await waitMet(page, 221);
  out.rowClick = await met(page);
  await page.mouse.move(1200, line + 100);
  await page.mouse.down();
  await page.mouse.move(1200, line + 100 + 60, { steps: 5 });
  await page.mouse.up();
  await waitMet(page, 211);
  await page.waitForTimeout(150);
  out.afterPaperDrag = await met(page);
  await page.keyboard.press("Home");
  await waitMet(page, 0);
  await page.keyboard.press("End");
  await waitMet(page, 240);
  out.end = await met(page);
  await context.close();
  return out;
}

async function phone(browser, base) {
  const { context, page, errors } = await open(browser, base,
    { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const out = { errors };
  const n = 240;
  out.keysHintShown = await page.locator("#keys").isVisible();
  out.sideScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const [v, s] = [await box(page, "verdict"), await box(page, "summary")];
  out.fixedBlock = (await box(page, "scene-col")).h;
  out.summaryUnderVerdict = v.y + v.h <= s.y;
  const strip = await box(page, "overview");
  const y = strip.y + strip.h / 2;
  await page.touchscreen.tap(await stripX(page, 96, n), y);
  await waitMet(page, 96);
  out.stripTap = { met: await met(page), marker: await markerHours(page, n) };

  // a finger dragged along the strip
  const cdp = await context.newCDPSession(page);
  const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", await stripX(page, 96, n));
  const seen = [];
  for (const h of [110, 130, 150, 170]) {
    await touch("touchMove", await stripX(page, h, n));
    await waitMet(page, h);
    seen.push(await met(page));
  }
  await touch("touchEnd");
  out.stripDrag = seen;

  // a tap on an hour of the flight plan, 10 hours below the edge of the fixed block
  const fixed = await box(page, "scene-col");
  await page.touchscreen.tap(180, fixed.y + fixed.h + 6 * 10);
  await waitMet(page, 180);
  out.rowTap = { met: await met(page), marker: await markerHours(page, n), label: await page.textContent("#met") };

  // a finger scrolling the page moves the same cursor: 120 px up is 20 hours on
  const finger = (type, fy) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 180, y: fy }] });
  const from = fixed.y + fixed.h + 130, before = await page.evaluate(() => window.scrollY);
  await finger("touchStart", from);
  for (let k = 1; k <= 12; k++) { await finger("touchMove", from - 10 * k); await page.waitForTimeout(16); }
  await finger("touchEnd");
  await page.waitForTimeout(400);
  out.fingerScrolledPx = (await page.evaluate(() => window.scrollY)) - before;
  out.afterScroll = { met: await met(page), marker: await markerHours(page, n) };
  await context.close();
  return out;
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const result = { desktop: await desktop(browser, base), phone: await phone(browser, base) };
  await browser.close();
  server.close();
  process.stdout.write(JSON.stringify(result, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
