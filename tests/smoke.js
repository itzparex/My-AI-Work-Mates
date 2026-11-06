// Smoke test: loads every page of the app on desktop and phone and fails on any page error.
// Run from the repo root: node tests/smoke.js   (needs Playwright with Chromium)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".md": "text/markdown", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
const ROUTES = ["#/home", "#/ceo/home",
  "#/ceo/decisions", "#/ceo/projects", "#/ceo/claude", "#/ceo/issues",
  "#/director/timeline", "#/director/review", "#/director/lessons",
  "#/research/overview", "#/research/briefs", "#/research/questions", "#/research/documents", "#/research/documents/none", "#/research/booklet", "#/research/evidence", "#/research/persontasks",
  "#/copy/overview", "#/copy/copymaps", "#/copy/claims", "#/copy/images", "#/copy/swipe",
  "#/uiux/research", "#/uiux/concepts", "#/uiux/studio", "#/uiux/library", "#/uiux/theme",
  "#/graphic/overview", "#/graphic/carousel", "#/graphic/images", "#/graphic/aiimages", "#/graphic/assets",
  "#/shopify/overview", "#/shopify/builds", "#/shopify/builds/none", "#/shopify/qa", "#/shopify/backups"];
(async () => {
  await new Promise(r => server.listen(0, r)); const base = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch(); const errors = [];
  const shots = process.argv.includes("--shots"); if (shots) fs.mkdirSync(path.join(ROOT, "tests", "shots"), { recursive: true });
  for (const [label, vp] of [["desktop", { width: 1280, height: 860 }], ["phone", { width: 390, height: 800 }]]) {
    const page = await browser.newPage({ viewport: vp });
    page.on("pageerror", e => errors.push(`${label} ${page.url()}: ${e.message}`));
    page.on("frameattached", f => {});
    await page.goto(base); await page.waitForTimeout(1200);
    for (const r of ROUTES) {
      await page.goto(base + "index.html" + r); await page.waitForTimeout(r.startsWith("#/uiux") ? 1800 : 700);
      const visible = await page.evaluate(() => { const f = document.getElementById("frame"); return f.hidden || !!(f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText.trim().length > 20); });
      if (!visible) errors.push(`${label} ${r}: page looks empty`);
      if (shots) await page.screenshot({ path: path.join(ROOT, "tests", "shots", `${label}-${r.replace(/[#/]+/g, "-").replace(/^-/, "")}.png`) });
    }
    await page.close();
  }
  await browser.close(); server.close();
  try { console.log("OK: " + await require("./desktop")()); } catch (e) { errors.push("desktop: " + (e.stack || e)); }
  try { console.log("OK: " + await require("./updater")()); } catch (e) { errors.push("updater: " + (e.stack || e)); }
  if (errors.length) { console.error("FAILED\n" + errors.join("\n")); process.exit(1); }
  console.log(`OK: ${ROUTES.length} pages × 2 screen sizes, no errors`);
})();
