#!/usr/bin/env node
// Reads and changes the app's shared data file for the AI work mates (W1).
// The file is the one the app syncs with GitHub (CEO → Data → Sync with GitHub, default name
// "my-ai-work-mates-data.json"), in the same format as a backup file. Every change goes through the app's own
// data model (data.js), so agents write exactly what the pages would: the same IDs, statuses, review queue,
// issues log and decisions. No packages and no network: the agent pulls and pushes the data repo with git.
//
//   node tools/agent-data.js <command> --file <data file> [options]
//
// Read (never changes the file):
//   summary                         projects, their timeline tasks, decisions waiting on the CEO, open issues
//   work     --dept <department>    that department's open tasks, approved inputs, returned work, its CEO decisions
//                                   (waiting and decided, with the CEO's answer) and its issues
//   review                          tasks "Waiting on approval" (the Project Director's review queue, each with the
//                                   page, section and row to open it with get) and gates in progress (ready, missing
//                                   work, guardrail hits, notes, what is being approved)
//   get      --page <p> [--section <s>] [--project <code>] [--id <row _id>]   a department's records as JSON
//   check                           the app's data checks
//   autowork --agent <work mate> [--run-now] [--record --started <UTC time>]
//            the Auto-work switch, checked first on every run: prints { ok, go, ... }. When the CEO paused Auto-work
//            or this work mate, a scheduled run gets go: false and exit code 3 ("Skipped: paused by CEO"); with
//            --record it also records that skipped run in runs/runs.json. --run-now (a run the CEO started by hand)
//            always gets go: true.
// Write (saves the file only when the change worked; add --dry-run to try without saving):
//   put-row  --page <p> --section <s> (--json '<object>' | --json-file <path>)
//            adds a record, or updates the one with the same _id (fields given replace those fields only)
//   answer   --project <code> --doc <1-7> --q <n> (--answer <text> --ev <EV-001,EV-004> | --unknown --need <text>)
//            Research & Strategist: answers question n (1 = first) of a document's question bank, as on the
//            Question bank page; every ledger ID must already be in the evidence ledger
//   submit   --dept <department> --project <code> --page <p> --section <s> --row <_id> [--note <text>]
//            sends a deliverable to the Project Director's review queue (its task turns "Waiting on approval")
//   report   --dept <department> --project <code> --what <text> [--type <t>] [--sev Low|Medium|High] [--told <text>]
//            [--decision-type Approval|Override|Escalation --decision-title <t> --detail <t> --rec <t>]
//            logs an issue with the Project Director and, with --decision-type, a decision waiting on the CEO
//   ask-ai-image --project <code> --set <image set _id> --slide <slide id> [--why <text>]
//            Graphic Designer: asks the CEO to approve one AI-made product image, as the image set page does: the
//            slide must be marked an AI product image with what it shows and all four spec lines (color, size,
//            packaging, contents); the request appears on AI image approvals and the CEO's Allow or Disallow comes
//            back onto the slide with the date
//   handoff  --project <code>       Research & Strategist: the Marketer's Booklet's 15-point ready-for-handoff checklist,
//                                   worked out exactly as the Booklet page does (checked by the app, ticked by hand, or
//                                   failing, each with its hint). The Booklet can only be submitted when all 15 pass.
//   tick-handoff --project <code> --item <1-15> --why <text> [--untick]
//            Research & Strategist: ticks one of the checklist items the app can't check by itself (4, 7, 9, 10, 12, 14)
//            once it is really true, with the reason; the Booklet page shows who ticked it, when and why. Item 11 (the
//            offer) passes only when the CEO allows the offer decision; nobody else can tick it.
//   task-status --project <code> --task <id> --status <status> [--note <text>]
//            "In progress", "Waiting on a person" or "Blocked" only (approval goes through submit/approve)
//   approve  --project <code> --task <id> [--note <text>]           Project Director only
//   return   --project <code> --task <id> --comment <text>          Project Director only (logs an issue)
//   pass-gate --project <code> --task <id> [--note <text>]          Project Director only, clean gates only
//   ask-override --project <code> --task <id> --rec <text>          Project Director only: the CEO decides
//   lesson   --project <code> --dept <department> --what <text> --type Mistake|Win|"Process gap" --change <text>
//            [--cause <text>] [--fix <text>] [--rulebook <text>]       Project Director only
//
// Auto-work: every write also checks the switch for the work mate doing it (the department for submit, report and
// put-row, the task's department for task-status, the Project Director for its commands). While that work mate is
// paused, a write without --run-now is refused with "Skipped: paused by CEO" and exit code 3, and nothing is saved.
//
// Pages: research, copy, graphic, shopify (department records, "rows.<section>") and studio (Design Studio:
// concepts, items, qa). Departments: "Research & Strategist", "Copywriter", "UI/UX Designer", "Graphic Designer",
// "Shopify Developer", "Project Director". Every write prints one line of JSON: { ok, ... } or { ok: false, error }.
// Nothing here can publish, send, spend or contact anyone, and the CEO's decisions can't be made from here.
"use strict";
const fs = require("fs"), path = require("path");

