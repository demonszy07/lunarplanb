// Opens the published folder (dist/) in a real browser and reports what the
// page shows. Used by tests/test_page.py to compare with the Python reference.
// stdout: JSON with the summary values, what was seen while loading, the
// downloads, and what the arrow keys did.
const { chromium } = require("playwright");
const { serve } = require("./shoot.cjs");

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });

  const downloads = [];
  page.on("response", async (response) => {
    const body = await response.body().catch(() => Buffer.alloc(0));
    downloads.push({ url: response.url().replace(base, ""), status: response.status(), bytes: body.length });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // Hold the data files back for a moment to see what the page shows meanwhile.
  await page.route("**/data/**", async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const statusWhileLoading = (await page.textContent("#status")).trim();
  const sentenceWhileLoading = (await page.locator(".view-a .sentence").innerText()).replace(/\s+/g, " ");
  const tableWhileLoading = await page.locator("table").count();

  await page.waitForSelector("html[data-ready]", { timeout: 20000 });
  // The real sky (stars, Earth's picture) loads last, piece by piece. Everything
  // answered up to and including the lit ground is the first load.
  await page.waitForSelector("html[data-stage=sky]", { timeout: 20000 });
  await page.waitForTimeout(200);
  const cut = downloads.findIndex((d) => d.url.endsWith("site01_view.bin")) + 1;
  const firstLoad = downloads.slice(0, cut);
  const firstLoadBytes = firstLoad.reduce((sum, d) => sum + d.bytes, 0);
  const skyLoad = downloads.slice(cut).map((d) => d.url);
  const fullBytes = downloads.reduce((sum, d) => sum + d.bytes, 0);
  const afterSky = downloads.length;
  const starsWithEye = await page.evaluate(() => document.documentElement.dataset.stars);
  await page.click("#notes-toggle");
  await page.selectOption("#seen-by", "camera");
  await page.waitForTimeout(100);
  const starsWithCamera = await page.evaluate(() => document.documentElement.dataset.stars);
  const cameraNote = await page.textContent("#seen-note");
  await page.selectOption("#seen-by", "eye");
  await page.click("#notes-toggle");

  const values = await page.$$eval("td[data-key]", (cells) =>
    Object.fromEntries(cells.map((c) => [c.dataset.key, JSON.parse(c.dataset.value)])));
  const verdict = await page.textContent("#verdict");
  const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  // narrow screen: one line over the sky; the "i" button opens the other notes
  const topLineHeight = await page.evaluate(() => document.getElementById("stretch-a").getBoundingClientRect().height);
  const lookBefore = await page.locator("#look").isVisible();
  await page.click("#notes-toggle");
  const lookShown = await page.locator("#look").isVisible();
  const seenShown = await page.locator("#seen-by").isVisible();
  await page.click("#notes-toggle");
  const lookAfter = await page.locator("#look").isVisible();

  // the arrow keys move the clock: three hours, then a day
  const met = async () => Number(await page.evaluate(() => document.documentElement.dataset.met));
  const waitMet = (m) => page.waitForFunction((x) => document.documentElement.dataset.met === String(x), m);
  const steps = [await met()];
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await waitMet(3); steps.push(await met());
  await page.keyboard.press("Shift+ArrowRight");
  await waitMet(27); steps.push(await met());
  const at27 = { a: await page.textContent("#count-a"), b: await page.textContent("#count-b"),
                 whenA: await page.textContent("#when-a"), label: await page.textContent("#met") };
  await page.keyboard.press("ArrowLeft");
  await waitMet(26); steps.push(await met());
  await page.keyboard.press("End");
  await waitMet(240); steps.push(await met());
  await page.keyboard.press("Home");
  await waitMet(0); steps.push(await met());

  // the block above the flight plan keeps its height whatever it says
  const blockHeights = [];
  for (const key of ["Home", "End"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    blockHeights.push(await page.evaluate(() => document.getElementById("scene-col").getBoundingClientRect().height));
  }
  await page.keyboard.press("Home");
  await waitMet(0);

  // a plan change: panels at 5 m loads one more site file and removes the note
  const noteAt2m = await page.locator("#low-note").isVisible();
  await page.selectOption("#a-height", "5");
  await page.waitForFunction(() => document.querySelector("#low-note").hidden);
  for (let i = 0; i < 50 && !downloads.some((d) => d.url.endsWith("site01_5m_view.bin")); i++) await page.waitForTimeout(100);
  const values5m = await page.$$eval("td[data-key]", (cells) =>
    Object.fromEntries(cells.map((c) => [c.dataset.key, JSON.parse(c.dataset.value)])));

  await browser.close();
  server.close();
  process.stdout.write(JSON.stringify({
    values, values5m, verdict, errors, sideScrollAt360: sideScroll, lookShown, seenShown, lookBefore, lookAfter,
    topLineHeight, blockHeights, steps, at27, noteAt2m,
    loadingTextSeen: statusWhileLoading === "Loading sky data" && tableWhileLoading === 0,
    sentenceWhileLoading, firstLoad, firstLoadBytes, skyLoad, fullBytes,
    starsWithEye, starsWithCamera, cameraNote,
    laterDownloads: downloads.slice(afterSky).map((d) => d.url),
  }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
