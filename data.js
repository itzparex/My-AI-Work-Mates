/* My AI Work Mates: the shared project data model (backlog 2a).
   One model for every page: projects, tasks, deliverables, decisions, issues and lessons, saved under "mawm-data-v1".
   Step 2a-i: the model, a safe migration that builds it from the data each page saved before, and checks.
   Step 2a-ii: the CEO and Project Director page (hq.html) reads its projects, tasks, decisions (waiting and decided),
   issues and lessons from the model (readHq) and saves through it (writeHq), which also keeps the old key current so
   pages that don't read the model yet keep working. Decided decisions are kept as their own history.
   Step 2a-iii: the department pages (dept.html) read projects, tasks, their decisions and issues from the model (deptView),
   log issues and CEO decisions through one helper (report) instead of writing the CEO's saved data themselves, and save
   their own records (the deliverables) through saveDept, which keeps the model's deliverables current.
   The old saved data is never changed or deleted by the migration: a one-time backup copy is kept under "mawm-data-backup-v0",
   and the model is rebuilt from the saved data whenever a page saves.
   Used by hq.html, dept.html and studio.html as window.MAWM_DATA. No network, no accounts: everything stays on this device. */
(function (g) {
  "use strict";
  const KEY = "mawm-data-v1", BACKUP = "mawm-data-backup-v0", VERSION = 1;
  /* where each page saved its data before the shared model */
  const SOURCES = [
    ["facelove-hq-v1", "CEO and Project Director", "projects, tasks, decisions, issues, lessons"],
    ["mawm-dept-research", "Research & Strategist", "briefs, nine documents, Booklet, person tasks"],
    ["mawm-dept-copy", "Copywriter", "copy maps"],
    ["mawm-dept-graphic", "Graphic Designer", "image sets"],
    ["mawm-dept-shopify", "Shopify Developer", "builds, theme backups"],
    ["facelove-studio-v2", "UI/UX Designer", "concepts, Code Studio items"]
  ];
  const SRC_KEYS = new Set(SOURCES.map(s => s[0]));
  const TASK_STATUSES = ["Not started", "In progress", "Waiting on approval", "Waiting on a person", "Done", "Blocked"];
  /* the model: every collection, what it holds and its fields [name, meaning] */
  const SCHEMA = {
    projects: { label: "Projects", what: "One per client job. The project code is its ID and links everything else.", fields: [["id", "Project code, e.g. FL-PDP"], ["name", "Project name"], ["client", "Client"], ["product", "Product"], ["goal", "Goal and success number"], ["markets", "Markets"], ["depth", "Full or Quick"], ["start", "Start date"], ["due", "Launch due"], ["priority", "Priority"], ["status", "Planning, Active, Launched or Closed"]] },
    tasks: { label: "Tasks", what: "The Project Director's timeline steps, plus person tasks only a person can do.", fields: [["id", "Task ID, e.g. FL-PDP-04"], ["project", "Project code"], ["name", "What the task is"], ["dept", "Who does it"], ["kind", "step, gate or person"], ["start", "Start date"], ["due", "Due date"], ["status", TASK_STATUSES.join(", ")]] },
    deliverables: { label: "Deliverables", what: "Everything a department hands on: briefs, research documents, the Booklet, copy maps, image sets, concepts, Code Studio items, builds and theme backups.", fields: [["id", "Department:section:item"], ["project", "Project code (empty: shared across projects)"], ["dept", "Department that made it"], ["kind", "What it is"], ["title", "Name"], ["status", "Its status in the department"], ["version", "Version, when it has one"], ["source", "Where its full content lives"]] },
    decisions: { label: "Decisions", what: "Everything that needs the CEO: approvals, guardrail overrides and escalations, waiting or decided.", fields: [["id", "Decision ID"], ["project", "Project code"], ["type", "Approval, Override or Escalation"], ["title", "What is being decided"], ["detail", "The situation"], ["rec", "Project Director's recommendation"], ["status", "Waiting on CEO or Decided"], ["result", "The CEO's answer"], ["date", "When it was decided"]] },
    issues: { label: "Issues", what: "The Project Director's issues log: every problem, block and guardrail question.", fields: [["id", "IS-number"], ["date", "Date logged"], ["project", "Project code"], ["dept", "Department"], ["what", "What happened"], ["type", "Type"], ["sev", "Low, Medium or High"], ["told", "What the CEO was told"], ["decision", "CEO decision"], ["status", "Open, Waiting on CEO or Resolved"]] },
    lessons: { label: "Lessons", what: "The Project Director's lessons log: what to do differently next time.", fields: [["id", "LL-number"], ["date", "Date"], ["project", "Project code"], ["dept", "Department"], ["what", "What happened"], ["type", "Type"], ["change", "What changes"]] }
  };
  const NINE8 = "8. Marketer's Booklet";
  /* department rows that are deliverables: [source key, department, section, kind, title] */
  const DELIV = [
    ["mawm-dept-research", "Research & Strategist", "briefs", () => "Research brief", r => (r.product || r.project || "Research") + " brief"],
    ["mawm-dept-research", "Research & Strategist", "documents", r => r.doc === NINE8 ? "Marketer's Booklet" : "Research document", r => r.doc || "Research document"],
    ["mawm-dept-copy", "Copywriter", "copymaps", () => "Copy map", r => (r.page || "Page") + " copy map" + (r.version ? " v" + r.version : "")],
    ["mawm-dept-graphic", "Graphic Designer", "images", () => "Image set", r => r.set || "Image set"],
    ["mawm-dept-shopify", "Shopify Developer", "builds", () => "Shopify build", r => r.theme || ((r.project || "") + " build " + (r.date || "")).trim()],
    ["mawm-dept-shopify", "Shopify Developer", "backups", () => "Theme backup", r => "Backup of " + (r.theme || "live theme") + (r.date ? " · " + r.date : "")]
  ];
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
  const ls = (() => { try { return g.localStorage } catch (e) { return null } })();
  const raw = k => { try { return ls ? ls.getItem(k) : null } catch (e) { return null } };
  const parse = s => { try { return s ? JSON.parse(s) : null } catch (e) { return undefined } };
  const arr = x => Array.isArray(x) ? x : [];
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined) r[k] = o[k] }); return r };
  const omit = (o, keys) => { const r = Object.assign({}, o); keys.forEach(k => delete r[k]); return r };
  const HQ = "facelove-hq-v1", HQ_SETTINGS = ["sel", "reviews", "claude", "autowork"];

  /* Build the model from the data the pages saved before. Pure: reads only, never writes. */
  function build() {
    const meta = { version: VERSION, built: new Date().toISOString(), sources: {} };
    const m = { projects: [], tasks: [], deliverables: [], decisions: [], issues: [], lessons: [] };
    const src = {};
    SOURCES.forEach(([k]) => { const s = raw(k), v = parse(s); src[k] = v || null; meta.sources[k] = { found: s != null, bytes: s ? s.length : 0, unreadable: v === undefined } });
    const hq = src["facelove-hq-v1"] || {};
    arr(hq.projects).forEach(p => {
      if (!p || !p.code) return;
      /* every field is kept (lossless), so the CEO page can read the model back exactly as it saved it */
      m.projects.push(Object.assign({ id: p.code }, omit(p, ["tasks"])));
      arr(p.tasks).forEach(t => t && m.tasks.push(Object.assign({ id: t.id, project: p.code, kind: t.gate ? "gate" : "step" }, omit(t, ["id", "gate"]))));
    });
    arr(hq.decisions).forEach(d => d && m.decisions.push(Object.assign({}, d, { status: "Waiting on CEO" })));
    /* decided history (2a-ii): each decision the CEO made, with the answer, date and the issue it was recorded in */
    const decidedIssues = new Set();
    arr(hq.decided).forEach(d => { if (!d) return; m.decisions.push(Object.assign({}, d, { status: "Decided" })); if (d.issue) decidedIssues.add(d.issue) });
    /* older decisions only live on in the issues log (dept "CEO decision"): shown as decided, marked as read from the log */
    arr(hq.issues).filter(i => i && i.dept === "CEO decision" && !decidedIssues.has(i.id)).forEach(i => m.decisions.push({ id: "DEC-" + i.id, project: i.project, type: /override/i.test(i.type || "") ? "Override" : (i.type || "Decision"), title: i.what, rec: i.told, status: "Decided", result: i.decision, date: i.date, issue: i.id, from: "issues" }));
    arr(hq.issues).forEach(i => i && m.issues.push(Object.assign({}, i)));
    arr(hq.lessons).forEach(l => l && m.lessons.push(Object.assign({}, l)));
    /* person tasks from the Research & Strategist */
    const rs = src["mawm-dept-research"] || {};
    arr(rs.rows && rs.rows.persontasks).forEach(r => m.tasks.push({ id: "PT-" + r._id, project: r.project || "", name: r.task || "Person task", dept: "Person (CEO or assigned)", kind: "person", due: r.due || "", status: r.status === "Done" ? "Done" : "Waiting on a person", source: { key: "mawm-dept-research", path: "rows.persontasks", row: r._id } }));
    /* department deliverables */
    DELIV.forEach(([k, dept, sec, kind, title]) => {
      const s = src[k]; arr(s && s.rows && s.rows[sec]).forEach(r => {
        if (!r) return;
        m.deliverables.push({ id: k.replace("mawm-dept-", "") + ":" + sec + ":" + r._id, project: r.project || "", dept, kind: kind(r), title: title(r), status: r.status || "", version: r.version || "", updated: r.updated || r.date || "", source: { key: k, path: "rows." + sec, row: r._id } });
      });
    });
    const st = src["facelove-studio-v2"] || {};
    arr(st.concepts).filter(c => c && c.stage !== "Ideas").forEach(c => m.deliverables.push({ id: "uiux:concepts:" + c.id, project: c.project || "", dept: "UI/UX Designer", kind: "Design concept", title: c.name || "Concept", status: c.stage || "", version: "", updated: c.updated || "", source: { key: "facelove-studio-v2", path: "concepts", row: c.id }, example: !!c.example }));
    arr(st.items).forEach(c => c && m.deliverables.push({ id: "uiux:items:" + c.id, project: c.project || "", dept: "UI/UX Designer", kind: "Code Studio item", title: c.name || "Item", status: c.status || "", version: c.version != null ? String(c.version) : "", updated: c.updated || "", source: { key: "facelove-studio-v2", path: "items", row: c.id }, example: !!c.example }));
    meta.counts = Object.fromEntries(Object.keys(m).map(k => [k, m[k].length]));
    /* page settings that travel with the CEO's data (selected project, plan usage notes, Auto-work later) */
    const settings = { hq: pick(hq, HQ_SETTINGS) };
    return Object.assign({ meta }, m, { settings });
  }

  /* Checks on the model: [level ("bad" | "warn" | "ok"), text] */
  function check(m) {
    m = m || load(); if (!m) return [["warn", "The shared model hasn't been built on this device yet."]];
    const out = [], codes = new Set(m.projects.map(p => p.id));
    Object.keys(SCHEMA).forEach(c => {
      const seen = new Set(), dup = new Set(), noId = arr(m[c]).filter(x => !x.id).length;
      arr(m[c]).forEach(x => { if (!x.id) return; if (seen.has(x.id)) dup.add(x.id); seen.add(x.id) });
      if (dup.size) out.push(["bad", SCHEMA[c].label + ": " + dup.size + " duplicate ID" + (dup.size > 1 ? "s" : "") + " (" + [...dup].slice(0, 3).join(", ") + ")"]);
      if (noId) out.push(["bad", SCHEMA[c].label + ": " + noId + " without an ID"]);
      if (c !== "projects") {
        const orphan = arr(m[c]).filter(x => x.project && !codes.has(x.project)), none = arr(m[c]).filter(x => !x.project);
        if (orphan.length) out.push(["warn", SCHEMA[c].label + ": " + orphan.length + " point to a project code that doesn't exist (" + [...new Set(orphan.map(x => x.project))].slice(0, 3).join(", ") + ")"]);
        if (none.length && c === "deliverables") out.push(["ok", "Deliverables: " + none.length + " shared across projects (Code Studio items and concepts without a project)"]);
        else if (none.length) out.push(["warn", SCHEMA[c].label + ": " + none.length + " without a project"]);
      }
    });
    const badSt = m.tasks.filter(t => t.status && !TASK_STATUSES.includes(t.status));
    if (badSt.length) out.push(["warn", "Tasks: " + badSt.length + " with an unknown status"]);
    Object.entries(m.meta.sources || {}).forEach(([k, s]) => { if (s.unreadable) out.push(["bad", "Saved data " + k + " couldn't be read; it was left untouched"]) });
    if (!out.some(x => x[0] !== "ok")) out.unshift(["ok", "Every item has a unique ID and every project link points to a real project."]);
    return out;
  }

  function load() { const v = parse(raw(KEY)); return v && v.meta && v.meta.version === VERSION ? v : null }
  function backupInfo() { const v = parse(raw(BACKUP)); return v && v.at ? { at: v.at, keys: Object.keys(v.data || {}), bytes: (raw(BACKUP) || "").length } : null }

  /* Migration: keep a one-time backup of the old saved data, then build and save the model. Old data is never changed. */
  let lastError = "";
  function migrate(reason) {
    if (!ls) return null;
    const prev = load(), log = prev && Array.isArray(prev.meta.log) ? prev.meta.log : [];
    if (!backupInfo()) {
      const data = {}; SOURCES.forEach(([k]) => { const s = raw(k); if (s != null) data[k] = s });
      if (Object.keys(data).length) try { ls.setItem(BACKUP, JSON.stringify({ at: new Date().toISOString(), note: "Copy of the saved data before the shared model (2a). Never changed by the app.", data })); log.unshift([new Date().toISOString(), "Backup of the old saved data kept (" + Object.keys(data).length + " parts)"]) } catch (e) { log.unshift([new Date().toISOString(), "Backup skipped: not enough storage on this device"]) }
    }
    const m = build();
    if (!prev && !Object.values(m.meta.sources).some(s => s.found)) return m; /* nothing saved yet on this device: build once the pages save */
    const first = !prev, changed = !prev || JSON.stringify(prev.meta.counts) !== JSON.stringify(m.meta.counts);
    if (first) log.unshift([m.meta.built, "Shared model built from the saved data (" + Object.entries(m.meta.counts).map(([k, n]) => n + " " + (n === 1 ? k.slice(0, -1) : k)).join(", ") + ")"]);
    else if (changed || reason === "manual") log.unshift([m.meta.built, (reason === "manual" ? "Rebuilt by the CEO" : "Updated after a save") + " (" + Object.entries(m.meta.counts).map(([k, n]) => n + " " + (n === 1 ? k.slice(0, -1) : k)).join(", ") + ")"]);
    m.meta.log = log.slice(0, 20); m.meta.firstBuilt = prev && prev.meta.firstBuilt || m.meta.built;
    try { ls.setItem(KEY, JSON.stringify(m)); lastError = "" } catch (e) { lastError = "Not enough storage on this device to save the shared model." }
    return m;
  }
  /* 2a-ii: the CEO and Project Director page reads its data from the model ... */
  /* projects with their timeline tasks, in the shape the pages used before */
  const projectsOf = m => m.projects.map(p => Object.assign(omit(p, ["id"]), { code: p.code || p.id, tasks: m.tasks.filter(t => t.project === p.id && t.kind !== "person").map(t => Object.assign(omit(t, ["project", "kind"]), { gate: t.kind === "gate" })) }));
  const hasHq = m => !!(m && m.meta.sources && m.meta.sources[HQ] && m.meta.sources[HQ].found);
  function readHq() {
    const m = load(); if (!hasHq(m)) return null;
    const S = Object.assign({}, (m.settings && m.settings.hq) || {}, {
      projects: projectsOf(m),
      decisions: m.decisions.filter(d => d.status !== "Decided").map(d => omit(d, ["status"])),
      decided: m.decisions.filter(d => d.status === "Decided" && d.from !== "issues").map(d => omit(d, ["status"])),
      issues: m.issues.map(i => Object.assign({}, i)), lessons: m.lessons.map(l => Object.assign({}, l))
    });
    return S;
  }
  /* ... and saves through it: the old key is written in the same step (other pages still read it until 2a-iii/2a-iv),
     then the model is rebuilt at once so it is current before the page reads it again. Returns "" or an error message. */
  function writeHq(S) {
    if (!ls) return "This device doesn't allow saving.";
    try { ls.setItem(HQ, JSON.stringify(S)) } catch (e) { return "Not enough storage on this device to save." }
    clearTimeout(t); t = null; migrate("save");
    return lastError;
  }
  /* 2a-iii: what a department page reads from the model: projects and their tasks, plus the decisions and issues that
     came from this department (waiting and decided), newest first. Returns null until the CEO page has saved once. */
  const DEPT_OF = { graphic: "Graphic Designer", shopify: "Shopify Developer", copy: "Copywriter", research: "Research & Strategist" };
  function deptOf(d, m) {
    if (d.dept) return d.dept;
    const k = (d.ai && (d.ai.dept || "graphic")) || (d.build && (d.build.dept || "shopify")); if (k) return DEPT_OF[k] || k;
    const i = d.issue && arr(m && m.issues).find(x => x.id === d.issue); return i ? i.dept : "";
  }
  const byDate = (a, b) => (b.date || b.asked || "") < (a.date || a.asked || "") ? -1 : (b.date || b.asked || "") > (a.date || a.asked || "") ? 1 : 0;
  function deptView(dept) {
    const m = load(); if (!hasHq(m)) return null;
    const own = m.decisions.filter(d => d.from !== "issues" && deptOf(d, m) === dept).map(d => Object.assign({ dept }, d));
    return {
      projects: projectsOf(m),
      waiting: own.filter(d => d.status !== "Decided"),
      decided: own.filter(d => d.status === "Decided").sort(byDate),
      issues: m.issues.filter(i => i.dept === dept).map(i => Object.assign({}, i)),
      built: m.meta.built
    };
  }
  /* the one way a department logs with the Project Director: an issue in the issues log and, when a guardrail or the CEO is
     involved, a CEO decision linked to it. Saved through the model (writeHq). Never contacts anyone.
     o = { dept, project, issue: {what, type, sev, told, decision, status}, decision: {type, title, detail, rec, ...} }
     Returns { id, decision } or { error }. */
  function report(o) {
    if (!ls) return { error: "This device doesn't allow saving." };
    flush();
    let S = readHq(); if (!S) { const v = parse(raw(HQ)); S = v && Array.isArray(v.issues) ? v : null }
    if (!S || !Array.isArray(S.issues)) return { error: "Open the CEO page once on this device first, so the Project Director's log exists." };
    S.decisions = arr(S.decisions);
    const n = S.issues.reduce((mx, i) => Math.max(mx, parseInt(String(i.id || "").replace(/^\D+/, ""), 10) || 0), 0) + 1, id = "IS-" + String(n).padStart(3, "0");
    const project = o.project || "—";
    S.issues.unshift(Object.assign({ id, date: today(), project, dept: o.dept || "—", what: "", type: "Rule hit", sev: "Medium", told: "—", decision: "—", status: "Open" }, o.issue || {}));
    let did = "";
    if (o.decision) { did = Math.random().toString(36).slice(2, 9); S.decisions.unshift(Object.assign({ id: did, project, dept: o.dept || "", issue: id, asked: today() }, o.decision)) }
    const err = writeHq(S);
    return err ? { error: "Couldn't save to the Project Director's log on this device. " + err } : { id, decision: did };
  }
  /* an issue in the Project Director's log, read from the model */
  const issue = id => { const m = load(); return m && arr(m.issues).find(i => i.id === id) || null };
  const hqReady = () => !!readHq() || (() => { const v = parse(raw(HQ)); return !!(v && Array.isArray(v.issues)) })();
  /* a department saves its own records (its deliverables) through the model: the department's key is written and the
     model's deliverables are rebuilt shortly after (at once when the page closes). Returns "" or an error message. */
  function saveDept(key, data) {
    if (!ls) return "This device doesn't allow saving.";
    if (!/^mawm-dept-/.test(key)) return "Not a department's saved data.";
    try { ls.setItem(key, JSON.stringify(data)) } catch (e) { return "Not enough storage on this device to save." }
    touch(); return "";
  }
  /* every decision the CEO made, newest first (decided history plus older ones read from the issues log) */
  const decided = m => arr((m || load() || {}).decisions).filter(d => d.status === "Decided").sort((a, b) => (b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : 0);
  let t = null;
  const touch = () => { clearTimeout(t); t = setTimeout(() => { t = null; migrate("save") }, 400) };
  const flush = () => { if (t) { clearTimeout(t); t = null; migrate("save") } };
  /* keep the model current: rebuild shortly after any page saves to one of the old keys */
  try {
    const set = Storage.prototype.setItem;
    if (!set.__mawm) { const w = function (k, v) { set.call(this, k, v); if (this === ls && SRC_KEYS.has(k)) touch() }; w.__mawm = true; Storage.prototype.setItem = w }
  } catch (e) { }
  g.addEventListener && g.addEventListener("pagehide", flush);
  g.MAWM_DATA = { KEY, BACKUP, VERSION, SOURCES, SCHEMA, TASK_STATUSES, build, check, load, migrate, backupInfo, touch, flush, readHq, writeHq, decided, deptView, report, issue, hqReady, saveDept, HQ, error: () => lastError, today };
  migrate("load");
})(typeof window !== "undefined" ? window : globalThis);