const DEPTS = ["Research & Strategist", "Copywriter", "UI/UX Designer", "Graphic Designer", "Shopify Developer", "Project Director"];
const PAGES = { research: "mawm-dept-research", copy: "mawm-dept-copy", graphic: "mawm-dept-graphic", shopify: "mawm-dept-shopify", studio: "facelove-studio-v2" };
const PAGE_DEPT = { research: "Research & Strategist", copy: "Copywriter", graphic: "Graphic Designer", shopify: "Shopify Developer", studio: "UI/UX Designer" };
/* what each page submits: [kind, title of the deliverable] (the same as the department pages and the Design Studio) */
const BOOKLET = "8. Marketer's Booklet";
const KINDS = {
  "research:documents": [r => r.doc === BOOKLET ? "Marketer's Booklet" : "Research document", r => r.doc === BOOKLET ? "Marketer's Booklet v" + (r.version || "1") : (r.doc || "Research document")],
  "copy:copymaps": [() => "Copy map", r => (r.page || "Page") + " copy map" + (r.version ? " v" + r.version : "")],
  "graphic:images": [() => "Image set", r => r.set || "Image set"],
  "shopify:builds": [() => "Shopify build", r => r.theme || ((r.project || "") + " build " + (r.date || "")).trim()],
  "studio:concepts": [() => "Design concept", r => r.name || "Concept"],
  "studio:items": [() => "Code Studio item", r => r.name || "Item"],
  "studio:qa": [() => "QA report", r => "QA report v" + (r.version || 1)]
};
/* questions per document in the Research & Strategist question bank (rulebook v1.1, the same order as the app) */
const QB_COUNT = { 1: 8, 2: 8, 3: 6, 4: 5, 5: 4, 6: 6, 7: 5 };
const SETTABLE = ["In progress", "Waiting on a person", "Blocked"];
/* W2-i: the research page's own lists (nine documents, kickoff questions, question bank, Must contain headings), read from
   dept.html so the helper's handoff checklist can never drift from the Booklet page's */
function researchLists() {
  const src = fs.readFileSync(path.resolve(__dirname, "..", "dept.html"), "utf8"), grab = name => {
    const m = src.match(new RegExp("\\nconst " + name + "=([\\s\\S]*?);\\n(?=const |/\\*|function |let )")); if (!m) fail("Couldn't read " + name + " from dept.html");
    return Function('"use strict";return (' + m[1] + ")")();
  };
  return { NINE: grab("NINE"), KICK: grab("KICK"), QB: grab("QB"), MUST: grab("MUST"), SHORT: grab("SHORT") };
}

/* ---- arguments ---- */
const argv = process.argv.slice(2), cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "", args = {};
for (let i = cmd ? 1 : 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith("--")) continue;
  args[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}
const out = o => { process.stdout.write(JSON.stringify(o, null, o && o.ok === undefined ? 2 : 0) + "\n") };
const fail = m => { out({ ok: false, error: m }); process.exit(1) };
const need = k => { const v = args[k]; if (v === undefined || v === "true" || !String(v).trim()) fail("--" + k + " is required"); return String(v).trim() };
const deptArg = (k = "dept") => { const d = need(k); if (!DEPTS.includes(d)) fail("Unknown department \"" + d + "\". Use one of: " + DEPTS.join(", ")); return d };
const pageArg = () => { const p = need("page"); if (!PAGES[p]) fail("Unknown page \"" + p + "\". Use one of: " + Object.keys(PAGES).join(", ")); return p };
if (!cmd || cmd === "help" || args.help) { process.stdout.write(fs.readFileSync(__filename, "utf8").split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n") + "\n"); process.exit(cmd ? 0 : 1) }

/* ---- load the app's data model with a storage of our own (nothing touches a browser or the network) ---- */
const store = new Map();
const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)) }, removeItem: k => { store.delete(k) }, key: i => [...store.keys()][i] || null, get length() { return store.size } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
require(path.resolve(__dirname, "..", "data.js"));
const D = globalThis.MAWM_DATA;
if (!D) fail("Couldn't load the app's data model (data.js).");

const file = path.resolve(need("file"));
if (!fs.existsSync(file)) fail("No data file at " + file + ". Pull the CEO's data repo first; the app creates the file on its first Save to GitHub.");
const text = fs.readFileSync(file, "utf8"), read = D.readBackup(text);
if (!read.ok) fail(read.error);
if (!read.file.model) fail("The data file has no data in it yet. The CEO saves from the app first.");
const imp = D.importAll(read.file, true); if (imp) fail(imp);
const hq = () => D.readHq() || { projects: [], decisions: [], issues: [], lessons: [] };
const proj = code => { const p = (hq().projects || []).find(x => x.code === code); if (!p) fail("No project " + code + ". Projects: " + (hq().projects || []).map(x => x.code).join(", ")); return p };
const taskOf = (p, id) => { const t = (p.tasks || []).find(x => x.id === id); if (!t) fail("No task " + id + " on " + p.code + "'s timeline."); return t };
const rowsOf = (p, sec) => {
  const d = D.page(PAGES[p]) || {};
  if (p === "studio") return { data: d, list: Array.isArray(d[sec]) ? d[sec] : (d[sec] = []), idKey: "id" };
  d.rows = d.rows || {}; return { data: d, list: Array.isArray(d.rows[sec]) ? d.rows[sec] : (d.rows[sec] = []), idKey: "_id" };
};
const savePage = (p, data) => p === "studio" ? D.saveStudio(data) : D.saveDept(PAGES[p], data);

