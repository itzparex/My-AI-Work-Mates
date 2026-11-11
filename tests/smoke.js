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
    const ctx = await browser.newContext(), page = await ctx.newPage(); page.on("pageerror", e => errors.push("data model: " + e.message));
    /* a device with data saved before the shared model: the Copywriter's old key holds a copy map */
    const LEGACY = JSON.stringify({ rows: { copymaps: [{ _id: "legacy1", project: "FL-PDP", page: "Legacy page", version: "1", status: "Draft" }] }, checks: {} });
    await page.goto(base + "manifest.webmanifest"); await page.evaluate(v => localStorage.setItem("mawm-dept-copy", v), LEGACY);
    await page.goto(base + "index.html#/ceo/home"); await page.waitForTimeout(1500);
    await page.goto(base + "index.html#/copy/copymaps"); await page.waitForTimeout(1200);
    const r = await page.evaluate(() => { const hqBefore = localStorage.getItem("facelove-hq-v1"); const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const m = D.migrate("manual");
      return { hqSame: hqBefore === localStorage.getItem("facelove-hq-v1"), counts: m.meta.counts, backup: !!D.backupInfo(), bad: D.check(m).filter(c => c[0] === "bad").map(c => c[1]), taskIds: m.tasks.every(t => t.id && t.project) }; });
    if (!r.hqSame) errors.push("data model: changed the old saved data");
    if (!r.backup) errors.push("data model: no backup of the old saved data");
    if (r.counts.projects < 2 || r.counts.tasks < 20 || r.counts.decisions < 3 || r.counts.issues < 2 || r.counts.lessons < 1) errors.push("data model: missing items " + JSON.stringify(r.counts));
    if (r.bad.length) errors.push("data model: checks failed: " + r.bad.join("; "));
    if (!r.taskIds) errors.push("data model: a task has no ID or project");
    const live = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA; const k = "mawm-dept-copy", oldKey = W.localStorage.getItem(k), part = D.page(k);
      const o = JSON.parse(JSON.stringify(part || { rows: {}, checks: {} })); o.rows.copymaps = (o.rows.copymaps || []).concat([{ _id: "smoke1", project: "FL-PDP", page: "Product page", version: "2", status: "In progress" }]);
      W.localStorage.setItem(k, JSON.stringify(o)); /* code saving the old way goes into the model; the old key stays as it was */
      const d = D.load().deliverables.find(x => x.id === "copy:copymaps:smoke1"), keySame = W.localStorage.getItem(k) === oldKey;
      D.savePart(k, part); return (d ? d.kind + " · " + d.title + " · " + d.project : null) + (keySame ? "" : " (old key written)"); });
    if (live !== "Copy map · Product page copy map v2 · FL-PDP") errors.push("data model: a saved copy map didn't reach the model (" + live + ")");
    // 2a-ii: the CEO page reads the model and saves through it (old key kept current); a decision lands in the decided history
    const rt = await page.evaluate(() => { const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const S = D.readHq(); D.writeHq(S); const back = D.readHq();
      const norm = o => JSON.stringify(o, (k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce((r, x) => (r[x] = v[x], r), {}) : v);
      return { same: norm(S) === norm(back), projects: S.projects.length, tasks: S.projects.reduce((n, p) => n + p.tasks.length, 0) }; });
    if (!rt.same) errors.push("data model: the CEO page's data doesn't read back from the model exactly as saved");
    await page.goto(base + "index.html#/ceo/decisions"); await page.waitForTimeout(1200);
    const dec = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document; const before = W.MAWM_DATA.load().decisions.filter(x => x.status === "Waiting on CEO").length;
      const card = d.querySelector("#decisions [data-id]"); if (!card) return "no decision card"; const title = card.querySelector("b").textContent; card.querySelector('[data-dec="disallow"]').click(); await new Promise(r => setTimeout(r, 300));
      const m = W.MAWM_DATA.load(), old = W.localStorage.getItem("facelove-hq-v1"); const got = m.decisions.find(x => x.status === "Decided" && x.title === title && x.result === "Disallowed" && x.from !== "issues");
      if (!got) return "decision not in the decided history"; if (m.decisions.filter(x => x.status === "Waiting on CEO").length !== before - 1) return "still waiting in the model";
      if (old !== null) return "the old key was written"; if (!m.issues.some(i => i.id === got.issue)) return "decision not linked to the issues log";
      if (m.decisions.filter(x => x.issue === got.issue).length !== 1) return "decision counted twice"; if (!d.querySelector(".dhist")) return "decided history not shown"; return "ok"; });
    if (dec !== "ok") errors.push("data model: CEO decision: " + dec);
    // 2a-iii: department pages log through the model (one helper), read their decisions from it, and save their deliverables through it
    if (/setItem\(\s*["']facelove-hq-v1/.test(fs.readFileSync(path.join(ROOT, "dept.html"), "utf8"))) errors.push("data model: dept.html still writes the CEO's saved data directly");
    await page.goto(base + "index.html#/shopify/overview"); await page.waitForTimeout(1200);
    const dp = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA, d = W.document;
      const n0 = D.load().issues.length, r = D.report({ dept: "Shopify Developer", project: "FL-PDP", issue: { what: "Smoke: stop and ask", type: "Override request", status: "Waiting on CEO", decision: "Waiting on CEO" }, decision: { type: "Override", title: "Smoke: guardrail question", detail: "Test", rec: "Test", build: { dept: "shopify", row: "x" } } });
      if (r.error) return "report failed: " + r.error; const m = D.load(), old = W.localStorage.getItem("facelove-hq-v1");
      if (m.issues.length !== n0 + 1 || !m.issues.some(i => i.id === r.id && i.dept === "Shopify Developer")) return "issue not in the model";
      if (old !== null) return "the old key was written";
      if (!m.decisions.some(x => x.id === r.decision && x.status === "Waiting on CEO" && x.dept === "Shopify Developer")) return "decision not waiting in the model";
      const v = D.deptView("Shopify Developer"); if (!v.waiting.some(x => x.id === r.decision)) return "department view misses its decision"; if (D.deptView("Copywriter").waiting.some(x => x.id === r.decision)) return "decision shown to the wrong department";
      W.location.reload(); await new Promise(res => setTimeout(res, 900)); const d2 = document.getElementById("frame").contentWindow.document;
      if (!d2.querySelector("#pdcard") || !d2.querySelector("#pdcard").textContent.includes("Smoke: guardrail question")) return "overview doesn't show the decision";
      const D2 = document.getElementById("frame").contentWindow.MAWM_DATA, k = "mawm-dept-shopify", before = D2.page(k), o = JSON.parse(JSON.stringify(before || { rows: {}, checks: {} }));
      o.rows.builds = (o.rows.builds || []).concat([{ _id: "smoke2", project: "FL-PDP", theme: "FL-PDP build smoke", status: "In progress" }]); const e = D2.saveDept(k, o); D2.flush();
      const got = D2.load().deliverables.some(x => x.id === "shopify:builds:smoke2") && D2.page(k).rows.builds.some(x => x._id === "smoke2"); const keyNull = document.getElementById("frame").contentWindow.localStorage.getItem(k) === null; D2.savePart(k, before);
      if (!keyNull) return "the old key was written";
      return e ? "saveDept: " + e : got ? "ok" : "a saved build didn't reach the model"; });
    if (dp !== "ok") errors.push("data model: department page: " + dp);
    // 2a-iv: the Design Studio links concepts and Code Studio items to projects through the model
    await page.goto(base + "index.html#/uiux/concepts"); await page.waitForTimeout(1800);
    const ds = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document, D = W.MAWM_DATA, k = D.STUDIO, before = D.page(k), wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        if (![...d.querySelectorAll("#bproj option")].some(o => o.value === "FL-PDP")) return "project filter has no FL-PDP";
        d.getElementById("addCon").click(); const sel = d.getElementById("cf-project"); if (![...sel.options].some(o => o.value === "FL-PDP")) return "concept form has no project list";
        sel.value = "FL-PDP"; d.getElementById("cf-name").value = "Smoke concept"; d.getElementById("cfSave").click(); await wait(100);
        const c = D.studio().concepts.find(x => x.name === "Smoke concept"); if (!c || c.project !== "FL-PDP") return "concept not linked to the project";
        d.querySelector(`[data-mv="${c.id}"][data-d="1"]`).click(); D.flush(); await wait(50);
        const dl = D.load().deliverables.find(x => x.id === "uiux:concepts:" + c.id); if (!dl || dl.project !== "FL-PDP") return "linked concept not in the model with its project";
        if (!D.studioFor("concepts", "FL-PDP").some(x => x.id === c.id) || D.studioFor("concepts", "FL-OTHER").some(x => x.id === c.id)) return "studioFor doesn't keep the concept to its project";
        d.querySelector(`[data-build="${c.id}"]`).click(); await wait(300); if (d.getElementById("s-project").value !== "FL-PDP") return "Code Studio didn't carry the concept's project";
        d.getElementById("save").click(); await wait(100); D.flush(); const it = D.studio().items.find(x => x.name === "Smoke concept");
        if (!it || it.project !== "FL-PDP" || it.concept !== c.id) return "Code Studio item not linked to the project and concept";
        const di = D.load().deliverables.find(x => x.id === "uiux:items:" + it.id); if (!di || di.project !== "FL-PDP" || di.from !== "uiux:concepts:" + c.id) return "Code Studio item not in the model with its project";
        if (W.localStorage.getItem(k) !== null) return "the old key was written";
        return "ok";
      } finally { D.savePart(k, before) } });
    if (ds !== "ok") errors.push("data model: Design Studio: " + ds);
    if (/localStorage\.setItem\(\s*["']facelove-studio/.test(fs.readFileSync(path.join(ROOT, "dept.html"), "utf8") + fs.readFileSync(path.join(ROOT, "studio.html"), "utf8"))) errors.push("data model: a page still writes the Design Studio's saved data directly");
    // 2a-iv-b: the old keys are retired: no page writes them; an old key written by an older page version is taken into the model
    for (const [f, re] of [["hq.html", /localStorage\.setItem\(\s*KEY\s*,/], ["dept.html", /localStorage\.setItem\(\s*(KEY|["']mawm-dept|["']facelove)/], ["studio.html", /localStorage\.setItem\(\s*(KEY\s*,|["']facelove-studio)/]]) if (re.test(fs.readFileSync(path.join(ROOT, f), "utf8"))) errors.push("data model: " + f + " still writes an old saved key");
    const ret = await page.evaluate(LEGACY => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA, r = D.retired();
      if (!r) return "old keys not retired"; if (W.localStorage.getItem("mawm-dept-copy") !== LEGACY) return "the Copywriter's old key changed"; if (!D.load().deliverables.some(x => x.id === "copy:copymaps:legacy1")) return "old saved copy map not in the model";
      const written = D.SOURCES.map(s => s[0]).filter(k => k !== "mawm-dept-copy" && W.localStorage.getItem(k) !== null); if (written.length) return "old keys written: " + written.join(", ");
      if (!D.check().some(c => c[0] === "ok" && /old keys are read-only backups/.test(c[1]))) return "check doesn't confirm the retirement"; return "ok"; }, LEGACY);
    if (ret !== "ok") errors.push("data model: retirement: " + ret);
    await page.goto(base + "index.html#/ceo/data"); await page.waitForTimeout(1200);
    const ctxPage = await ctx.newPage(); await ctxPage.goto(base + "manifest.webmanifest"); /* same site, no data.js: stands in for a tab left open from an older version */
    await ctxPage.evaluate(() => localStorage.setItem("mawm-dept-graphic", JSON.stringify({ rows: { images: [{ _id: "stale1", project: "FL-PDP", set: "Stale tab set", status: "Draft" }] }, checks: {} })));
    const ad = await page.evaluate(() => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA; D.migrate("load"); const m = D.load();
      if (!m.deliverables.some(x => x.id === "graphic:images:stale1")) return "newer data in an old key wasn't taken in"; if (!D.page("mawm-dept-graphic").rows.images.some(x => x._id === "stale1")) return "not in the model's pages";
      if (!/older version/.test(m.meta.log.map(l => l[1]).join(" "))) return "not logged"; if (!D.check().some(c => c[0] === "warn" && /older version of a page/.test(c[1]))) return "check doesn't warn"; return "ok"; });
    if (ad !== "ok") errors.push("data model: older page wrote an old key: " + ad);
    await ctxPage.close();
    // 2b-i: a department submits a deliverable from its Overview; its task waits in the Project Director's review queue with it
    await page.goto(base + "index.html#/graphic/overview"); await page.waitForTimeout(1200);
    const sb = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA, k = "mawm-dept-graphic", before = D.page(k), hqBefore = D.readHq(), wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const o = JSON.parse(JSON.stringify(before || { rows: {}, checks: {} })); o.rows.images = (o.rows.images || []).concat([{ _id: "smoke3", project: "FL-PDP", set: "Smoke image set", status: "In progress" }]); D.saveDept(k, o);
        W.location.reload(); await wait(900); const W2 = document.getElementById("frame").contentWindow, d = W2.document, D2 = W2.MAWM_DATA;
        const btn = d.querySelector('[data-sub="smoke3"]'); if (!btn) return "no Submit button for the image set";
        d.querySelector('[data-sn="smoke3"]').value = "Smoke note"; btn.click(); await wait(200);
        const t = D2.readHq().projects.find(p => p.code === "FL-PDP").tasks.find(x => x.submission && x.submission.id === "graphic:images:smoke3");
        if (!t) return "submission not on a task"; if (t.status !== "Waiting on approval" || !/image/i.test(t.name) || t.submission.note !== "Smoke note") return "wrong task or status: " + t.name + " " + t.status;
        if (D2.page(k).rows.images.find(x => x._id === "smoke3").status !== "Waiting on approval") return "image set status not updated";
        if (!d.querySelector("#submit") || !/With the Project Director/.test(d.querySelector("#submit ~ .sublist").textContent)) return "Overview doesn't show it with the Project Director";
        if (!D2.submit({ dept: "Graphic Designer", project: "FL-PDP", deliv: { id: "graphic:images:smoke3", kind: "Image set" } }).error) return "a second submit of the same deliverable wasn't refused";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (sb !== "ok") errors.push("deliverables flow: submit: " + sb);
    await page.goto(base + "index.html#/director/review"); await page.waitForTimeout(1200);
    const rq = await page.evaluate(() => { const W = document.getElementById("frame").contentWindow, d = W.document, card = [...d.querySelectorAll("[data-tid]")].find(c => /Smoke image set/.test(c.textContent));
      return !card ? "review queue doesn't show the submitted image set" : !/Smoke note/.test(card.textContent) || !card.querySelector(".subm a") ? "review card misses the note or link" : "ok"; });
    if (rq !== "ok") errors.push("deliverables flow: review queue: " + rq);
    // 2b-ii: approve from the review queue: task Done, deliverable Approved; on a fresh timeline the next tasks start and the next department sees it
    const ap = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const card = [...d.querySelectorAll("[data-tid]")].find(c => /Smoke image set/.test(c.textContent)); card.querySelector('[data-rv="ok"]').click(); await wait(200);
        const t = D.readHq().projects.find(p => p.code === "FL-PDP").tasks.find(x => x.submission && x.submission.id === "graphic:images:smoke3");
        if (t.status !== "Done" || t.submission.state !== "Approved") return "task not Done or submission not Approved";
        if (D.page("mawm-dept-graphic").rows.images.find(x => x._id === "smoke3").status !== "Approved") return "image set not marked Approved";
        const S = D.readHq(), base = S.projects.find(p => p.code === "FL-COL"), tasks = JSON.parse(JSON.stringify(base.tasks)).map((x, i) => Object.assign(x, { id: "SM-2B-" + String(i + 1).padStart(2, "0"), status: i < 2 ? "Done" : "Not started", submission: undefined }));
        tasks[2].status = "Waiting on approval"; tasks[2].submission = { id: "copy:copymaps:none", kind: "Copy map", title: "Smoke copy map", dept: "Copywriter", at: "2026-11-11" };
        S.projects.push({ code: "SM-2B", name: "Smoke 2b", status: "Active", tasks }); D.writeHq(S);
        const res = D.approve("SM-2B", "SM-2B-03"); if (res.error) return "approve failed: " + res.error;
        const ids = res.started.map(x => x.id).join(","); if (ids !== "SM-2B-04,SM-2B-05") return "wrong next tasks started: " + ids;
        const p2 = D.readHq().projects.find(p => p.code === "SM-2B"); if (p2.tasks[5].status !== "Not started") return "Design approval started too early";
        if (!D.inputsFor("Graphic Designer").some(i => i.title === "Smoke copy map")) return "next department doesn't get the input";
        if (!D.approve("SM-2B", "SM-2B-03").error) return "a second approve wasn't refused";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (ap !== "ok") errors.push("deliverables flow: approve: " + ap);
    await page.goto(base + "index.html#/graphic/overview"); await page.waitForTimeout(1200);
    const inp = await page.evaluate(() => { const d = document.getElementById("frame").contentWindow.document, el = d.querySelector("#inputs"); return el && /Smoke copy map/.test(el.nextElementSibling.nextElementSibling.textContent) ? "ok" : "Graphic Designer Overview doesn't show the approved copy map"; });
    if (inp !== "ok") errors.push("deliverables flow: inputs: " + inp);
    if (shots) await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-inputs-desktop.png"), fullPage: true });
    await page.goto(base + "index.html#/uiux/research"); await page.waitForTimeout(1200);
    const sin = await page.evaluate(() => { const el = document.getElementById("frame").contentWindow.document.querySelector("#inputs"); return el && !el.hidden && /Smoke copy map/.test(el.textContent) ? "ok" : "Design Studio doesn't show the approved copy map"; });
    if (sin !== "ok") errors.push("deliverables flow: studio inputs: " + sin);
    // 2b-iii: return with comments from the review queue: task back to In progress, deliverable Returned, issue logged; a second return is flagged
    await page.goto(base + "index.html#/director/review"); await page.waitForTimeout(400);
    const rt0 = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const k = "mawm-dept-graphic", c = D.page(k) || { rows: {}, checks: {} }; c.rows.images = (c.rows.images || []).concat([{ _id: "smoke4", project: "SM-2B", set: "Smoke return set", status: "In progress" }]); D.savePart(k, c);
        const sres = D.submit({ dept: "Graphic Designer", project: "SM-2B", deliv: { id: "graphic:images:smoke4", kind: "Image set", title: "Smoke return set", section: "images", row: "smoke4" } }); if (sres.error) return "submit failed: " + sres.error;
        W.location.reload(); await wait(900); const W2 = document.getElementById("frame").contentWindow, d = W2.document, D2 = W2.MAWM_DATA;
        const card = [...d.querySelectorAll("[data-tid]")].find(x => /Smoke return set/.test(x.textContent)); if (!card) return "review queue doesn't show the set";
        card.querySelector('[data-rv="back"]').click(); await wait(100); const box = card.querySelector(".inline-input"); if (!box) return "no comment box";
        box.querySelector("button").click(); await wait(100); if (D2.readHq().projects.find(p => p.code === "SM-2B").tasks.find(x => x.id === sres.task).status !== "Waiting on approval") return "returned without a comment";
        box.querySelector("input").value = "Slide 2 headline must match the copy map"; box.querySelector("button").click(); await wait(200);
        let S = D2.readHq(), t = S.projects.find(p => p.code === "SM-2B").tasks.find(x => x.id === sres.task);
        if (t.status !== "In progress" || t.submission.state !== "Returned" || t.submission.comments !== "Slide 2 headline must match the copy map" || t.returns !== 1) return "task not returned properly: " + t.status + " " + t.submission.state;
        const i1 = S.issues.find(x => x.id === t.submission.issue); if (!i1 || !/^Returned:/.test(i1.what) || i1.dept !== "Graphic Designer" || i1.sev !== "Low") return "issue not logged";
        if (D2.page(k).rows.images.find(x => x._id === "smoke4").status !== "Returned") return "image set not marked Returned";
        if (!D2.returnedFor("Graphic Designer").some(x => x.title === "Smoke return set")) return "returnedFor misses it";
        if (D2.submit({ dept: "Graphic Designer", project: "SM-2B", deliv: { id: "graphic:images:smoke4", kind: "Image set", title: "Smoke return set", section: "images", row: "smoke4" } }).error) return "resubmit failed";
        if (D2.page(k).rows.images.find(x => x._id === "smoke4").status !== "Waiting on approval") return "resubmitted set not waiting again";
        if (!D2.returnTask("SM-2B", sres.task, "").error) return "empty comment not refused";
        const r2 = D2.returnTask("SM-2B", sres.task, "Alt text still missing"); if (r2.error || !r2.repeated || r2.returns !== 2) return "second return not flagged";
        const i2 = D2.readHq().issues.find(x => x.id === r2.issue); if (!i2 || i2.type !== "Repeated return" || i2.sev !== "Medium") return "repeated return not flagged in the log";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (rt0 !== "ok") errors.push("deliverables flow: return: " + rt0);
    await page.goto(base + "index.html#/graphic/overview"); await page.waitForTimeout(1200);
    const rov = await page.evaluate(() => { const d = document.getElementById("frame").contentWindow.document, h = d.querySelector("#returned"), l = h && h.nextElementSibling.nextElementSibling; return l && /Alt text still missing/.test(l.textContent) && /Returned 2 times/.test(l.textContent) ? "ok" : "Graphic Designer Overview doesn't show the returned set with comments"; });
    if (rov !== "ok") errors.push("deliverables flow: returned on Overview: " + rov);
    if (shots) { await page.evaluate(() => document.getElementById("frame").contentWindow.document.querySelector("#returned").scrollIntoView()); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-returned-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await page.evaluate(() => document.getElementById("frame").contentWindow.document.querySelector("#returned").scrollIntoView()); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-returned-phone.png") });
      await page.evaluate(() => document.getElementById("frame").contentWindow.MAWM_DATA.submit({ dept: "Graphic Designer", project: "SM-2B", deliv: { id: "graphic:images:smoke4", kind: "Image set", title: "Smoke return set", section: "images", row: "smoke4" } }));
      await page.goto(base + "index.html#/director/review"); await page.waitForTimeout(1200); await page.evaluate(() => { const c = [...document.getElementById("frame").contentWindow.document.querySelectorAll("[data-tid]")].find(x => /Smoke return set/.test(x.textContent)); if (c) c.scrollIntoView() }); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-review-phone.png") }); await page.setViewportSize({ width: 1280, height: 720 }); }
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, c = D.page("mawm-dept-graphic"); c.rows.images = c.rows.images.filter(x => x._id !== "smoke4"); D.savePart("mawm-dept-graphic", c) });
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects = S.projects.filter(p => p.code !== "SM-2B"); D.writeHq(S) });
    if (!errors.some(e => /deliverables flow/.test(e))) await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects.forEach(p => p.tasks.forEach(t => { if (t.submission && t.submission.id === "graphic:images:smoke3") { delete t.submission; delete t.doneAt; t.history = []; t.status = "Waiting on a person" } })); D.writeHq(S);
      const c = D.page("mawm-dept-graphic"); c.rows.images = c.rows.images.filter(x => x._id !== "smoke3"); D.savePart("mawm-dept-graphic", c) });
    console.log("OK: data model " + JSON.stringify(r.counts) + ", CEO page reads it back (" + rt.projects + " projects, " + rt.tasks + " tasks), decision recorded, department logs and saves through it, Design Studio links work to projects, old keys retired (never written; an older page's write is taken in), a submitted deliverable waits in the review queue, approving it starts the next tasks and hands it on, returning it sends it back with comments and logs an issue (repeats flagged)");
    await page.close();
  }
  await browser.close(); server.close();
  try { console.log("OK: " + await require("./desktop")()); } catch (e) { errors.push("desktop: " + (e.stack || e)); }
  try { console.log("OK: " + await require("./updater")()); } catch (e) { errors.push("updater: " + (e.stack || e)); }
  if (errors.length) { console.error("FAILED\n" + errors.join("\n")); process.exit(1); }
  console.log(`OK: ${ROUTES.length} pages × 2 screen sizes, no errors`);
})();
