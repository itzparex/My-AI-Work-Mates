// Research work mate rehearsal (W2-i): the Research & Strategist playbook run end to end through tools/agent-data.js on a
// copy of the app's example data, the way a real run works on the CEO's synced data file: brief and kickoff, the nine
// documents, ledger entries, every question bank question, a person task, the offer sent to the CEO, the Booklet held
// back until the 15-point ready-for-handoff checklist passes, the CEO allowing the offer in the app, then the Booklet
// submitted to the Project Director. Also checks the helper's checklist matches the Booklet page's, item by item.
// Run from tests/smoke.js. Everything written here is test data in a temporary file, never the CEO's data.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const TOOL = path.resolve(__dirname, "..", "tools", "agent-data.js");
const SRC = fs.readFileSync(path.resolve(__dirname, "..", "dept.html"), "utf8");
const lists = n => Function('"use strict";return (' + SRC.match(new RegExp("\\nconst " + n + "=([\\s\\S]*?);\\n(?=const |/\\*|function |let )"))[1] + ")")();
const NINE = lists("NINE"), KICK = lists("KICK"), QB = lists("QB"), MUST = lists("MUST");
const AGENT = "Research & Strategist", today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };

module.exports = async function run(browser, base, shots) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto(base + "index.html#/ceo/home"); await page.waitForTimeout(1500);
  const DM = () => window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mawm-research-")), "my-ai-work-mates-data.json");
  fs.writeFileSync(file, await page.evaluate(dm => JSON.stringify(eval(dm)().exportAll()), "(" + DM + ")"));
  const H = (...a) => { const r = spawnSync(process.execPath, [TOOL, ...a, "--file", file, "--agent", AGENT], { encoding: "utf8" }); let j; try { j = JSON.parse(r.stdout) } catch (e) { throw new Error(a[0] + ": not JSON: " + r.stdout + r.stderr) } return { code: r.status, j } };
  const ok = (r, what) => { assert.strictEqual(r.j.ok, true, what + ": " + JSON.stringify(r.j)); return r.j };
  const toApp = async () => { const t = fs.readFileSync(file, "utf8"); const e = await page.evaluate(([dm, t]) => { const D = eval(dm)(), r = D.readBackup(t); return r.ok ? D.importAll(r.file, true) || "" : r.error }, ["(" + DM + ")", t]); assert.ok(!e, "app loads the file: " + e) };
  const fromApp = async () => fs.writeFileSync(file, await page.evaluate(dm => JSON.stringify(eval(dm)().exportAll()), "(" + DM + ")"));

  // 1. the run starts: switch on, pick the Research task
  assert.strictEqual(ok(H("autowork", "--agent", AGENT), "autowork").go, true);
  const work = H("work", "--dept", AGENT).j;
  const task = work.tasks.find(t => /^Research/i.test(t.name) && t.status !== "Waiting on approval"); assert.ok(task, "an open Research task");
  const code = task.project;
  ok(H("task-status", "--project", code, "--task", task.id, "--status", "In progress"), "task in progress");

  // 2. brief and kickoff (all ten answers), then the nine documents (missing ones only)
  const briefs = H("get", "--page", "research", "--section", "briefs", "--project", code).j;
  const brief = { project: code, product: "Rehearsal lash serum", kind: "New product (mine competitors)", markets: "United States", depth: "Quick", status: "In progress", kick: KICK.map((_, i) => "Rehearsal answer " + (i + 1)) };
  if (briefs[0]) brief._id = briefs[0]._id;
  ok(H("put-row", "--page", "research", "--section", "briefs", "--json", JSON.stringify(brief)), "brief");
  let docs = H("get", "--page", "research", "--section", "documents", "--project", code).j;
  for (const doc of NINE) if (!docs.some(r => r.doc === doc)) ok(H("put-row", "--page", "research", "--section", "documents", "--json", JSON.stringify({ project: code, doc, status: "In progress", date: today(), version: "1", product: brief.product })), "open " + doc);
  docs = H("get", "--page", "research", "--section", "documents", "--project", code).j;
  assert.strictEqual(NINE.filter(n => docs.some(r => r.doc === n)).length, 9, "nine documents open");
  const live = docs.filter(r => ["Waiting on approval", "Approved"].includes(r.status)); assert.strictEqual(live.length, 0, "example documents are editable");
  let h = ok(H("handoff", "--project", code), "handoff"); assert.ok(!h.ready && h.total === 15 && h.booklet, "checklist starts open");

  // 3. ledger: one entry per finding, grades and verdicts (an A for the main claim, B for the pattern, D for the kickoff)
  const ev = H("get", "--page", "research", "--section", "evidence").j, n0 = ev.reduce((m, e) => Math.max(m, parseInt(String(e.id || "").replace(/^\D+/, ""), 10) || 0), 0);
  const id = k => "EV-" + String(n0 + k).padStart(3, "0"), far = "2099-01-01";
  [["Published study on the active ingredient", "Study", "A · independent, verifiable", "Clear"], ["\"My lashes looked fuller after 6 weeks\" (pattern across 40 reviews)", "Customer review", "B · strong, e.g. many reviews", "Reword"], ["Competitor price: $39 for 3 ml", "Competitor price or offer", "B · strong, e.g. many reviews", "Clear"]]
    .forEach(([claim, stype, grade, use], i) => ok(H("put-row", "--page", "research", "--section", "evidence", "--json", JSON.stringify({ id: id(i + 1), project: code, claim, stype, source: "https://example.com/rehearsal/" + (i + 1), found: today(), grade, recheck: far, ads: "Yes, with wording", use })), "ledger " + id(i + 1)));
  assert.strictEqual(H("answer", "--project", code, "--doc", "1", "--q", "1", "--answer", "x", "--ev", "EV-9999").j.ok, false, "answers need a ledger ID that exists");

  // 4. every question bank question: answered with ledger IDs, or Unknown with a person task
  ok(H("put-row", "--page", "research", "--section", "persontasks", "--json", JSON.stringify({ _id: "R01", project: code, task: "Which ads have they run the longest?", how: "Why the agent couldn't do it: rehearsal\nWhere to go: Meta Ad Library", due: today(), status: "To do" })), "person task");
  for (const [d, qs] of Object.entries(QB)) qs.forEach((_, i) => {
    if (d === "3" && i === 2) ok(H("answer", "--project", code, "--doc", d, "--q", String(i + 1), "--unknown", "--need", "Person task PT-R01"), "unknown");
    else ok(H("answer", "--project", code, "--doc", d, "--q", String(i + 1), "--answer", "Rehearsal finding " + d + "." + (i + 1), "--ev", id(1 + (i % 3))), "answer " + d + "." + (i + 1));
  });
  ok(H("report", "--dept", AGENT, "--project", code, "--what", "1 person task created: Meta Ad Library longest-running ads", "--type", "Needs a person", "--sev", "Low", "--told", "Person task PT-R01"), "report person task");

  // 5. write each document in the skeleton; the offer goes to the CEO and document 4 says so
  const dec = ok(H("report", "--dept", AGENT, "--project", code, "--what", "Offer for the rehearsal lash serum ready for CEO approval", "--type", "Approval needed", "--sev", "Medium", "--decision-type", "Approval", "--decision-title", "Approve the rehearsal lash serum offer: 1 for $34, 2 for $59?", "--detail", "Margin $14 per order", "--rec", "Launch 1 for $34, test 2 for $59"), "offer decision").decision;
  assert.ok(dec, "offer decision created");
  for (const r of docs) {
    const d = NINE.indexOf(r.doc), mc = {};
    MUST[d].forEach(([t], i) => { mc[t] = { t: t === "CEO approval" ? "Waiting on CEO (" + dec + ")" : "Rehearsal: " + t + " (" + id(1 + (i % 3)) + ")", ev: id(1 + (i % 3)) } });
    ok(H("put-row", "--page", "research", "--section", "documents", "--json", JSON.stringify({ _id: r._id, product: brief.product, date: today(), version: "1", summary: ["Finding one (" + id(1) + ")", "Finding two (" + id(2) + ")", "Finding three (" + id(3) + ")"], mc, open: "None for the rehearsal", conf: "Medium", confWhy: "Rehearsal data", status: d === 8 ? "Draft" : "Done", changes: d === 8 ? "First version" : undefined })), "write " + r.doc);
  }

  // 6. the checklist: app-checked items pass, hand items wait, the offer can't be ticked, the Booklet can't go yet
  h = ok(H("handoff", "--project", code), "handoff");
  const st = n => h.items[n - 1].state;
  assert.ok([1, 2, 3, 5, 6, 8, 13, 15].every(n => st(n) === "pass"), "app-checked items pass: " + JSON.stringify(h.items.filter(x => x.state !== "pass")));
  assert.ok([4, 7, 9, 10, 12, 14].every(n => st(n) === "tick") && st(11) === "tick", "hand items and the offer wait");
  const bkId = h.booklet.id, sub = () => H("submit", "--dept", AGENT, "--project", code, "--page", "research", "--section", "documents", "--row", bkId, "--note", "Rehearsal Booklet");
  let s = sub(); assert.ok(!s.j.ok && /checklist has 7 of 15/.test(s.j.error) && /11 \(/.test(s.j.error), "Booklet held back: " + JSON.stringify(s.j));
  assert.ok(/Only the CEO/.test(H("tick-handoff", "--project", code, "--item", "11", "--why", "x").j.error), "nobody but the CEO approves the offer");
  assert.ok(/checked by the app/.test(H("tick-handoff", "--project", code, "--item", "3", "--why", "x").j.error), "app-checked items can't be ticked");
  assert.strictEqual(H("tick-handoff", "--project", code, "--item", "4").j.ok, false, "a tick needs a reason");
  for (const n of [4, 7, 9, 10, 12, 14]) ok(H("tick-handoff", "--project", code, "--item", String(n), "--why", "Rehearsal: checked item " + n), "tick " + n);
  h = ok(H("handoff", "--project", code), "handoff"); assert.ok(h.passed === 14 && st(11) === "tick" && h.items[3].tickedBy && /Rehearsal/.test(h.items[3].tickedBy.why), "14 of 15 with the ticks recorded");
  s = sub(); assert.ok(!s.j.ok && /1 of 15/.test(s.j.error), "still waiting on the CEO's offer approval");

  // 7. the Booklet page shows the same checklist as the helper (and who ticked what)
  const appList = async () => { await page.goto(base + "index.html#/research/booklet"); await page.waitForTimeout(1200);
    const f = page.frames().find(x => /dept\.html/.test(x.url())); await f.evaluate(c => { location.hash = "#booklet/" + encodeURIComponent(c) }, code); await page.waitForTimeout(500);
    return f.evaluate(() => [...document.querySelectorAll(".split label.check")].map(l => ({ ok: l.querySelector("input").checked, text: l.innerText }))) };
  await toApp(); let app = await appList();
  assert.strictEqual(app.length, 15, "Booklet page shows 15 checks");
  assert.deepStrictEqual(app.map(x => x.ok), h.items.map(x => x.state === "pass"), "helper and Booklet page agree before the CEO decides");
  assert.ok(/ticked by Research & Strategist on .*Rehearsal: checked item 4/.test(app[3].text), "Booklet page shows who ticked an item and why");

  // 8. the CEO allows the offer in the app; item 11 passes by itself; the Booklet goes to the Project Director
  await page.goto(base + "index.html#/ceo/decisions"); await page.waitForTimeout(1300);
  const hf = page.frames().find(x => /hq\.html/.test(x.url()));
  const btn = await hf.$(`#decisions [data-id="${dec}"] [data-dec="allow"]`); assert.ok(btn, "the offer decision waits on the CEO page"); await btn.click(); await page.waitForTimeout(500);
  await fromApp();
  h = ok(H("handoff", "--project", code), "handoff");
  assert.ok(h.ready && st(11) === "pass" && /Allowed by the CEO/.test(h.items[10].hint), "offer allowed: checklist ready: " + JSON.stringify(h.items[10]));
  app = await appList(); assert.deepStrictEqual(app.map(x => x.ok), h.items.map(x => x.state === "pass"), "helper and Booklet page agree after the CEO decides");
  if (shots) await page.screenshot({ path: path.join(__dirname, "shots", "desktop-research-handoff.png"), fullPage: false });
  s = sub(); assert.strictEqual(s.j.ok, true, "Booklet submitted: " + JSON.stringify(s.j)); assert.strictEqual(s.j.task, task.id);
  const q = H("review").j.queue.find(t => t.id === task.id && t.project === code);
  assert.ok(q && /^Marketer's Booklet v1$/.test(q.submission.title) && q.submission.row === bkId, "Booklet in the Project Director's review queue");
  assert.strictEqual(H("put-row", "--page", "research", "--section", "documents", "--json", JSON.stringify({ _id: bkId, changes: "edit" })).j.ok, false, "the submitted Booklet can't change");
  assert.ok(!H("check").j.some(c => c.level === "bad"), "data checks pass");
  await toApp(); await page.goto(base + "index.html#/director/review"); await page.waitForTimeout(1300);
  const shown = await page.frames().find(x => /hq\.html/.test(x.url())).evaluate(() => document.body.innerText);
  assert.ok(/Marketer's Booklet v1/.test(shown), "the Project Director's review page shows the Booklet");
  assert.deepStrictEqual(errs, [], "no page errors");
  await ctx.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true });
  return "Research work mate rehearsal: brief, nine documents, ledger, all 42 questions, a person task and the offer decision written through the helper; the Booklet is held back until the 15-point checklist passes (the helper and the Booklet page agree item by item, hand ticks carry who and why, only the CEO's Allow passes the offer), then reaches the Project Director's review queue";
};
