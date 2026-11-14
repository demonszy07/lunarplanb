// Opens the published folder (dist/) in a real browser and reports what the
// page shows. Used by tests/test_page.py to compare with the Python reference.
// usage: node tests/check_page.cjs [screenshot folder]
// stdout: {"values": {key: value}, "loadingTextSeen": true, "downloads": [{url, bytes}], "totalBytes": n}
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
                ".bin": "application/octet-stream" };

const server = http.createServer((req, res) => {
  let file = decodeURIComponent(req.url.split("?")[0]);
  if (file.endsWith("/")) file += "index.html";
  const full = path.join(root, file);
  if (!full.startsWith(root) || !fs.existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(full)] || "application/octet-stream" });
  res.end(fs.readFileSync(full));
});

(async () => {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 });

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
  const statusWhileLoading = await page.textContent("#status");
  const tableWhileLoading = await page.locator("table").count();

  await page.waitForSelector("html[data-ready=yes]", { timeout: 15000 });
  const values = await page.$$eval("td[data-key]", (cells) =>
    Object.fromEntries(cells.map((c) => [c.dataset.key, JSON.parse(c.dataset.value)])));
  const text = await page.$$eval("tr", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  const sentence = await page.textContent("#plan p");
  const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  const shots = process.argv[2];
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, "page_360.png"), fullPage: true });
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.screenshot({ path: path.join(shots, "page_1100.png"), fullPage: true });
  }
  await browser.close();
  server.close();
  process.stdout.write(JSON.stringify({
    values, text, sentence, errors, sideScrollAt360: sideScroll,
    loadingTextSeen: statusWhileLoading.trim() === "Loading sky data" && tableWhileLoading === 0,
    downloads, totalBytes: downloads.reduce((sum, d) => sum + d.bytes, 0),
  }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