/* W1b-ii: the Auto-work switch. A scheduled run of a paused work mate does nothing; a "Run now" by the CEO goes ahead. */
const runNow = args["run-now"] === "true";
function switchFor(name) {
  const aw = D.autowork(), st = D.autoworkState(name, aw);
  const last = aw.log.find(x => x.who === name || x.who === "All work mates") || null;
  return { st, last: last ? { at: last.at, who: last.who, state: last.state, note: last.note || "" } : null };
}
function obey(name) {
  if (runNow) return;
  const { st, last } = switchFor(name); if (!st.paused) return;
  out({ ok: false, skipped: true, agent: name, error: "Skipped: paused by CEO (" + (st.why === "main" ? "Auto-work is paused for all work mates" : name + " is paused") + "). Nothing was saved. A run the CEO starts by hand uses --run-now.", since: last && last.at || "" });
  process.exit(3);
}

/* save the whole file back in the app's format: the app on every device loads it as a newer copy */
function write(result) {
  if (result && (result.error || result.err)) fail(result.error || result.err);
  if (D.error && D.error()) fail(D.error());
  if (args["dry-run"]) return out(Object.assign({ ok: true, dryRun: true }, result || {}));
  const f = D.exportAll(); f.device = "AI work mate (" + (args.agent || args.dept || "agent") + ")";
  const bad = D.check(f.model).filter(c => c[0] === "bad").map(c => c[1]);
  if (bad.length) fail("The change would break the data (" + bad.join("; ") + "). Nothing was saved.");
  fs.writeFileSync(file + ".tmp", JSON.stringify(f));
  fs.renameSync(file + ".tmp", file);
  out(Object.assign({ ok: true, saved: path.basename(file) }, result || {}));
}

/* where a submitted deliverable lives, so the Project Director can open it with "get --page <p> --section <s> --id <row>" */
const where = s => { const pre = String(s && s.id || "").split(":")[0], p = pre === "uiux" ? "studio" : pre; return PAGES[p] && s.section && s.row != null ? { page: p, section: s.section, row: s.row } : null };
const brief = t => ({ id: t.id, name: t.name, dept: t.dept, kind: t.gate ? "gate" : "step", start: t.start || "", due: t.due || "", status: t.status, submission: t.submission ? Object.assign({ title: t.submission.title, kind: t.submission.kind, version: t.submission.version, at: t.submission.at, dept: t.submission.dept || "", state: t.submission.state || "Submitted", note: t.submission.note || "", comments: t.submission.comments || "" }, where(t.submission) || {}) : null, returns: t.returns || 0 });

/* the Booklet's ready-for-handoff checklist, the same 15 items and rules as handoff() on the Booklet page (dept.html).
   Returns { booklet, items: [{ n, text, state: "pass"|"fail"|"tick", byApp, ticked, hint }], passed, ready } */
