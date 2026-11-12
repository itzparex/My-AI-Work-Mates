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
  "#/director/timeline", "#/director/review", "#/director/gates", "#/director/lessons",
  "#/research/overview", "#/research/briefs", "#/research/questions", "#/research/documents", "#/research/documents/none", "#/research/booklet", "#/research/evidence", "#/research/persontasks",
  "#/copy/overview", "#/copy/copymaps", "#/copy/claims", "#/copy/images", "#/copy/swipe",
  "#/uiux/research", "#/uiux/concepts", "#/uiux/studio", "#/uiux/library", "#/uiux/review", "#/uiux/theme",
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
    const ctx = await browser.newContext(), page = await ctx.newPage(); page.on("pageerror", e => errors.push("data model: " + e.message + " " + (e.stack||"").split("\n").slice(0,4).join(" | ")));
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
    // 2b-iv: the Design Studio submits a wireframe, a page design and a QA report into the same flow, with its rulebook checks
    await page.goto(base + "index.html#/uiux/review"); await page.waitForTimeout(1500);
    const st4 = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const S = D.readHq(), base = S.projects.find(p => p.code === "FL-COL"), tasks = JSON.parse(JSON.stringify(base.tasks)).map((x, i) => Object.assign(x, { id: "SM-2C-" + String(i + 1).padStart(2, "0"), status: i < 1 ? "Done" : i === 1 ? "In progress" : "Not started", submission: undefined, returns: undefined }));
        S.projects.push({ code: "SM-2C", name: "Smoke 2c", status: "Active", tasks }); D.writeHq(S);
        if (!D.studio()) { const d0 = W.document; (d0.querySelector("#themesw button.on") || d0.querySelector('#themesw [data-t="system"]')).click(); } /* a fresh device: the Studio saves its starting work */
        const st = D.studio(); st.concepts.unshift({ id: "smc1", name: "Smoke wireframe", page: "Product page", metric: "Conversion rate", hyp: "If…", stage: "Wireframe", refs: "", project: "SM-2C", updated: "2026-11-11" });
        st.items.unshift({ id: "smi1", name: "Smoke design", type: "Section", cat: "FAQ", status: "Draft", file: "sections/fl-smoke.liquid", code: "<p>x</p>", ctype: "auto", version: 2, project: "SM-2C", updated: "2026-11-11" }); D.saveStudio(st);
        W.location.reload(); await wait(1500); const W2 = document.getElementById("frame").contentWindow, d = W2.document, D2 = W2.MAWM_DATA;
        const btn = () => d.querySelector('[data-rvsub="wire:smc1"]'); if (!btn()) return "no Submit for the wireframe";
        if (!btn().disabled) return "Submit allowed before the rulebook checks";
        for (let i = 0; i < 4; i++) { d.querySelector(`[data-rvc="wire:smc1:${i}"]`).click(); await wait(60) }
        if (btn().disabled) return "Submit still disabled after every check";
        d.querySelector('[data-rvnote="wire:smc1"]').value = "Smoke wire note"; btn().click(); await wait(200);
        let t = D2.readHq().projects.find(p => p.code === "SM-2C").tasks[1];
        if (t.status !== "Waiting on approval" || !t.submission || t.submission.id !== "uiux:concepts:smc1" || t.submission.note !== "Smoke wire note") return "wireframe task not waiting with the submission";
        if (!/With the Project Director/.test(d.querySelector('[data-rvrow="wire:smc1"]').textContent)) return "Studio doesn't show it with the Project Director";
        const r1 = D2.returnTask("SM-2C", t.id, "Add the FAQ section"); if (r1.error) return "return failed: " + r1.error; await wait(300);
        W2.dispatchEvent(new W2.StorageEvent("storage", { key: D2.KEY })); await wait(200);
        if (!/Returned/.test(d.querySelector('[data-rvrow="wire:smc1"]').textContent) || !/Add the FAQ section/.test((d.querySelector("#rvReturned") || {}).textContent || "")) return "Studio doesn't show the return with comments";
        d.querySelector('[data-rvsub="wire:smc1"]').click(); await wait(200);
        const a1 = D2.approve("SM-2C", t.id); if (a1.error) return "approve failed: " + a1.error;
        if (!D2.inputsFor("Copywriter").some(i => i.title === "Smoke wireframe · wireframe")) return "Copywriter doesn't get the approved wireframe";
        // page design: the Code Studio item goes to the Page design task (once it's open) and becomes Design review
        const S2 = D2.readHq(); S2.projects.find(p => p.code === "SM-2C").tasks[3].status = "In progress"; D2.writeHq(S2);
        W2.dispatchEvent(new W2.StorageEvent("storage", { key: D2.KEY })); await wait(200);
        for (let i = 0; i < 5; i++) { d.querySelector(`[data-rvc="design:smi1:${i}"]`).click(); await wait(60) }
        d.querySelector('[data-rvsub="design:smi1"]').click(); await wait(200);
        t = D2.readHq().projects.find(p => p.code === "SM-2C").tasks[3]; if (t.status !== "Waiting on approval" || t.submission.kind !== "Code Studio item" || t.submission.version !== "2") return "page design not submitted to " + t.name;
        if (D2.studio().items.find(i => i.id === "smi1").status !== "Design review") return "design not marked Design review";
        // QA report: started from the form, a failed check logs an issue, then submitted to the QA task
        d.querySelector("#addQa").click(); await wait(100); const sel = d.querySelector("#qf-project"); sel.value = "SM-2C"; sel.dispatchEvent(new W2.Event("change")); d.querySelector("#qf-item").value = "smi1"; d.querySelector("#qfSave").click(); await wait(200);
        const q = D2.studio().qa.find(x => x.project === "SM-2C"); if (!q || q.item !== "smi1") return "QA report not saved";
        const ta = d.querySelector(`[data-rvn="${q.id}"]`); ta.value = "Cart drawer broke on Android"; ta.dispatchEvent(new W2.Event("change", { bubbles: true })); await wait(60);
        d.querySelector(`[data-rvlog="${q.id}"]`).click(); await wait(200);
        const iss = D2.readHq().issues.find(i => /QA failed: Smoke design — Cart drawer broke/.test(i.what)); if (!iss || iss.dept !== "UI/UX Designer") return "failed QA check not logged";
        const S3 = D2.readHq(); S3.projects.find(p => p.code === "SM-2C").tasks.find(x => /^QA/.test(x.name)).status = "In progress"; D2.writeHq(S3);
        W2.dispatchEvent(new W2.StorageEvent("storage", { key: D2.KEY })); await wait(200);
        for (let i = 0; i < 5; i++) { d.querySelector(`[data-rvc="qa:${q.id}:${i}"]`).click(); await wait(60) }
        d.querySelector(`[data-rvsub="qa:${q.id}"]`).click(); await wait(200);
        t = D2.readHq().projects.find(p => p.code === "SM-2C").tasks.find(x => /^QA/.test(x.name)); if (t.status !== "Waiting on approval" || t.submission.kind !== "QA report") return "QA report not submitted to the QA task";
        if (!D2.load().deliverables.some(x => x.id === "uiux:qa:" + q.id && x.kind === "QA report")) return "QA report not in the model's deliverables";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (st4 !== "ok") errors.push("deliverables flow: Design Studio submits: " + st4);
    if (shots) { await page.goto(base + "index.html#/uiux/review"); await page.waitForTimeout(1500); await page.evaluate(() => { const d = document.getElementById("frame").contentWindow.document, s = d.querySelector("#rproj"); s.value = "SM-2C"; s.dispatchEvent(new Event("change")) }); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-studio-review-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-studio-review-phone.png"), fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(base + "index.html#/director/review"); await page.waitForTimeout(1200); await page.evaluate(() => { const c = [...document.getElementById("frame").contentWindow.document.querySelectorAll("[data-tid]")].find(x => /QA report/.test(x.textContent)); if (c) c.scrollIntoView() }); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2b-review-qa-desktop.png") }); }
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects = S.projects.filter(p => p.code !== "SM-2C"); S.issues = S.issues.filter(i => !/Smoke design|Smoke wireframe/.test(i.what)); D.writeHq(S);
      const st = D.studio(); if (!st) return; st.concepts = st.concepts.filter(c => c.id !== "smc1"); st.items = st.items.filter(i => i.id !== "smi1"); st.qa = (st.qa || []).filter(q => q.project !== "SM-2C"); D.saveStudio(st) });
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, c = D.page("mawm-dept-graphic"); c.rows.images = c.rows.images.filter(x => x._id !== "smoke4"); D.savePart("mawm-dept-graphic", c) });
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects = S.projects.filter(p => p.code !== "SM-2B"); D.writeHq(S) });
    // 2c: gates: everything being approved in one view; guardrail hits become a CEO override decision; the CEO's Allow passes the gate
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(), base = S.projects.find(p => p.code === "FL-COL");
      const tasks = JSON.parse(JSON.stringify(base.tasks)).map((x, i) => Object.assign(x, { id: "SM-GT-" + String(i + 1).padStart(2, "0"), status: i < 5 ? "Done" : i === 5 ? "In progress" : "Not started", submission: undefined }));
      tasks[2].submission = { id: "copy:copymaps:none", kind: "Copy map", title: "Smoke gate copy map", version: "2", dept: "Copywriter", at: "2026-11-11", approved: "2026-11-11", state: "Approved" };
      S.projects.push({ code: "SM-GT", name: "Smoke gates", status: "Active", markets: ["US"], depth: "Quick", tasks }); S.sel = "SM-GT";
      S.issues.unshift({ id: "IS-9901", date: "2026-11-11", project: "SM-GT", dept: "Copywriter", what: "Smoke gate: claim without proof", type: "Rule hit", sev: "High", told: "—", decision: "—", status: "Open" });
      S.issues.unshift({ id: "IS-9902", date: "2026-11-11", project: "SM-GT", dept: "Graphic Designer", what: "Smoke gate: alt text late", type: "Delay", sev: "Low", told: "—", decision: "—", status: "Open" }); D.writeHq(S) });
    await page.goto(base + "index.html#/director/gates"); await page.waitForTimeout(600); await page.evaluate(() => document.getElementById("frame").contentWindow.location.reload()); await page.waitForTimeout(1000);
    const gt1 = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const g = d.querySelector('[data-gate="SM-GT-06"]'); if (!g) return "Design approval gate not shown";
        if (!/Smoke gate copy map/.test(g.textContent) || !/v2/.test(g.textContent) || !/Being approved \(5\/5\)/.test(g.textContent)) return "gate doesn't show what's being approved";
        if (!/Smoke gate: claim without proof/.test(g.textContent) || !/Smoke gate: alt text late/.test(g.textContent)) return "gate misses the guardrail hit or the note";
        if (g.querySelector("[data-gpass]")) return "Pass offered despite a guardrail hit"; if (!D.passGate("SM-GT", "SM-GT-06").error) return "passGate allowed a guardrail hit";
        const l = d.querySelector('[data-gate="SM-GT-09"]'); if (!l || !/Waiting for 3 steps/.test(l.textContent) || l.querySelector("[data-gask],[data-gpass]")) return "Launch approval should wait for 3 steps";
        g.querySelector("[data-gask]").click(); await wait(100); const box = g.querySelector(".inline-input"); box.querySelector("button").click(); await wait(100);
        if (D.readHq().decisions.some(x => x.gate)) return "sent without a recommendation";
        box.querySelector("input").value = "Allow: the claim is cut from the live page"; box.querySelector("button").click(); await wait(200);
        const S = D.readHq(), dec = S.decisions.find(x => x.gate && x.gate.task === "SM-GT-06"); if (!dec || dec.type !== "Override" || !/claim without proof/.test(dec.detail) || !/Smoke gate copy map/.test(dec.detail)) return "no Override decision with the hits and what's approved";
        const is = S.issues.find(i => i.id === dec.issue); if (!is || is.type !== "Override request" || is.sev !== "High" || is.dept !== "Project Director") return "override request not logged";
        if (!/With the CEO/.test(d.querySelector('[data-gate="SM-GT-06"]').textContent)) return "gate doesn't say it's with the CEO";
        if (!D.askOverride("SM-GT", "SM-GT-06", "again").error) return "a second ask wasn't refused";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (gt1 !== "ok") errors.push("gates: director: " + gt1);
    if (shots) { await page.evaluate(() => document.getElementById("frame").contentWindow.document.querySelector('[data-sec="gates"]').scrollIntoView()); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2c-gates-desktop.png") }); }
    await page.goto(base + "index.html#/ceo/decisions"); await page.waitForTimeout(600); await page.evaluate(() => document.getElementById("frame").contentWindow.location.reload()); await page.waitForTimeout(1000);
    const gt2 = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const dec = D.readHq().decisions.find(x => x.gate && x.gate.task === "SM-GT-06"), card = d.querySelector(`[data-id="${dec.id}"]`); if (!card) return "decision not on the CEO page";
        if (!card.querySelector("[data-gsel]")) return "no link to the gate"; card.querySelector('[data-dec="allow"]').click(); await wait(200);
        const S = D.readHq(), p = S.projects.find(x => x.code === "SM-GT"), g = p.tasks[5];
        if (g.status !== "Done" || !g.gatePass || !g.gatePass.override || g.gatePass.by !== "CEO") return "gate not passed by the CEO's override";
        if (p.tasks[6].status !== "In progress") return "Build didn't start"; if (S.issues.find(i => i.id === dec.issue).status !== "Resolved") return "override request not resolved";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (gt2 !== "ok") errors.push("gates: CEO override: " + gt2);
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(), p = S.projects.find(x => x.code === "SM-GT"); p.tasks[6].status = "Done"; p.tasks[7].status = "Done"; p.tasks[8].status = "In progress"; S.issues.find(i => i.id === "IS-9901").status = "Resolved"; S.sel = "SM-GT"; D.writeHq(S) });
    await page.goto(base + "index.html#/director/gates"); await page.waitForTimeout(600); await page.evaluate(() => document.getElementById("frame").contentWindow.location.reload()); await page.waitForTimeout(1000);
    const gt3 = await page.evaluate(async () => { const W = document.getElementById("frame").contentWindow, d = W.document, D = W.MAWM_DATA, wait = ms => new Promise(r => setTimeout(r, ms));
      try {
        const l = d.querySelector('[data-gate="SM-GT-09"]'); if (!/Passed at an earlier gate \(6\)/.test(l.textContent)) return "Launch approval doesn't fold in what passed Design approval";
        const b = l.querySelector("[data-gpass]"); if (!b) return "no Pass on a clean gate"; b.click(); await wait(100); l.querySelector(".inline-input input").value = "Smoke launch check"; l.querySelector(".inline-input button").click(); await wait(200);
        const p = D.readHq().projects.find(x => x.code === "SM-GT"); if (p.tasks[8].status !== "Done" || p.tasks[8].gatePass.note !== "Smoke launch check" || p.tasks[8].gatePass.override) return "Launch approval not passed";
        if (p.tasks[9].status !== "In progress") return "CEO publishes step didn't start";
        return "ok";
      } catch (e) { return "error: " + e.message } });
    if (gt3 !== "ok") errors.push("gates: pass: " + gt3);
    if (shots) { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await page.evaluate(() => document.getElementById("frame").contentWindow.document.querySelector('[data-sec="gates"]').scrollIntoView()); await page.screenshot({ path: path.join(ROOT, "tests", "shots", "2c-gates-phone.png") }); await page.setViewportSize({ width: 1280, height: 720 }); }
    await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects = S.projects.filter(p => p.code !== "SM-GT"); S.issues = S.issues.filter(i => i.project !== "SM-GT"); S.decisions = S.decisions.filter(x => x.project !== "SM-GT"); S.decided = (S.decided || []).filter(x => x.project !== "SM-GT"); S.sel = "FL-PDP"; D.writeHq(S) });
    if (!errors.some(e => /deliverables flow/.test(e))) await page.evaluate(() => { const D = document.getElementById("frame").contentWindow.MAWM_DATA, S = D.readHq(); S.projects.forEach(p => p.tasks.forEach(t => { if (t.submission && t.submission.id === "graphic:images:smoke3") { delete t.submission; delete t.doneAt; t.history = []; t.status = "Waiting on a person" } })); D.writeHq(S);
      const c = D.page("mawm-dept-graphic"); c.rows.images = c.rows.images.filter(x => x._id !== "smoke3"); D.savePart("mawm-dept-graphic", c) });
    console.log("OK: data model " + JSON.stringify(r.counts) + ", CEO page reads it back (" + rt.projects + " projects, " + rt.tasks + " tasks), decision recorded, department logs and saves through it, Design Studio links work to projects, old keys retired (never written; an older page's write is taken in), a submitted deliverable waits in the review queue, approving it starts the next tasks and hands it on, returning it sends it back with comments and logs an issue (repeats flagged), the Design Studio submits wireframes, page designs and QA reports");
    await page.close();
  }
  { // 3a: export all data as one file, import it on another device (fresh browser), undo the import
    const A = await browser.newContext(), pa = await A.newPage(); pa.on("pageerror", e => errors.push("backup (device A): " + e.message));
    await pa.goto(base + "index.html#/ceo/data"); await pa.waitForTimeout(1200);
    const fr = () => pa.frames().find(f => /hq\.html/.test(f.url()));
    const out = await fr().evaluate(() => { const D = MAWM_DATA, S = D.readHq(); S.projects[0].name = "Backup smoke project"; D.writeHq(S);
      const g = D.page("mawm-dept-copy") || { rows: {} }; g.rows = g.rows || {}; g.rows.copymaps = (g.rows.copymaps || []).concat([{ _id: "bk1", project: S.projects[0].code, page: "Backup page", version: "1", status: "Draft" }]); D.savePart("mawm-dept-copy", g);
      localStorage.setItem("facelove-studio-v2-theme", JSON.stringify({ files: { "a.liquid": "x" }, meta: { name: "Smoke theme" }, name: "Smoke theme" }));
      return D.exportAll() });
    const [dl] = await Promise.all([pa.waitForEvent("download", { timeout: 5000 }).catch(() => null), fr().click("#bkExport")]);
    if (!dl || !/^my-ai-work-mates-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename())) errors.push("backup: Download backup file didn't download a backup file");
    if (shots) { await pa.screenshot({ path: path.join(ROOT, "tests", "shots", "desktop-backup-card.png") }) }
    await A.close();
    const B = await browser.newContext({ viewport: { width: 390, height: 844 } }), pb = await B.newPage(); pb.on("pageerror", e => errors.push("backup (device B): " + e.message));
    pb.on("dialog", d => d.accept());
    await pb.goto(base + "index.html#/ceo/data"); await pb.waitForTimeout(1200);
    const frb = () => pb.frames().find(f => /hq\.html/.test(f.url()));
    const beforeName = await frb().evaluate(() => MAWM_DATA.readHq().projects[0].name);
    /* a broken file is refused and changes nothing */
    await frb().setInputFiles("#bkFile", { name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') }); await pb.waitForTimeout(300);
    if (!/isn't a My AI Work Mates backup/.test(await frb().textContent("#bkPreview"))) errors.push("backup: a file that isn't a backup wasn't refused");
    await frb().setInputFiles("#bkFile", { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(out)) }); await pb.waitForTimeout(300);
    const pv = await frb().textContent("#bkPreview"); if (!/Replace this device's data/.test(pv) || !/In the file/.test(pv)) errors.push("backup: no preview before importing");
    if (shots) { await frb().evaluate(() => document.getElementById("bkPreview").scrollIntoView()); await pb.screenshot({ path: path.join(ROOT, "tests", "shots", "phone-backup-preview.png") }) }
    await frb().click("#bkGo"); await pb.waitForTimeout(2200);
    const imp = await frb().evaluate(() => { const D = MAWM_DATA, S = D.readHq(), c = D.page("mawm-dept-copy"), th = JSON.parse(localStorage.getItem("facelove-studio-v2-theme") || "null");
      return { name: S.projects[0].name, copy: !!(c && c.rows.copymaps.find(x => x._id === "bk1")), theme: th && th.name, before: !!D.beforeImport(), bad: D.check().filter(x => x[0] === "bad").map(x => x[1]), log: (D.load().meta.log[0] || [])[1] || "" } });
    if (imp.name !== "Backup smoke project") errors.push("backup: imported projects didn't arrive (" + imp.name + ")");
    if (!imp.copy) errors.push("backup: a department's records didn't arrive");
    if (imp.theme !== "Smoke theme") errors.push("backup: the theme library didn't arrive");
    if (!imp.before) errors.push("backup: no safety copy kept before importing");
    if (imp.bad.length) errors.push("backup: checks fail after importing: " + imp.bad.join("; "));
    if (!/^Imported from a backup file/.test(imp.log)) errors.push("backup: the import wasn't logged");
    /* the model survives a reload (this device's old keys aren't taken in over it) */
    await pb.reload(); await pb.waitForTimeout(1200);
    if (await frb().evaluate(() => MAWM_DATA.readHq().projects[0].name) !== "Backup smoke project") errors.push("backup: imported data lost after a reload");
    await frb().click("#bkUndo"); await pb.waitForTimeout(2200);
    const undone = await frb().evaluate(() => ({ name: MAWM_DATA.readHq().projects[0].name, before: !!MAWM_DATA.beforeImport() }));
    if (undone.name !== beforeName || undone.before) errors.push("backup: Undo last import didn't put the old data back");
    await B.close();
    if (!errors.some(e => /^backup/.test(e))) console.log("OK: backup file downloads, a wrong file is refused, import shows a preview, replaces the data (projects, department records, theme library) with a safety copy, survives a reload, and undo puts it back");
  }
  { // 3b-i: GitHub sync to a private repo (GitHub mocked here): connect, save, load on another device, conflict warning
    const store = { files: {}, n: 0, puts: 0 }, REPOS = { "ceo/agency-data": true, "ceo/public-data": false };
    const mock = async route => { const req = route.request(), u = new URL(req.url()), auth = req.headers()["authorization"] || "";
      const json = (status, o) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT" } });
      if (auth !== "Bearer good-token") return json(401, { message: "Bad credentials" });
      const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/); if (!m || !(m[1] in REPOS)) return json(404, { message: "Not Found" });
      if (!m[2]) return json(200, { full_name: m[1], private: REPOS[m[1]], default_branch: "main" });
      const key = m[1] + "/" + decodeURIComponent(m[2]), f = store.files[key];
      if (req.method() === "GET") return f ? json(200, { type: "file", sha: f.sha, size: f.content.length, content: f.content }) : json(404, { message: "Not Found" });
      if (req.method() === "PUT") { const b = JSON.parse(req.postData()); if (f && b.sha !== f.sha) return json(409, { message: "sha mismatch" }); if (!f && b.sha) return json(422, { message: "sha given" });
        store.files[key] = { sha: "sha" + (++store.n), content: b.content }; store.puts++; return json(f ? 200 : 201, { content: { sha: "sha" + store.n } }) }
      return json(405, {}) };
    const dev = async (vp, label) => { const C = await browser.newContext({ viewport: vp }), p = await C.newPage(); await C.route("https://api.github.com/**", mock);
      p.on("pageerror", e => errors.push("sync (" + label + "): " + e.message)); p.on("dialog", d => d.accept());
      await p.goto(base + "index.html#/ceo/data"); await p.waitForTimeout(1200); return { C, p, fr: () => p.frames().find(f => /hq\.html/.test(f.url())) } };
    const connect = async (fr, repo, token) => { await fr().fill("#ghRepo", repo); await fr().fill("#ghToken", token); await fr().click("#ghConnect"); await fr().waitForTimeout(500) };
    const A = await dev({ width: 1280, height: 860 }, "device A");
    if (shots) { await A.fr().evaluate(() => document.getElementById("ghsync").scrollIntoView()); await A.p.screenshot({ path: path.join(ROOT, "tests", "shots", "desktop-sync-connect.png") }) }
    await connect(A.fr, "ceo/agency-data", "bad-token"); if (!/didn't accept the token/.test(await A.fr().textContent("#ghMsg"))) errors.push("sync: a wrong token wasn't explained");
    await connect(A.fr, "ceo/public-data", "good-token"); if (!/public/.test(await A.fr().textContent("#ghMsg"))) errors.push("sync: a public repo wasn't refused");
    await connect(A.fr, "https://github.com/ceo/agency-data", "good-token");
    if (!(await A.fr().$("#ghSave"))) errors.push("sync: connecting to a private repo didn't work");
    const tokenSafe = await A.fr().evaluate(() => !JSON.stringify(MAWM_DATA.exportAll()).includes("good-token"));
    if (!tokenSafe) errors.push("sync: the token ended up in the backup file");
    await A.fr().evaluate(() => { const D = MAWM_DATA, S = D.readHq(); S.projects[0].name = "Synced from A"; D.writeHq(S) });
    await A.fr().click("#ghSave"); await A.p.waitForTimeout(800);
    if (store.puts !== 1 || !/Saved\./.test(await A.fr().textContent("#ghResult"))) errors.push("sync: Save to GitHub didn't save");
    if (shots) { await A.fr().evaluate(() => document.getElementById("ghsync").scrollIntoView()); await A.p.screenshot({ path: path.join(ROOT, "tests", "shots", "desktop-sync-connected.png") }) }
    const B = await dev({ width: 390, height: 844 }, "device B");
    await connect(B.fr, "ceo/agency-data", "good-token");
    await B.fr().click("#ghSave"); await B.p.waitForTimeout(800); /* B never synced and a copy exists: it must warn, not overwrite */
    if (store.puts !== 1 || !/already data on GitHub/.test(await B.fr().textContent("#ghResult"))) errors.push("sync: saving over a copy from another device didn't warn");
    if (shots) { await B.fr().evaluate(() => document.getElementById("ghResult").scrollIntoView()); await B.p.screenshot({ path: path.join(ROOT, "tests", "shots", "phone-sync-conflict.png") }) }
    await B.fr().click("#ghPeek"); await B.p.waitForTimeout(600);
    if (!/On GitHub/.test(await B.fr().textContent("#ghResult"))) errors.push("sync: no preview before loading");
    await B.fr().click("#ghGo"); await B.p.waitForTimeout(2200);
    const bl = await B.fr().evaluate(() => ({ name: MAWM_DATA.readHq().projects[0].name, before: !!MAWM_DATA.beforeImport(), st: MAWM_DATA.syncStatus() }));
    if (bl.name !== "Synced from A" || !bl.before || !bl.st.lastLoad) errors.push("sync: loading on device B didn't bring A's data (" + bl.name + ")");
    await B.fr().evaluate(() => { const D = MAWM_DATA, S = D.readHq(); S.projects[0].name = "Changed on B"; D.writeHq(S) });
    await B.fr().click("#ghSave"); await B.p.waitForTimeout(800);
    if (store.puts !== 2) errors.push("sync: device B couldn't save after loading");
    await A.fr().click("#ghSave"); await A.p.waitForTimeout(800); /* A is now behind: warn */
    if (store.puts !== 2 || !/Another device saved/.test(await A.fr().textContent("#ghResult"))) errors.push("sync: device A overwrote B's newer save without a warning");
    await A.fr().click("#ghForce"); await A.p.waitForTimeout(800);
    const fa = await A.fr().evaluate(() => MAWM_DATA.syncStatus().warning);
    if (store.puts !== 3 || !/Replaced a newer copy/.test(fa)) errors.push("sync: replacing on purpose didn't work or wasn't noted");
    await A.fr().click("#ghOff"); await A.p.waitForTimeout(400);
    if (!(await A.fr().$("#ghRepo")) || await A.fr().evaluate(() => !!localStorage.getItem("mawm-sync-github"))) errors.push("sync: disconnect didn't remove the token");
    await A.C.close(); await B.C.close();
    { // 3b-ii: automatic sync between two devices: saves go by themselves, newer copies load on open, newest wins (warned), offline saves wait
      const until = async (fn, ms) => { const end = Date.now() + (ms || 9000); while (Date.now() < end) { try { if (await fn()) return true } catch (e) { } await new Promise(r => setTimeout(r, 250)) } return false };
      const file = () => { const f = store.files["ceo/agency-data/auto.json"]; return f ? JSON.parse(Buffer.from(f.content, "base64").toString("utf8")) : null };
      const nameOn = f => f && f.model && f.model.projects[0].name;
      const hqf = X => X.p.frames().find(f => /hq\.html/.test(f.url()));
      const edit = (X, name) => hqf(X).evaluate(n => { const D = MAWM_DATA, S = D.readHq(); S.projects[0].name = n; D.writeHq(S) }, name);
      const badge = X => X.p.evaluate(() => { const b = document.getElementById("syncBadge"); return b.hidden ? "" : b.textContent });
      const A2 = await dev({ width: 1280, height: 860 }, "auto A"); A2.fr = () => hqf(A2);
      await A2.fr().fill("#ghPath", "auto.json"); await connect(A2.fr, "ceo/agency-data", "good-token");
      await edit(A2, "Before first save"); await A2.p.waitForTimeout(3800);
      if (file()) errors.push("sync auto: a device synced by itself before its first Save or Load");
      await A2.fr().click("#ghSave"); await until(() => file());
      await edit(A2, "Auto from A");
      if (!(await until(() => nameOn(file()) === "Auto from A"))) errors.push("sync auto: a save on device A didn't go to GitHub by itself");
      if (await hqf(A2).evaluate(() => MAWM_DATA.syncStatus().dirty)) errors.push("sync auto: device A still shows changes waiting after syncing");
      const B2 = await dev({ width: 390, height: 844 }, "auto B"); B2.fr = () => hqf(B2);
      await B2.fr().fill("#ghPath", "auto.json"); await connect(B2.fr, "ceo/agency-data", "good-token");
      await B2.fr().click("#ghLoad"); await B2.p.waitForTimeout(600); await B2.fr().click("#ghGo"); await B2.p.waitForTimeout(2500);
      await edit(A2, "A again"); await until(() => nameOn(file()) === "A again");
      /* B opens another page a while later: the newer copy is loaded by itself */
      await B2.p.evaluate(() => { const s = JSON.parse(localStorage.getItem("mawm-sync-state")); s.lastCheck = ""; localStorage.setItem("mawm-sync-state", JSON.stringify(s)) });
      await B2.p.goto(base + "index.html#/research/overview");
      const deptB = () => B2.p.frames().find(f => /dept\.html/.test(f.url()));
      if (!(await until(async () => (await deptB().evaluate(() => MAWM_DATA.readHq().projects[0].name)) === "A again"))) errors.push("sync auto: opening a page on device B didn't load A's newer copy");
      await B2.p.goto(base + "index.html#/ceo/data"); await B2.p.waitForTimeout(1200);
      /* B goes offline and changes something: it waits (header says so); then A saves a newer change; when B is back, the newest (A's) wins, with a warning */
      await B2.C.setOffline(true); await edit(B2, "B offline edit"); await B2.p.waitForTimeout(3800);
      if (!/Offline/.test(await badge(B2)) && !/Offline/.test(await B2.p.getAttribute("#syncBadge", "aria-label"))) errors.push("sync auto: the header didn't say offline changes are waiting (" + await badge(B2) + ")");
      if (shots) await B2.p.screenshot({ path: path.join(ROOT, "tests", "shots", "phone-sync-offline.png") });
      await A2.p.waitForTimeout(300); await edit(A2, "A newest"); await until(() => nameOn(file()) === "A newest");
      await B2.C.setOffline(false); await B2.p.evaluate(() => { const f = document.getElementById("frame").contentWindow; f.dispatchEvent(new Event("online")) });
      const bw = await until(async () => (await B2.fr().evaluate(() => MAWM_DATA.readHq().projects[0].name)) === "A newest", 12000);
      const bst = await B2.fr().evaluate(() => ({ st: MAWM_DATA.syncStatus(), before: !!MAWM_DATA.beforeImport() }));
      if (!bw || !/newer copy on GitHub/.test(bst.st.warning) || !bst.before) errors.push("sync auto: when both changed, the newer copy from A didn't win with a warning and a safety copy (" + JSON.stringify(bst.st.warning) + ")");
      if (!/newest copy kept/.test(await B2.p.getAttribute("#syncBadge", "aria-label"))) errors.push("sync auto: the header didn't warn that the newest copy was kept");
      if (shots) { await B2.p.waitForTimeout(400); await B2.fr().evaluate(() => document.getElementById("ghsync").scrollIntoView()); await B2.p.screenshot({ path: path.join(ROOT, "tests", "shots", "phone-sync-newest.png") }) }
      /* now B's change is the newer one: A changes offline first, B saves later; when A is back, B's newer copy stays… and the reverse: B newer than GitHub wins */
      await B2.C.setOffline(true); await A2.p.waitForTimeout(300); await edit(A2, "A older"); await until(() => nameOn(file()) === "A older");
      await B2.p.waitForTimeout(300); await edit(B2, "B newest"); await B2.p.waitForTimeout(500);
      await B2.C.setOffline(false); await B2.p.evaluate(() => document.getElementById("frame").contentWindow.dispatchEvent(new Event("online")));
      if (!(await until(() => nameOn(file()) === "B newest", 12000))) errors.push("sync auto: B's newer offline change didn't replace the older copy on GitHub");
      const bw2 = await B2.fr().evaluate(() => MAWM_DATA.syncStatus().warning);
      if (!/this device's newer changes/.test(bw2)) errors.push("sync auto: replacing an older copy on GitHub wasn't warned (" + bw2 + ")");
      if (shots) { await A2.p.goto(base + "index.html#/ceo/data"); await A2.p.waitForTimeout(1500); await A2.fr().evaluate(() => document.getElementById("ghsync").scrollIntoView()); await A2.p.screenshot({ path: path.join(ROOT, "tests", "shots", "desktop-sync-auto.png") }) }
      /* dismissing the warning clears the header; pausing stops automatic saves */
      await B2.p.waitForTimeout(500); const dis = await B2.fr().$("#ghDismiss"); if (dis) await dis.click(); await B2.p.waitForTimeout(400);
      if (await until(async () => !(await badge(B2)), 16000) !== true) errors.push("sync auto: dismissing the warning didn't clear the header");
      await A2.fr().uncheck("#ghAuto"); const puts = store.puts; await edit(A2, "Paused edit"); await A2.p.waitForTimeout(3800);
      if (store.puts !== puts) errors.push("sync auto: pausing automatic sync didn't stop it");
      await A2.C.close(); await B2.C.close();
      if (!errors.some(e => /^sync auto/.test(e))) console.log("OK: automatic sync waits for the first Save or Load, sends saves by itself, loads a newer copy on opening a page, keeps offline saves until back online (header says so), lets the newest copy win either way with a warning on the card and the header, and can be paused");
    }
    if (!errors.some(e => /^sync/.test(e))) console.log("OK: GitHub sync refuses a wrong token and a public repo, keeps the token out of backups, saves, warns before overwriting another device's save, loads with a preview on another device, can replace on purpose (noted) and disconnects");
  }
  await browser.close(); server.close();
  try { console.log("OK: " + await require("./desktop")()); } catch (e) { errors.push("desktop: " + (e.stack || e)); }
  try { console.log("OK: " + await require("./updater")()); } catch (e) { errors.push("updater: " + (e.stack || e)); }
  if (errors.length) { console.error("FAILED\n" + errors.join("\n")); process.exit(1); }
  console.log(`OK: ${ROUTES.length} pages × 2 screen sizes, no errors`);
})();
