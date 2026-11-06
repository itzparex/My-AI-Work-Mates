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
  "#/ceo/decisions", "#/ceo/projects", "#/ceo/claude", "#/ceo/issues", "#/ceo/data",
  "#/director/timeline", "#/director/review", "#/director/lessons",
  "#/research/overview", "#/research/briefs", "#/research/questions", "#/research/documents", "#/research/documents/none", "#/research/booklet", "#/research/evidence", "#/research/persontasks",
  "#/copy/overview", "#/copy/copymaps", "#/copy/claims", "#/copy/images", "#/copy/swipe",
  "#/uiux/research", "#/uiux/concepts", "#/uiux/studio", "#/uiux/library", "#/uiux/theme",
  "#/graphic/overview", "#/graphic/carousel", "#/graphic/images", "#/graphic/aiimages", "#/graphic/assets",
  "#/shopify/overview", "#/shopify/builds", "#/shopify/builds/none", "#/shopify/qa", "#/shopify/backups", "#/shopify/handover"];
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
  { // shared data model (2a): built from the saved data, old data untouched, backup kept, checks pass
    const page = await browser.newPage(); page.on("pageerror", e => errors.push("data model: " + e.message));
    await page.goto(base + "index.html#/ceo/home"); await page.waitForTimeout(1500);
    await page.goto(base + "index.html#/copy/copymaps"); await page.waitForTimeout(1200);
    const r = await page.evaluate(() => { const hqBefore = localStorage.getItem("facelove-hq-v1"); const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const m = D.migrate("manual");
      return { hqSame: hqBefore === localStorage.getItem("facelove-hq-v1"), counts: m.meta.counts, backup: !!D.backupInfo(), bad: D.check(m).filter(c => c[0] === "bad").map(c => c[1]), taskIds: m.tasks.every(t => t.id && t.project) }; });
    if (!r.hqSame) errors.push("data model: changed the old saved data");
    if (!r.backup) errors.push("data model: no backup of the old saved data");
    if (r.counts.projects < 2 || r.counts.tasks < 20 || r.counts.decisions < 3 || r.counts.issues < 2 || r.counts.lessons < 1) errors.push("data model: missing items " + JSON.stringify(r.counts));
    if (r.bad.length) errors.push("data model: checks failed: " + r.bad.join("; "));
    if (!r.taskIds) errors.push("data model: a task has no ID or project");
    const live = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA; const k = "mawm-dept-copy", old = W.localStorage.getItem(k);
      const o = JSON.parse(old || "null") || { rows: {}, checks: {} }; o.rows.copymaps = (o.rows.copymaps || []).concat([{ _id: "smoke1", project: "FL-PDP", page: "Product page", version: "2", status: "In progress" }]);
      W.localStorage.setItem(k, JSON.stringify(o)); await new Promise(r => setTimeout(r, 700)); const d = D.load().deliverables.find(x => x.id === "copy:copymaps:smoke1");
      if (old == null) W.localStorage.removeItem(k); else W.localStorage.setItem(k, old); return d ? d.kind + " · " + d.title + " · " + d.project : null; });
    if (live !== "Copy map · Product page copy map v2 · FL-PDP") errors.push("data model: a saved copy map didn't reach the model (" + live + ")");
    // 2a-ii: the CEO page reads the model and saves through it (old key kept current); a decision lands in the decided history
    const rt = await page.evaluate(() => { const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const S = D.readHq(), old = JSON.parse(localStorage.getItem("facelove-hq-v1"));
      const norm = o => JSON.stringify(o, (k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce((r, x) => (r[x] = v[x], r), {}) : v);
      const strip = o => Object.assign({}, o, { decided: o.decided || [] });
      return { same: norm(strip(S)) === norm(strip(old)), projects: S.projects.length, tasks: S.projects.reduce((n, p) => n + p.tasks.length, 0) }; });
    if (!rt.same) errors.push("data model: the CEO page's data doesn't read back from the model exactly as saved");
    await page.goto(base + "index.html#/ceo/decisions"); await page.waitForTimeout(1200);
    const dec = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document; const before = W.MAWM_DATA.load().decisions.filter(x => x.status === "Waiting on CEO").length;
      const card = d.querySelector("#decisions [data-id]"); if (!card) return "no decision card"; const title = card.querySelector("b").textContent; card.querySelector('[data-dec="disallow"]').click(); await new Promise(r => setTimeout(r, 300));
      const m = W.MAWM_DATA.load(), old = JSON.parse(W.localStorage.getItem("facelove-hq-v1")); const got = m.decisions.find(x => x.status === "Decided" && x.title === title && x.result === "Disallowed" && x.from !== "issues");
      if (!got) return "decision not in the decided history"; if (m.decisions.filter(x => x.status === "Waiting on CEO").length !== before - 1) return "still waiting in the model";
      if (!old.decided.some(x => x.title === title) || old.decisions.some(x => x.title === title)) return "old key not kept current"; if (!m.issues.some(i => i.id === got.issue)) return "decision not linked to the issues log";
      if (m.decisions.filter(x => x.issue === got.issue).length !== 1) return "decision counted twice"; if (!d.querySelector(".dhist")) return "decided history not shown"; return "ok"; });
    if (dec !== "ok") errors.push("data model: CEO decision: " + dec);
    console.log("OK: data model " + JSON.stringify(r.counts) + ", CEO page reads it back (" + rt.projects + " projects, " + rt.tasks + " tasks), decision recorded");
    await page.close();
  }
  await browser.close(); server.close();
  try { console.log("OK: " + await require("./desktop")()); } catch (e) { errors.push("desktop: " + (e.stack || e)); }
  try { console.log("OK: " + await require("./updater")()); } catch (e) { errors.push("updater: " + (e.stack || e)); }
  if (errors.length) { console.error("FAILED\n" + errors.join("\n")); process.exit(1); }
  console.log(`OK: ${ROUTES.length} pages × 2 screen sizes, no errors`);
})();