const MANUAL_OK = [4, 7, 9, 10, 12, 14];
function handoff(c) {
  const L = researchLists(), S = D.page(PAGES.research) || {}, rows = S.rows || {}, qaAll = S.qa || {}, today = D.today();
  const evList = v => String(v || "").split(/[\s,]+/).filter(Boolean).map(x => x.toUpperCase());
  const ledger = rows.evidence || [], ids = new Set(ledger.map(r => String(r && r.id || "").toUpperCase()).filter(Boolean));
  const evById = id => ledger.find(e => String(e && e.id || "").toUpperCase() === id), overdue = e => !!(e.recheck && e.recheck < today);
  const b = (rows.briefs || []).find(x => x && x.project === c && c), docOf = d => (rows.documents || []).find(r => r && r.project === c && r.doc === L.NINE[d]);
  const docs = L.NINE.map((_, d) => docOf(d)), bk = docs[8], mc = (d, t) => String(((((docs[d] || {}).mc || {})[t]) || {}).t || ""), quick = b && b.depth === "Quick";
  const qaStat = (d, i) => { const x = (qaAll[c] || {})[d + "-" + i]; if (!x) return "Open"; if (x.unk) return "Unknown"; const l = evList(x.ev); return x.a && l.length && l.every(v => ids.has(v)) ? "Answered" : x.a ? "Needs ledger ID" : "Open" };
  const kickN = r => L.KICK.filter((_, i) => String((r.kick || [])[i] || "").trim()).length;
  const header = r => { const d = Math.max(0, L.NINE.indexOf(r.doc)), bb = (rows.briefs || []).find(x => x && x.project === r.project && r.project); return !!(r.project && bb && (r.product || bb.product) && r.date && r.version) };
  const qAll = Object.entries(L.QB).flatMap(([d, qs]) => qs.map((_, i) => qaStat(d, i))), qOpen = qAll.filter(x => !["Answered", "Unknown"].includes(x)).length;
  const pt = (rows.persontasks || []).filter(x => x && x.project === c && x.status !== "Done").length;
  const projEv = (() => { const s = new Set(); Object.values(qaAll[c] || {}).forEach(x => { if (x && !x.unk) evList(x.ev).forEach(i => s.add(i)) }); (rows.documents || []).filter(r => r && r.project === c).forEach(r => { (r.summary || []).forEach(t => (String(t || "").match(/EV-\d+/gi) || []).forEach(i => s.add(i.toUpperCase()))); Object.values(r.mc || {}).forEach(v => evList(v && v.ev).forEach(i => s.add(i))) }); return [...s] })();
  const bkEv = r => [...new Set(L.MUST[8].flatMap(([t]) => { const m = (r.mc || {})[t] || {}; return [...evList(m.ev), ...(String(m.t || "").match(/EV-\d+/gi) || []).map(x => x.toUpperCase())] }))];
  const bkWords = r => L.MUST[8].reduce((n, [t]) => n + String(((r.mc || {})[t] || {}).t || "").split(/\s+/).filter(Boolean).length, 0);
  const ents = projEv.map(evById), miss = projEv.filter((_, i) => !ents[i]), noVerdict = bkEv(bk || {}).map(evById).filter(e => e && !e.use).length, od = ents.filter(e => e && overdue(e)).length;
  const pages = bk ? Math.max(1, Math.ceil(bkWords(bk) / 450)) : 0, maxP = quick ? 4 : 10;
  const v = D.deptView("Research & Strategist"), dec = ((v && v.decided) || []).find(d => d.project === c && d.type === "Approval" && /offer/i.test(d.title || "")) || null;
  const list = [
    ["Kickoff questionnaire answered; path, markets and depth written at the top of every document.", () => { const k = b ? kickN(b) : 0, h = docs.filter(r => r && header(r)).length; return [!!b && k === L.KICK.length && h === 9, b ? `Kickoff ${k} of ${L.KICK.length} · header complete on ${h} of 9 documents` : "No research brief for this project"] }],
    ["Every question bank question answered with a ledger ID or marked Unknown.", () => [qOpen === 0, `${qAll.length - qOpen} of ${qAll.length} done`]],
    ["Every document ends with open questions and a confidence rating.", () => { const n = docs.filter(r => r && r.conf && String(r.confWhy || "").trim()).length; return [n === 9, `Confidence with a reason on ${n} of 9 documents`] }],
    ["All person tasks closed, or listed as open with who owns them.", () => pt ? [null, `${pt} open person task${pt > 1 ? "s" : ""}: tick once each one names who owns it`] : [true, "No open person tasks"]],
    ["Claims check done: every Booklet claim marked Clear, Reword or Do not use.", () => { const n = bkEv(bk || {}).length; return [n > 0 && noVerdict === 0, n ? `${n} ledger entr${n > 1 ? "ies" : "y"} cited in the Booklet${noVerdict ? `, ${noVerdict} without a verdict` : ""}` : "No ledger IDs in the Booklet yet"] }],
    ["No ledger entry used past its recheck date.", () => [projEv.length > 0 && od === 0, projEv.length ? (od ? `${od} cited entr${od > 1 ? "ies are" : "y is"} past the recheck date` : `${projEv.length} cited entries, none overdue`) : "No ledger IDs cited yet"]],
    ["Ledger has an entry for every claim, quote and statistic used.", () => miss.length ? [false, `Cited but not in the ledger: ${miss.join(", ")}`] : [null, "Every cited ID exists. Tick once every quote and number in the documents carries one"]],
    ["Product Deep Dive includes the claim rules (allowed, careful, forbidden).", () => [!!mc(1, "Claim rules").trim(), mc(1, "Claim rules").trim() ? "Claim rules written" : "Claim rules section is empty"]],
    [`Customer Deep Dive has at least ${quick ? "about 20" : "50"} tagged verbatim quotes and an awareness level.`, () => mc(2, "Awareness level").trim() ? [null, "Awareness level written. Tick once the quote count is reached"] : [false, "Awareness level is empty"]],
    [`Competitor table covers at least ${quick ? "3" : "5"} competitors with their offers and ads.`, () => mc(3, "Competitor table").trim() && mc(3, "Their ads").trim() ? [null, "Table and ads written. Tick once the count is reached"] : [false, "Competitor table or Their ads is empty"]],
    ["Offer approved by the CEO, checked against margin, guarantee matching the policy page.", () => { const t = mc(4, "CEO approval").trim(), on = dec && dec.date ? " on " + dec.date : ""; if (dec && /^Disallow/.test(dec.result || "")) return [false, `The CEO disallowed the offer${on} (${dec.id}): revise it and ask again`]; if (!t) return [false, "No CEO approval recorded in Offer Research & Proposal"]; return dec && /^Allow/.test(dec.result || "") ? [true, `Allowed by the CEO${on} (${dec.id}) and recorded in the offer document`] : [null, "Approval recorded in the offer document. Only the CEO ticks this"] }],
    ["Every belief in the chain has A or B proof, or is listed as a gap.", () => mc(5, "Belief chain").trim() && mc(5, "Proof for each belief").trim() ? [null, "Belief chain and proof written. Tick once every belief has A or B proof or sits in Proof gaps"] : [false, "Belief chain or proof is empty"]],
    ["Conversion Strategy names one segment, one angle and the metric to move.", () => { const ok = ["Target segment", "Big idea and main angle", "Success metrics"].every(t => mc(6, t).trim()); return [ok, ok ? "Segment, angle and metrics written" : "Segment, angle or metrics missing"] }],
    [`Vault holds at least ${quick ? "10" : "20"} ranked ideas.`, () => mc(7, "Ideas").trim() ? [null, "Ideas written. Tick once the count is reached and each is ranked"] : [false, "Ideas section is empty"]],
    [`Marketer's Booklet complete, under about ${maxP} pages, every claim carrying its ledger ID.`, () => { if (!bk) return [false, "No Booklet yet"]; const w = L.MUST[8].filter(([t]) => String(((bk.mc || {})[t] || {}).t || "").trim()).length; return [w === 9 && pages <= maxP && bkEv(bk).length > 0, `${w} of 9 parts written · about ${pages} page${pages > 1 ? "s" : ""} (${bkWords(bk)} words)`] }]];
  const st = (S.handoff || {})[c] || {}, by = (S.handoffBy || {})[c] || {};
  const items = list.map(([text, f], i) => { const [ok, hint] = f(), t = !!st[i]; return Object.assign({ n: i + 1, text, state: ok === null ? (t ? "pass" : "tick") : ok ? "pass" : "fail", byApp: ok !== null, hint }, ok === null ? { ticked: t } : {}, ok === null && t && by[i] ? { tickedBy: by[i] } : {}) });
  const passed = items.filter(x => x.state === "pass").length;
  return { booklet: bk ? { id: bk._id, version: String(bk.version || ""), status: bk.status || "" } : null, items, passed, total: items.length, ready: passed === items.length };
}

