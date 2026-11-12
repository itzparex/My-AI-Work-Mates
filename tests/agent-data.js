// Agent data helper test (W1): tools/agent-data.js reads the app's synced data file and writes changes the app
// loads back: a research document added, the Booklet submitted to review, an issue and a CEO decision logged,
// a task returned and approved by the Project Director, a lesson, and refusals for anything not allowed.
// Run from tests/smoke.js (needs the app's example data, made by opening the CEO page in a browser).
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const TOOL = path.resolve(__dirname, "..", "tools", "agent-data.js");

module.exports = async function run(browser, base) {
  const ctx = await browser.newContext(), page = await ctx.newPage();
  await page.goto(base + "index.html#/ceo/home"); await page.waitForTimeout(1500);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mawm-agent-")), "my-ai-work-mates-data.json");
  const exported = await page.evaluate(() => { const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; return JSON.stringify(D.exportAll()) });
  fs.writeFileSync(file, exported);
  const cli = (...a) => { const r = spawnSync(process.execPath, [TOOL, ...a, "--file", file], { encoding: "utf8" }); let j; try { j = JSON.parse(r.stdout) } catch (e) { throw new Error("agent-data " + a[0] + ": not JSON: " + r.stdout + r.stderr) } return { code: r.status, j } };

  const sum = cli("summary").j; assert.ok(sum.projects.length >= 2, "summary lists projects");
  const P = sum.projects.find(p => p.tasks.some(t => t.dept === "Research & Strategist" && t.status !== "Done")) || sum.projects[0], code = P.code;
  const rTask = P.tasks.find(t => t.dept === "Research & Strategist" && /^Research/i.test(t.name));
  assert.ok(rTask, "project has a Research task");
  const work = cli("work", "--dept", "Research & Strategist").j; assert.ok(Array.isArray(work.tasks) && Array.isArray(work.inputs) && Array.isArray(work.decided), "work lists tasks, inputs and decided CEO decisions");

  // a department writes its own records, then submits one (the Booklet itself waits for its checklist: tests/research-run.js)
  const add = cli("put-row", "--page", "research", "--section", "documents", "--json", JSON.stringify({ project: code, doc: "1. Product Deep Dive", status: "Draft", version: "1", notes: "Written by the agent test" }), "--agent", "Research & Strategist");
  assert.strictEqual(add.j.ok, true, "put-row: " + JSON.stringify(add.j)); assert.ok(add.j.added);
  const got = cli("get", "--page", "research", "--section", "documents", "--id", add.j.id).j; assert.strictEqual(got.notes, "Written by the agent test");
  assert.strictEqual(cli("submit", "--dept", "Copywriter", "--project", code, "--page", "research", "--section", "documents", "--row", add.j.id).j.ok, false, "can't submit another department's work");
  if (rTask.status === "Done") cli("task-status", "--project", code, "--task", rTask.id, "--status", "In progress"); // refused: approved work stays approved
  const sub = cli("submit", "--dept", "Research & Strategist", "--project", code, "--page", "research", "--section", "documents", "--row", add.j.id, "--note", "Agent test");
  assert.notStrictEqual(rTask.status, "Done", "example data has an open Research task to submit to");
  {
    assert.strictEqual(sub.j.ok, true, "submit: " + JSON.stringify(sub.j)); assert.strictEqual(sub.j.task, rTask.id);
    assert.ok(cli("review").j.queue.some(t => t.id === rTask.id && t.submission.title === "1. Product Deep Dive" && t.submission.page === "research" && t.submission.section === "documents" && t.submission.row === add.j.id), "review queue shows the submission and where to open it");
    assert.ok(Array.isArray(cli("review").j.gates), "review lists gates in progress");
    assert.strictEqual(cli("put-row", "--page", "research", "--section", "documents", "--json", JSON.stringify({ _id: add.j.id, notes: "changed" })).j.ok, false, "work waiting on approval can't be changed");
    // the Project Director returns it (an issue is logged), then approves the next submission
    const ret = cli("return", "--project", code, "--task", rTask.id, "--comment", "Add ledger IDs to part 4");
    assert.strictEqual(ret.j.ok, true, "return: " + JSON.stringify(ret.j)); assert.ok(/^IS-/.test(ret.j.issue));
    assert.strictEqual(cli("return", "--project", code, "--task", rTask.id, "--comment", "").j.ok, false, "return needs a comment");
    assert.strictEqual(cli("submit", "--dept", "Research & Strategist", "--project", code, "--page", "research", "--section", "documents", "--row", add.j.id).j.ok, true);
    const ok = cli("approve", "--project", code, "--task", rTask.id, "--note", "Good"); assert.strictEqual(ok.j.ok, true, "approve: " + JSON.stringify(ok.j));
  }
  // question bank answers (Research & Strategist playbook): a ledger entry first, then the answer citing it
  const ev = cli("get", "--page", "research", "--section", "evidence").j, evId = "EV-" + String(ev.reduce((m, e) => Math.max(m, parseInt(String(e.id || "").replace(/^\D+/, ""), 10) || 0), 0) + 1).padStart(3, "0");
  assert.strictEqual(cli("put-row", "--page", "research", "--section", "evidence", "--json", JSON.stringify({ id: evId, project: code, claim: "Agent test finding", stype: "Competitor page", source: "https://example.com", found: "2026-11-12", grade: "D · unverified", recheck: "2027-02-10", ads: "No", use: "Do not use" })).j.ok, true, "ledger entry added");
  assert.strictEqual(cli("answer", "--project", code, "--doc", "1", "--q", "1", "--answer", "x", "--ev", "EV-999").j.ok, false, "answer refuses an ID that isn't in the ledger");
  assert.strictEqual(cli("answer", "--project", code, "--doc", "4", "--q", "6", "--answer", "x", "--ev", evId).j.ok, false, "answer refuses a question that doesn't exist");
  const ans = cli("answer", "--project", code, "--doc", "1", "--q", "1", "--answer", "Agent test answer", "--ev", evId.toLowerCase());
  assert.strictEqual(ans.j.ok, true, "answer: " + JSON.stringify(ans.j)); assert.strictEqual(ans.j.status, "Answered");
  assert.strictEqual(cli("answer", "--project", code, "--doc", "3", "--q", "3", "--unknown", "--need", "Person task: Meta Ad Library screenshots").j.status, "Unknown");
  const qa = (cli("get", "--page", "research").j.qa || {})[code] || {};
  assert.ok(qa["1-0"].a === "Agent test answer" && qa["1-0"].ev === evId && qa["2-2"] === undefined && qa["3-2"].unk, "answers saved where the Question bank page reads them");
  // issues, CEO decisions, task status and lessons
  const rep = cli("report", "--dept", "Research & Strategist", "--project", code, "--what", "Supplier lab test needs a person to request it", "--type", "Needs a person", "--sev", "Medium");
  assert.strictEqual(rep.j.ok, true, "report: " + JSON.stringify(rep.j));
  const dec = cli("report", "--dept", "Graphic Designer", "--project", code, "--what", "AI product image wanted for slide 3", "--type", "Guardrail", "--sev", "High", "--decision-type", "Approval", "--decision-title", "Use an AI-made product image on slide 3?", "--rec", "Use the real photo instead");
  assert.ok(dec.j.ok && dec.j.decision, "report with a CEO decision: " + JSON.stringify(dec.j));
  assert.strictEqual(cli("report", "--dept", "Nobody", "--project", code, "--what", "x").j.ok, false, "unknown department refused");
  assert.strictEqual(cli("task-status", "--project", code, "--task", rTask.id, "--status", "Done").j.ok, false, "agents can't mark a task Done");
  assert.strictEqual(cli("lesson", "--project", code, "--dept", "Research & Strategist", "--what", "Lab tests take a week", "--type", "Timing", "--change", "Ask for them on day one").j.ok, true);
  assert.strictEqual(cli("lesson", "--project", code, "--dept", "Copywriter", "--what", "Headline used a Reword claim without the safe wording", "--type", "Mistake", "--cause", "Claims list not rechecked", "--fix", "Headline corrected", "--change", "Confirm the Booklet version at intake").j.ok, true, "lesson with cause and fix");
  // Graphic Designer playbook: an AI product image goes to the CEO only with what it shows and the full product spec
  const gSet = cli("put-row", "--page", "graphic", "--section", "images", "--json", JSON.stringify({ project: code, set: "PDP carousel", status: "In progress", version: "1", prefix: "ag-test", slides: [{ id: "s1", std: 0, name: "Hero", shows: "Tube, closed, on white", aiimg: true, slug: "hero", ext: "jpg", spec: { color: "Brown Black", size: "10 ml" } }] }), "--agent", "Graphic Designer");
  assert.strictEqual(gSet.j.ok, true, "image set added: " + JSON.stringify(gSet.j));
  assert.strictEqual(cli("ask-ai-image", "--project", code, "--set", gSet.j.id, "--slide", "s1").j.ok, false, "AI image request refused without the full spec");
  const gs = cli("get", "--page", "graphic", "--section", "images", "--id", gSet.j.id).j; gs.slides[0].spec = { color: "Brown Black", size: "10 ml", pack: "Matte black tube, gold cap", contents: "1 tube" };
  assert.strictEqual(cli("put-row", "--page", "graphic", "--section", "images", "--json", JSON.stringify({ _id: gSet.j.id, slides: gs.slides })).j.ok, true);
  const ai = cli("ask-ai-image", "--project", code, "--set", gSet.j.id, "--slide", "s1", "--why", "No photos of the new shade yet");
  assert.ok(ai.j.ok && ai.j.decision && ai.j.image === "ag-test-carousel-01-hero.jpg", "AI image request: " + JSON.stringify(ai.j));
  assert.strictEqual(cli("ask-ai-image", "--project", code, "--set", gSet.j.id, "--slide", "s1").j.ok, false, "a waiting request isn't asked twice");
  const gp = cli("get", "--page", "graphic").j, aiRow = (gp.rows.aiimages || []).find(x => x._id === ai.j.request);
  assert.ok(aiRow && aiRow.decision === "Waiting on CEO" && gp.rows.images.find(x => x._id === gSet.j.id).slides[0].aiReq === aiRow._id, "request saved on AI image approvals and linked to the slide");
  assert.ok(cli("work", "--dept", "Graphic Designer").j.decisionsWaiting.some(d => d.id === ai.j.decision && d.type === "Override"), "the CEO decision waits for the Graphic Designer");
  assert.strictEqual(cli("put-row", "--page", "research", "--section", "documents", "--json", "{\"project\":\"NOPE\"}").j.ok, false, "unknown project refused");
  const dry = cli("report", "--dept", "Copywriter", "--project", code, "--what", "dry", "--dry-run").j; assert.ok(dry.ok && dry.dryRun);
  assert.ok(!cli("summary").j.openIssues.some(i => i.what === "dry"), "dry run saves nothing");
  assert.ok(!cli("check").j.some(c => c.level === "bad"), "data checks pass after the writes");

  // the app loads the agent's file back (as it would from GitHub) and shows the work
  const back = await page.evaluate(t => { const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const r = D.readBackup(t); if (!r.ok) return { error: r.error }; const e = D.importAll(r.file, true); const S = D.readHq(); return { e, device: r.summary.device, issues: S.issues.map(i => i.what), decisions: S.decisions.map(d => d.title), lessons: S.lessons.map(l => l.what) } }, fs.readFileSync(file, "utf8"));
  assert.ok(!back.error && !back.e, "app reads the agent's file: " + (back.error || back.e));
  assert.ok(/AI work mate/.test(back.device), "the file says an AI work mate saved it");
  assert.ok(back.issues.some(w => /lab test/.test(w)) && back.decisions.includes("Use an AI-made product image on slide 3?") && back.decisions.includes("AI product image: ag-test-carousel-01-hero.jpg") && back.lessons.includes("Lab tests take a week"), "app shows the agent's issues, decisions and lessons");
  // W1b-ii: the Auto-work switch. On: go. Copywriter paused by the CEO in the app: its scheduled run is skipped (and
  // recorded), its writes are refused, others carry on, and "Run now" goes ahead. Main switch paused: everyone skips.
  const sw = cli("autowork", "--agent", "Copywriter"); assert.ok(sw.code === 0 && sw.j.ok && sw.j.go && sw.j.switch === "On", "switch on: " + JSON.stringify(sw.j));
  const pausedFile = state => page.evaluate(([w, st]) => { const D = window.MAWM_DATA || document.getElementById("frame").contentWindow.MAWM_DATA; const r = D.setAutowork(w, st, "test"); return r.error ? { error: r.error } : JSON.stringify(D.exportAll()) }, state);
  let pf = await pausedFile(["Copywriter", "Paused"]); assert.ok(typeof pf === "string", "paused in the app: " + JSON.stringify(pf));
  fs.writeFileSync(file, pf);
  const runs = path.join(path.dirname(file), "runs.json");
  const rec = (...a) => { const r = spawnSync(process.execPath, [TOOL, ...a, "--file", file], { encoding: "utf8", env: Object.assign({}, process.env, { MAWM_RUNS_FILE: runs }) }); return { code: r.status, j: JSON.parse(r.stdout) } };
  const sk = rec("autowork", "--agent", "Copywriter", "--record", "--started", "2026-11-12T10:00:00Z");
  assert.ok(sk.code === 3 && sk.j.go === false && sk.j.text === "Skipped: paused by CEO" && sk.j.recorded && sk.j.lastChange && sk.j.lastChange.state === "Paused", "paused: skipped: " + JSON.stringify(sk.j));
  const rr = JSON.parse(fs.readFileSync(runs, "utf8")).runs; assert.ok(rr.length === 1 && rr[0].agent === "Copywriter" && rr[0].result === "skipped" && /paused by CEO/.test(rr[0].summary), "skipped run recorded");
  const before = fs.readFileSync(file, "utf8");
  const wr = cli("report", "--dept", "Copywriter", "--project", code, "--what", "should not save");
  assert.ok(wr.code === 3 && wr.j.skipped && /paused by CEO/.test(wr.j.error) && fs.readFileSync(file, "utf8") === before, "a paused work mate's write is refused and nothing saved");
  assert.strictEqual(cli("put-row", "--page", "copy", "--section", "copymaps", "--json", JSON.stringify({ project: code, page: "PDP" })).code, 3, "put-row on the paused department refused");
  assert.strictEqual(cli("autowork", "--agent", "Research & Strategist").j.go, true, "other work mates carry on");
  assert.strictEqual(cli("report", "--dept", "Research & Strategist", "--project", code, "--what", "Still working while Copywriter is paused").j.ok, true);
  const now = cli("autowork", "--agent", "Copywriter", "--run-now"); assert.ok(now.code === 0 && now.j.go && now.j.run === "run-now", "Run now goes ahead: " + JSON.stringify(now.j));
  assert.strictEqual(cli("report", "--dept", "Copywriter", "--project", code, "--what", "Run now by the CEO", "--run-now").j.ok, true, "Run now writes");
  pf = await pausedFile(["all", "Paused"]); fs.writeFileSync(file, pf);
  const all = cli("autowork", "--agent", "Project Director"); assert.ok(all.code === 3 && all.j.main === "Paused", "main switch pauses everyone");
  assert.strictEqual(cli("lesson", "--project", code, "--dept", "Copywriter", "--what", "x", "--type", "Win", "--change", "y").code, 3, "Project Director commands obey the main switch");
  assert.strictEqual(cli("autowork", "--agent", "Nobody").j.ok, false, "unknown work mate refused");
  await pausedFile(["all", "On"]); pf = await pausedFile(["Copywriter", "On"]); fs.writeFileSync(file, pf);
  assert.strictEqual(cli("autowork", "--agent", "Copywriter").j.go, true, "back on: go");
  await ctx.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true });
  return "agent data helper reads the synced data file, writes records, submissions, reviews, issues, CEO decisions and lessons the app loads back, obeys the Auto-work switch (paused scheduled runs skip, Run now goes ahead), and refuses what agents may not do";
};
