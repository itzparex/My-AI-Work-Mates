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
//   review                          tasks "Waiting on approval" (the Project Director's review queue), with gates
//   get      --page <p> [--section <s>] [--project <code>] [--id <row _id>]   a department's records as JSON
//   check                           the app's data checks
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
//   task-status --project <code> --task <id> --status <status> [--note <text>]
//            "In progress", "Waiting on a person" or "Blocked" only (approval goes through submit/approve)
//   approve  --project <code> --task <id> [--note <text>]           Project Director only
//   return   --project <code> --task <id> --comment <text>          Project Director only (logs an issue)
//   pass-gate --project <code> --task <id> [--note <text>]          Project Director only, clean gates only
//   ask-override --project <code> --task <id> --rec <text>          Project Director only: the CEO decides
//   lesson   --project <code> --dept <department> --what <text> --type <t> --change <text>   Project Director only
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

const brief = t => ({ id: t.id, name: t.name, dept: t.dept, kind: t.gate ? "gate" : "step", start: t.start || "", due: t.due || "", status: t.status, submission: t.submission ? { title: t.submission.title, kind: t.submission.kind, version: t.submission.version, at: t.submission.at, state: t.submission.state || "Submitted", note: t.submission.note || "", comments: t.submission.comments || "" } : null, returns: t.returns || 0 });

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
    out({ queue: (S.projects || []).flatMap(p => (p.tasks || []).filter(t => t.status === "Waiting on approval").map(t => Object.assign({ project: p.code, projectName: p.name }, brief(t), t.gate ? { gate: D.gateView(p.code, t.id) } : {}))) });
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

  case "put-row": {
    const p = pageArg(), sec = need("section");
    let o; try { o = JSON.parse(args["json-file"] ? fs.readFileSync(args["json-file"], "utf8") : need("json")) } catch (e) { fail("--json must be one JSON object (" + e.message + ")") }
    if (!o || typeof o !== "object" || Array.isArray(o)) fail("--json must be one JSON object");
    if (o.project) proj(o.project);
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
    proj(project);
    const { list, idKey } = rowsOf(p, sec), r = list.find(x => x && x[idKey] === row); if (!r) fail("No record " + row + " in " + p + " " + sec + ".");
    if (r.project && r.project !== project) fail("That record belongs to " + r.project + ".");
    const deliv = { id: (p === "studio" ? "uiux" : p) + ":" + sec + ":" + row, kind: k[0](r), title: k[1](r), version: String(r.version || ""), section: sec, row };
    const res = D.submit({ dept, project, deliv, note: args.note || "" });
    write(res.error ? res : { task: res.task, name: res.name, deliverable: deliv.title });
    break;
  }
  case "report": {
    const dept = deptArg(), project = need("project"); proj(project);
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
  case "task-status": {
    const project = need("project"), id = need("task"), st = need("status"); if (!SETTABLE.includes(st)) fail("--status can be " + SETTABLE.join(", ") + ". Use submit to send work for approval; only the Project Director approves.");
    const S = D.readHq(), p = (S.projects || []).find(x => x.code === project) || proj(project), t = taskOf(p, id);
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
    S.lessons.unshift({ id, date: D.today(), project, dept: deptArg(), what: need("what"), type: need("type"), change: need("change") });
    write({ lesson: id, err: D.writeHq(S) || undefined });
    break;
  }
  default: fail("Unknown command \"" + cmd + "\". Run node tools/agent-data.js help");
}