if (["approve", "return", "pass-gate", "ask-override", "lesson"].includes(cmd)) obey("Project Director");

switch (cmd) {
  case "summary": {
    const S = hq();
    out({ exported: read.file.exported, device: read.file.device, projects: (S.projects || []).map(p => ({ code: p.code, name: p.name, client: p.client, product: p.product, status: p.status, due: p.due, tasks: (p.tasks || []).map(brief) })), decisionsWaiting: (S.decisions || []).map(d => ({ id: d.id, project: d.project, type: d.type, title: d.title, dept: d.dept || "" })), openIssues: (S.issues || []).filter(i => i.status !== "Resolved").map(i => ({ id: i.id, project: i.project, dept: i.dept, sev: i.sev, what: i.what, status: i.status })) });
    break;
  }
  case "work": {
    const dept = deptArg(), S = hq(), v = D.deptView(dept) || { waiting: [], issues: [] };
    out({ dept, tasks: (S.projects || []).flatMap(p => (p.tasks || []).filter(t => t.dept === dept && t.status !== "Done").map(t => Object.assign({ project: p.code, projectName: p.name }, brief(t)))), inputs: D.inputsFor(dept), returned: D.returnedFor(dept), decisionsWaiting: v.waiting.map(d => ({ id: d.id, project: d.project, type: d.type, title: d.title })), decided: (v.decided || []).map(d => ({ id: d.id, project: d.project, type: d.type, title: d.title, result: d.result || "", date: d.date || "" })), openIssues: v.issues.filter(i => i.status !== "Resolved") });
    break;
  }
  case "review": {
    const S = hq();
    out({ queue: (S.projects || []).flatMap(p => (p.tasks || []).filter(t => t.status === "Waiting on approval").map(t => Object.assign({ project: p.code, projectName: p.name }, brief(t), t.gate ? { gate: D.gateView(p.code, t.id) } : {}))),
      gates: (S.projects || []).flatMap(p => (p.tasks || []).filter(t => t.gate && t.status === "In progress").map(t => { const g = D.gateView(p.code, t.id) || {}; return { project: p.code, projectName: p.name, task: t.id, name: t.name, due: t.due || "", ready: !!g.ready, canAsk: !!g.canAsk, asked: g.asked ? { id: g.asked.id, title: g.asked.title } : null, missing: (g.missing || []).map(x => x.id + " " + x.name), guardrails: (g.guardrails || []).map(x => x.text), notes: (g.notes || []).map(x => x.text), approved: (g.items || []).filter(x => !x.earlier && x.done && x.submission).map(x => Object.assign({ task: x.id, title: x.submission.title || x.submission.kind || "", version: x.submission.version || "" }, where(x.submission) || {})) } })) });
    break;
  }
  case "get": {
    const p = pageArg(), d = D.page(PAGES[p]) || {};
    let res = args.section ? (p === "studio" ? d[args.section] : (d.rows || {})[args.section]) || [] : d;
    if (Array.isArray(res) && args.project) res = res.filter(r => r && r.project === args.project);
    if (Array.isArray(res) && args.id) res = res.find(r => r && (r._id === args.id || r.id === args.id)) || null;
    out(res);
    break;
  }
  case "check": out(D.check(D.load()).map(([level, text]) => ({ level, text }))); break;
  case "autowork": {
    const name = args.agent && args.agent !== "true" ? String(args.agent).trim() : deptArg();
    if (!D.MATES.includes(name)) fail("Unknown work mate \"" + name + "\". Use one of: " + D.MATES.join(", "));
    const { st, last } = switchFor(name), go = runNow || !st.paused;
    const res = { ok: true, agent: name, go, run: runNow ? "run-now" : "scheduled", switch: st.paused ? "Paused" : "On", main: st.main, own: st.own, text: go ? (st.paused ? "Paused by CEO, but the CEO started this run by hand: go ahead." : "On: go ahead.") : "Skipped: paused by CEO", lastChange: last };
    if (!go && args.record === "true") {
      const started = args.started && args.started !== "true" ? args.started : new Date().toISOString();
      const r = require("child_process").spawnSync(process.execPath, [path.resolve(__dirname, "record-run.js"), "--agent", name, "--result", "skipped", "--started", started, "--summary", "Skipped: paused by CEO" + (st.why === "main" ? " (all work mates)" : "")], { encoding: "utf8" });
      res.recorded = r.status === 0; if (!res.recorded) res.recordError = (r.stderr || r.stdout || "").trim();
    }
    out(res); if (!go) process.exit(3);
    break;
  }

  case "put-row": {
    const p = pageArg(), sec = need("section");
    let o; try { o = JSON.parse(args["json-file"] ? fs.readFileSync(args["json-file"], "utf8") : need("json")) } catch (e) { fail("--json must be one JSON object (" + e.message + ")") }
    if (!o || typeof o !== "object" || Array.isArray(o)) fail("--json must be one JSON object");
    if (o.project) proj(o.project);
    obey(PAGE_DEPT[p]);
    const { data, list, idKey } = rowsOf(p, sec), id = o[idKey], old = id != null ? list.find(r => r && r[idKey] === id) : null;
    if (old && !args.force) { /* submitted or approved work stays as the Project Director saw it: make a new version instead */
      const did = (p === "studio" ? "uiux" : p) + ":" + sec + ":" + id;
      const on = (hq().projects || []).flatMap(x => x.tasks || []).find(t => t.submission && t.submission.id === did && (t.status === "Waiting on approval" || t.submission.state === "Approved"));
      const st = on ? (on.status === "Waiting on approval" ? "waiting on approval (" + on.id + ")" : "approved (" + on.id + ")") : ["Approved", "Waiting on approval"].includes(old.status) ? old.status.toLowerCase() : "";
      if (st) fail("That record is " + st + ". Add a new version as a new record instead of changing it.");
    }
    if (old) Object.assign(old, o, { updated: D.today() });
    else { if (id == null) o[idKey] = Math.random().toString(36).slice(2, 9); o.updated = D.today(); list.unshift(o) }
    write({ page: p, section: sec, id: o[idKey], added: !old, err: savePage(p, data) || undefined });
    break;
  }
  case "answer": {
    const project = need("project"), d = parseInt(need("doc"), 10), q = parseInt(need("q"), 10); proj(project);
    obey("Research & Strategist");
    if (!QB_COUNT[d]) fail("--doc is 1 to 7 (the documents with a question bank)");
    if (!(q >= 1 && q <= QB_COUNT[d])) fail("Document " + d + " has questions 1 to " + QB_COUNT[d]);
    const data = D.page(PAGES.research) || {}; data.rows = data.rows || {}; data.qa = data.qa || {};
    const key = d + "-" + (q - 1), qa = data.qa[project] || (data.qa[project] = {});
    let o;
    if (args.unknown === "true") o = { a: "", ev: "", unk: true, need: need("need") };
    else {
      const ev = need("ev").split(/[\s,]+/).filter(Boolean).map(x => x.toUpperCase());
      const have = new Set((data.rows.evidence || []).map(e => String(e && e.id || "").toUpperCase()));
      const miss = ev.filter(x => !have.has(x)); if (miss.length) fail("Not in the evidence ledger: " + miss.join(", ") + ". Add the entries with put-row --section evidence first.");
      o = { a: need("answer"), ev: ev.join(", "), unk: false, need: "" };
    }
    qa[key] = Object.assign(qa[key] || {}, o, { by: "Research & Strategist (agent)", updated: D.today() });
    write({ project, question: key, status: o.unk ? "Unknown" : "Answered", err: D.saveDept(PAGES.research, data) || undefined });
    break;
  }
  case "submit": {
    const dept = deptArg(), project = need("project"), p = pageArg(), sec = need("section"), row = need("row"), k = KINDS[p + ":" + sec];
    if (!k) fail("Only these can be submitted: " + Object.keys(KINDS).join(", "));
    if (PAGE_DEPT[p] !== dept) fail(dept + " can't submit the " + PAGE_DEPT[p] + "'s work.");
    proj(project); obey(dept);
    const { list, idKey } = rowsOf(p, sec), r = list.find(x => x && x[idKey] === row); if (!r) fail("No record " + row + " in " + p + " " + sec + ".");
    if (r.project && r.project !== project) fail("That record belongs to " + r.project + ".");
    if (p === "research" && sec === "documents" && r.doc === BOOKLET) { /* as on the Booklet page: only when all 15 handoff checks pass */
      const h = handoff(project); if (h.booklet && h.booklet.id !== row) fail("That isn't " + project + "'s current Booklet (" + h.booklet.id + ").");
      if (!h.ready) fail("The Booklet's ready-for-handoff checklist has " + (h.total - h.passed) + " of " + h.total + " items open: " + h.items.filter(x => x.state !== "pass").map(x => x.n + " (" + x.hint + ")").join("; ") + ". Run handoff --project " + project + " for the details.");
    }
    const deliv = { id: (p === "studio" ? "uiux" : p) + ":" + sec + ":" + row, kind: k[0](r), title: k[1](r), version: String(r.version || ""), section: sec, row };
    const res = D.submit({ dept, project, deliv, note: args.note || "" });
    write(res.error ? res : { task: res.task, name: res.name, deliverable: deliv.title });
    break;
  }
  case "report": {
    const dept = deptArg(), project = need("project"); proj(project); obey(dept);
    const sev = args.sev || "Medium"; if (!["Low", "Medium", "High"].includes(sev)) fail("--sev is Low, Medium or High");
    const o = { dept, project, issue: { what: need("what"), type: args.type || "Rule hit", sev, told: args.told || "—", decision: args["decision-type"] ? "Waiting on CEO" : "—", status: args["decision-type"] ? "Waiting on CEO" : "Open" } };
    if (args["decision-type"]) {
      if (!["Approval", "Override", "Escalation"].includes(args["decision-type"])) fail("--decision-type is Approval, Override or Escalation");
      o.decision = { type: args["decision-type"], title: need("decision-title"), detail: args.detail || "", rec: need("rec"), dept };
    }
    const res = D.report(o);
    write(res.error ? res : { issue: res.id, decision: res.decision || undefined });
    break;
  }
  case "ask-ai-image": {
    const project = need("project"), setId = need("set"), slideId = need("slide"); proj(project); obey("Graphic Designer");
    const data = D.page(PAGES.graphic) || {}; data.rows = data.rows || {};
    const set = (data.rows.images || []).find(x => x && x._id === setId); if (!set) fail("No image set " + setId + ".");
    if (set.project !== project) fail("That image set belongs to " + (set.project || "no project") + ".");
    const s = (set.slides || []).find(x => x && x.id === slideId); if (!s) fail("No image " + slideId + " in that set.");
    if (!s.aiimg) fail("Mark the image as an AI product image first (put-row the set with \"aiimg\": true on that slide).");
    const spec = s.spec || {}, SPEC = [["color", "Color"], ["size", "Size"], ["pack", "Packaging"], ["contents", "Contents"]];
    const missing = SPEC.filter(([k]) => !String(spec[k] || "").trim()).map(([, l]) => l);
    if (!String(s.shows || "").trim() || missing.length) fail("Before asking, the image needs what it shows and the product spec it was checked against" + (missing.length ? " (missing: " + missing.join(", ") + ")" : "") + ".");
    const rows = data.rows.aiimages || (data.rows.aiimages = []), old = s.aiReq && rows.find(x => x._id === s.aiReq);
    const specText = SPEC.map(([k, l]) => l + ": " + String(spec[k] || "").trim()).join(" · "), sig = [s.id, s.slug || "", s.ext || "jpg", String(s.shows || "").trim(), specText].join("|");
    if (old && old.decision === "Waiting on CEO") fail("This image is already waiting on the CEO (" + (old.dec || old._id) + ").");
    if (old && old.decision === "Approved" && (!old.sig || old.sig === sig)) fail("The CEO already approved this exact image on " + (old.date || "an earlier date") + ".");
    const slug = v => String(v || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const kept = (set.slides || []).filter(x => !x.drop), k = kept.indexOf(s), TYPE = { "PDP carousel": "carousel", "Banner": "banner", "Section images": "section", "Icons": "icon", "Pop-up": "popup" };
    const image = k >= 0 ? (slug(set.prefix) || "client-product") + "-" + (TYPE[set.set] || "image") + "-" + String(k + 1).padStart(2, "0") + "-" + (slug(s.slug || s.name) || "image") + "." + (s.ext || "jpg") : (s.name || "image");
    const o = { _id: Math.random().toString(36).slice(2, 9), project, image, slideName: s.name || "", shows: String(s.shows || "").trim(), spec: specText, why: String(args.why || s.aiwhy || "").trim(), set: set._id, slide: s.id, sig };
    const res = D.report({ dept: "Graphic Designer", project,
      issue: { what: "AI product image needs CEO approval: " + image, type: "Override request", sev: "Medium", told: "Sent to the CEO with the product spec it was checked against; the image stays blocked until the CEO decides", decision: "Waiting on CEO", status: "Waiting on CEO" },
      decision: { type: "Override", title: "AI product image: " + image, detail: (o.shows ? o.shows.replace(/\.$/, "") + ". " : "") + (o.why ? "Why AI: " + o.why.replace(/\.$/, "") + ". " : "") + "Checked against the product spec: " + specText + ".", rec: "Allow only if it matches the spec. Approval covers this image only; a changed or new AI product image needs its own approval.", ai: { dept: "graphic", row: o._id } } });
    if (res.error) fail(res.error);
    Object.assign(o, { issue: res.id, dec: res.decision, decision: "Waiting on CEO", asked: D.today(), date: "", note: "" });
    rows.unshift(o); s.aiReq = o._id;
    write({ request: o._id, issue: res.id, decision: res.decision, image, err: D.saveDept(PAGES.graphic, data) || undefined });
    break;
  }
  case "handoff": { const project = need("project"); proj(project); out(Object.assign({ ok: true, project }, handoff(project))); break }
  case "tick-handoff": {
    const project = need("project"), n = parseInt(need("item"), 10), off = args.untick === "true"; proj(project); obey("Research & Strategist");
    if (!(n >= 1 && n <= 15)) fail("--item is 1 to 15");
    if (n === 11) fail("Only the CEO approves the offer: item 11 passes by itself once the CEO allows the offer decision (report --decision-type Approval) and the approval is written in the offer document's CEO approval part.");
    const it = handoff(project).items[n - 1];
    if (it.byApp) fail("Item " + n + " is checked by the app (" + it.hint + "). Fix the work instead of ticking it.");
    if (!MANUAL_OK.includes(n)) fail("Item " + n + " can't be ticked by a work mate.");
    const why = off ? "" : need("why"), data = D.page(PAGES.research) || {}; data.rows = data.rows || {};
    const st = (data.handoff = data.handoff || {})[project] || (data.handoff[project] = {}), by = (data.handoffBy = data.handoffBy || {})[project] || (data.handoffBy[project] = {});
    if (off) { st[n - 1] = false; delete by[n - 1] } else { st[n - 1] = true; by[n - 1] = { by: args.agent || "Research & Strategist (agent)", date: D.today(), why } }
    write({ project, item: n, ticked: !off, err: D.saveDept(PAGES.research, data) || undefined });
    break;
  }
  case "task-status": {
    const project = need("project"), id = need("task"), st = need("status"); if (!SETTABLE.includes(st)) fail("--status can be " + SETTABLE.join(", ") + ". Use submit to send work for approval; only the Project Director approves.");
    const S = D.readHq(), p = (S.projects || []).find(x => x.code === project) || proj(project), t = taskOf(p, id);
    obey(t.dept);
    if (t.status === "Done") fail(t.id + " is already approved.");
    if (t.status === "Waiting on approval") fail(t.id + " is with the Project Director for review.");
    t.status = st; t.history = (t.history || []).concat([{ date: D.today(), what: st, note: args.note || "", by: args.agent || t.dept }]).slice(-20);
    write({ task: t.id, status: st, err: D.writeHq(S) || undefined });
    break;
  }
  case "approve": { const r = D.approve(need("project"), need("task"), args.note || ""); write(r.error ? r : { task: r.task, started: r.started }); break }
  case "return": { const r = D.returnTask(need("project"), need("task"), need("comment")); write(r.error ? r : { task: r.task, issue: r.issue, returns: r.returns, repeated: r.repeated }); break }
  case "pass-gate": { const r = D.passGate(need("project"), need("task"), { note: args.note || "", by: "Project Director" }); write(r.error ? r : { task: r.task, started: r.started }); break }
  case "ask-override": { const r = D.askOverride(need("project"), need("task"), need("rec")); write(r.error ? r : { issue: r.id, decision: r.decision }); break }
  case "lesson": {
    const project = need("project"); proj(project);
    const S = D.readHq(); S.lessons = S.lessons || [];
    const n = S.lessons.reduce((m, l) => Math.max(m, parseInt(String(l && l.id || "").replace(/^\D+/, ""), 10) || 0), 0) + 1, id = "LL-" + String(n).padStart(3, "0");
    S.lessons.unshift(Object.assign({ id, date: D.today(), project, dept: deptArg(), what: need("what"), type: need("type"), change: need("change") }, args.cause ? { cause: args.cause } : {}, args.fix ? { fix: args.fix } : {}, args.rulebook ? { rulebook: args.rulebook } : {}));
    write({ lesson: id, err: D.writeHq(S) || undefined });
    break;
  }
  default: fail("Unknown command \"" + cmd + "\". Run node tools/agent-data.js help");
}
