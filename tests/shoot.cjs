// Takes screenshots of the published folder (dist/) in a real browser.
// usage: node tests/shoot.cjs <out folder> [met hours] [name suffix]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
                ".css": "text/css", ".woff2": "font/woff2", ".bin": "application/octet-stream",
                ".jpg": "image/jpeg", ".png": "image/png" };

function serve() {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split("?")[0]);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(full)] || "application/octet-stream" });
    res.end(fs.readFileSync(full));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}
module.exports = { serve };

if (require.main === module) (async () => {
  const out = process.argv[2], met = Number(process.argv[3] || 0), suffix = process.argv[4] || "";
  fs.mkdirSync(out, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 360, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(base);
    await page.waitForSelector("html[data-ready]", { timeout: 20000 });
    await page.waitForSelector("html[data-stage^=sky]", { timeout: 20000 }).catch(() => {});
    if (process.env.SHOOT_SET) {
      // e.g. SHOOT_SET='a-date=2027-04-02T00:00,a-height=5' changes the plan before the picture
      const before = await page.evaluate(() => document.documentElement.dataset.ready);
      for (const pair of process.env.SHOOT_SET.split(",")) {
        const [id, value] = pair.split("=");
        await page.evaluate(([i, v]) => {
          const node = document.getElementById(i);
          node.value = v;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }, [id, value]);
      }
      if (/(^|,)[ab]-/.test(process.env.SHOOT_SET)) {
        await page.waitForFunction((b) => document.documentElement.dataset.ready !== b, before);
      }
    }
    if (met > 0) {
      await page.keyboard.press("Home");
      for (let d = 0; d < Math.floor(met / 24); d++) await page.keyboard.press("Shift+ArrowRight");
      for (let h = 0; h < met % 24; h++) await page.keyboard.press("ArrowRight");
      await page.waitForFunction((m) => document.documentElement.dataset.met === String(m), met);
    }
    if (process.env.SHOOT_CLICK && await page.locator(process.env.SHOOT_CLICK).isVisible()) {
      await page.click(process.env.SHOOT_CLICK);        // e.g. SHOOT_CLICK='#notes-toggle'
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}${suffix}.png`) });
    const info = await page.evaluate(() => ({
      met: document.documentElement.dataset.met,
      sideScroll: document.documentElement.scrollWidth > window.innerWidth,
      verdict: document.getElementById("verdict").textContent,
      a: document.getElementById("count-a").textContent, b: document.getElementById("count-b").textContent,
      stretch: document.getElementById("stretch-a").textContent,
    }));
    console.log(name, JSON.stringify(info), errors.length ? "ERRORS " + errors.join(" | ") : "no errors");
    await page.close();
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
