/* My AI Work Mates: the shared project data model (backlog 2a).
   One model for every page: projects, tasks, deliverables, decisions, issues and lessons, saved under "mawm-data-v1".
   Step 2a-i: the model, a safe migration that builds it from the data each page saved before, and checks.
   Step 2a-ii: the CEO and Project Director page (hq.html) reads its projects, tasks, decisions (waiting and decided),
   issues and lessons from the model (readHq) and saves through it (writeHq), which also keeps the old key current so
   pages that don't read the model yet keep working. Decided decisions are kept as their own history.
   Step 2a-iii: the department pages (dept.html) read projects, tasks, their decisions and issues from the model (deptView),
   log issues and CEO decisions through one helper (report) instead of writing the CEO's saved data themselves, and save
   their own records (the deliverables) through saveDept, which keeps the model's deliverables current.
   Step 2a-iv (first part): the Design Studio (studio.html) links concepts and Code Studio items to projects through the model
   (projects, studio, saveStudio, studioFor); dept.html reads the Design Studio's work for a project the same way.
   Step 2a-iv-b: the old keys are retired. The model is the one saved source for every page: the CEO's data lives in its
   collections and settings, each department's and the Design Studio's full records in its "pages" part (read with page(),
   saved with savePart()/writeHq/saveDept/saveStudio). The first time a device runs this, the model is built once more from
   the old keys and they become read-only backups: kept, never written again. If an older version of a page (a tab left
   open from before) still writes an old key, the next load notices the change, takes that newer data into the model and logs it.
   A one-time backup copy of the old data is also kept under "mawm-data-backup-v0".
   Step 2b-i: departments submit a deliverable for review (submit): it is attached to their task, which goes to
   "Waiting on approval" in the Project Director's review queue. Step 2b-ii: approving it (approve) marks the task Done and
   the deliverable Approved, starts the next task(s), and the next department sees it as an input (inputsFor). Step 2b-iii:
   returning it (returnTask) sends the task back to "In progress" with comments and logs an issue (returnedFor).
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
  const HQ = "facelove-hq-v1", HQ_PARTS = ["projects", "decisions", "decided", "issues", "lessons"];
  const PAGE_KEYS = SOURCES.map(s => s[0]).filter(k => k !== HQ);

  /* a short fingerprint of a saved value, to notice when an old key changes after it was retired */
  const sig = s => { if (s == null) return ""; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ":" + (h >>> 0).toString(36) };
  /* read the old keys: { src: {key: data or null}, info: {key: {found, bytes, unreadable}} } */
  function readOld() {
    const src = {}, info = {};
    SOURCES.forEach(([k]) => { const s = raw(k), v = parse(s); src[k] = v || null; info[k] = { found: s != null, bytes: s ? s.length : 0, unreadable: v === undefined } });
    return { src, info };
  }
  /* Build the model from the data the pages saved before (the old keys). Pure: reads only, never writes. */
  function build() { const o = readOld(); return buildFrom(o.src, o.info) }
  /* Build the model's collections from each page's data: src = { key: that page's data or null }. Pure. */
  function buildFrom(src, info) {
    const meta = { version: VERSION, built: new Date().toISOString(), sources: {} };
    const m = { projects: [], tasks: [], deliverables: [], decisions: [], issues: [], lessons: [] };
    SOURCES.forEach(([k]) => { const i = info && info[k]; meta.sources[k] = i ? i : { found: src[k] != null, bytes: src[k] != null ? JSON.stringify(src[k]).length : 0, unreadable: false } });
    meta.hasHq = !!src[HQ];
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
    arr(st.items).forEach(c => c && m.deliverables.push(Object.assign({ id: "uiux:items:" + c.id, project: c.project || "", dept: "UI/UX Designer", kind: "Code Studio item", title: c.name || "Item", status: c.status || "", version: c.version != null ? String(c.version) : "", updated: c.updated || "", source: { key: "facelove-studio-v2", path: "items", row: c.id }, example: !!c.example }, c.concept ? { from: "uiux:concepts:" + c.concept } : {})));
    meta.counts = Object.fromEntries(Object.keys(m).map(k => [k, m[k].length]));
    /* page settings that travel with the CEO's data (selected project, reviews, plan usage notes, Auto-work later):
       everything the CEO page saved besides the collections, so it reads back exactly as saved */
    const settings = { hq: omit(hq, HQ_PARTS) };
    /* the full records of the department pages and the Design Studio (2a-iv-b: the model is their saved source) */
    const pages = {}; PAGE_KEYS.forEach(k => { if (src[k] != null) pages[k] = src[k] });
    return Object.assign({ meta }, m, { settings, pages });
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
    const r = m.meta.retired;
    if (!r) out.push(["warn", "The old saved keys haven't been retired on this device yet (open any page once)."]);
    else {
      const changed = SOURCES.filter(([k]) => sig(raw(k)) !== (r.sigs || {})[k]).map(s => s[1]);
      if (changed.length) out.push(["warn", "Old saved data changed since it was retired (" + changed.join(", ") + "); it is taken into the model the next time a page opens."]);
      else if (arr(r.adopted).length) out.push(["warn", "An older version of a page saved to an old key after it was retired (" + [...new Set(arr(r.adopted).map(a => a[1]))].join(", ") + "); its newer data was taken into the model. Refresh any tab left open from before."]);
      else out.push(["ok", "Every page saves to the shared model only; the old keys are read-only backups, untouched since they were retired."]);
    }
    if (!out.some(x => x[0] !== "ok")) out.unshift(["ok", "Every item has a unique ID and every project link points to a real project."]);
    return out;
  }

  function load() { const v = parse(raw(KEY)); return v && v.meta && v.meta.version === VERSION ? v : null }
  function backupInfo() { const v = parse(raw(BACKUP)); return v && v.at ? { at: v.at, keys: Object.keys(v.data || {}), bytes: (raw(BACKUP) || "").length } : null }

  /* 2a-ii: the CEO page's data, rebuilt from the model's collections and settings in the shape the page saves */
  /* projects with their timeline tasks, in the shape the pages used before */
  const projectsOf = m => m.projects.map(p => Object.assign(omit(p, ["id"]), { code: p.code || p.id, tasks: m.tasks.filter(t => t.project === p.id && t.kind !== "person").map(t => Object.assign(omit(t, ["project", "kind"]), { gate: t.kind === "gate" })) }));
  const hasHq = m => !!(m && (m.meta.hasHq || (m.meta.sources && m.meta.sources[HQ] && m.meta.sources[HQ].found)));
  function hqOf(m) {
    if (!hasHq(m)) return null;
    return Object.assign({}, (m.settings && m.settings.hq) || {}, {
      projects: projectsOf(m),
      decisions: m.decisions.filter(d => d.status !== "Decided").map(d => omit(d, ["status"])),
      decided: m.decisions.filter(d => d.status === "Decided" && d.from !== "issues").map(d => omit(d, ["status"])),
      issues: m.issues.map(i => Object.assign({}, i)), lessons: m.lessons.map(l => Object.assign({}, l))
    });
  }
  const readHq = () => hqOf(load());
  const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
  const labelOf = k => (SOURCES.find(s => s[0] === k) || [k, k])[1];
  const stamp = () => new Date().toISOString();
  const countsText = m => Object.entries(m.meta.counts).map(([k, n]) => n + " " + (n === 1 ? k.slice(0, -1) : k)).join(", ");

  /* The data every page saved, as it stands now: from the model once the old keys are retired (taking in any old key an
     older version of a page wrote since), otherwise from the old keys. Reads only. */
  function current() {
    const prev = load(), log = prev && Array.isArray(prev.meta.log) ? prev.meta.log.slice() : [];
    if (prev && prev.meta.retired) {
      const retired = clone(prev.meta.retired), src = {};
      src[HQ] = hqOf(prev); PAGE_KEYS.forEach(k => { src[k] = prev.pages && prev.pages[k] != null ? prev.pages[k] : null });
      let adopted = false;
      SOURCES.forEach(([k]) => {
        const s = raw(k), now = sig(s); if (now === (retired.sigs || {})[k]) return;
        retired.sigs[k] = now; adopted = true; const v = parse(s);
        if (v) { src[k] = v; retired.adopted = [[stamp(), labelOf(k)]].concat(arr(retired.adopted)).slice(0, 10); log.unshift([stamp(), labelOf(k) + ": an older version of the page saved to its old key after it was retired; that newer data was taken into the model"]) }
      });
      return { prev, src, log, retired, adopted, info: null };
    }
    const o = readOld();
    return { prev, src: o.src, log, retired: null, adopted: false, info: o.info, fresh: !prev && !Object.values(o.info).some(i => i.found) };
  }
  /* save the model built from c.src: the one place anything is saved (the old keys are never written) */
  function commit(c, reason) {
    const m = buildFrom(c.src, null), log = c.log, first = !c.prev;
    if (!c.retired) {
      const found = SOURCES.filter(([k]) => raw(k) != null).map(s => s[0]);
      c.retired = { at: stamp(), keys: found, sigs: Object.fromEntries(SOURCES.map(([k]) => [k, sig(raw(k))])), adopted: [] };
      if (found.length) log.unshift([c.retired.at, "Old saved keys retired: " + found.length + " part" + (found.length === 1 ? "" : "s") + " kept as read-only backups; every page now saves to the shared model only"]);
    }
    /* sizes: each part as saved in the model; the old key alongside as its backup */
    SOURCES.forEach(([k]) => { const s = raw(k), v = parse(s); m.meta.sources[k].backup = { found: s != null, bytes: s ? s.length : 0, unreadable: v === undefined } });
    const changed = first || JSON.stringify(c.prev.meta.counts) !== JSON.stringify(m.meta.counts);
    if (first) log.unshift([m.meta.built, "Shared model built from the saved data (" + countsText(m) + ")"]);
    else if (changed || reason === "manual") log.unshift([m.meta.built, (reason === "manual" ? "Rebuilt by the CEO" : "Updated after a save") + " (" + countsText(m) + ")"]);
    m.meta.log = log.slice(0, 20); m.meta.firstBuilt = c.prev && c.prev.meta.firstBuilt || m.meta.built; m.meta.retired = c.retired;
    try { ls.setItem(KEY, JSON.stringify(m)); lastError = "" } catch (e) { lastError = "Not enough storage on this device to save the shared model." }
    return m;
  }
  /* Migration: keep a one-time backup of the old saved data, retire the old keys, then build and save the model. */
  let lastError = "";
  function migrate(reason) {
    if (!ls) return null;
    if (!backupInfo()) {
      const data = {}; SOURCES.forEach(([k]) => { const s = raw(k); if (s != null) data[k] = s });
      if (Object.keys(data).length) {
        let note; try { ls.setItem(BACKUP, JSON.stringify({ at: stamp(), note: "Copy of the saved data before the shared model (2a). Never changed by the app.", data })); note = "Backup of the old saved data kept (" + Object.keys(data).length + " part" + (Object.keys(data).length === 1 ? "" : "s") + ")" } catch (e) { note = "Backup skipped: not enough storage on this device" }
        const p = load(); if (p) { p.meta.log = [[stamp(), note]].concat(arr(p.meta.log)).slice(0, 20); try { ls.setItem(KEY, JSON.stringify(p)) } catch (e) { } } else pendingNote = note;
      }
    }
    const c = current();
    if (c.fresh) return buildFrom(c.src, c.info); /* nothing saved yet on this device: the model is saved when a page first saves */
    if (pendingNote) { c.log.unshift([stamp(), pendingNote]); pendingNote = "" }
    if (c.prev && c.retired && !c.adopted && reason !== "manual" && reason !== "view") return c.prev; /* already current */
    return commit(c, reason);
  }
  let pendingNote = "";
  /* save one page's data into the model. Returns "" or an error message. */
  function savePart(key, data) {
    if (!ls) return "This device doesn't allow saving.";
    if (!SRC_KEYS.has(key)) return "Not a page's saved data.";
    const c = current(); c.src[key] = data == null ? null : clone(data);
    commit(c, "save"); return lastError;
  }
  /* one page's saved data from the model (a copy), or null; before the model exists, read from its old key */
  function page(key) {
    if (key === HQ) return readHq();
    const m = load(); if (m && m.meta.retired) return clone(m.pages && m.pages[key]);
    const v = parse(raw(key)); return v || null;
  }
  /* the CEO page saves through the model (its collections and settings). Returns "" or an error message. */
  function writeHq(S) { return savePart(HQ, S) }
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
  /* a department saves its own records (its deliverables) into the model's pages part; the model's deliverables are rebuilt
     in the same step. Returns "" or an error message. */
  function saveDept(key, data) {
    if (!/^mawm-dept-/.test(key)) return "Not a department's saved data.";
    return savePart(key, data);
  }
  /* every decision the CEO made, newest first (decided history plus older ones read from the issues log) */
  const decided = m => arr((m || load() || {}).decisions).filter(d => d.status === "Decided").sort((a, b) => (b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : 0);
  /* 2a-iv: the Design Studio links its work to projects through the model.
     projects(): every project as { code, name, status }, from the model (or the CEO's saved data before the model exists). */
  function projects() {
    const m = load(); let list = m && hasHq(m) ? m.projects.map(p => ({ code: p.code || p.id, name: p.name || "", status: p.status || "" })) : null;
    if (!list) { const v = parse(raw(HQ)); list = arr(v && v.projects).filter(p => p && p.code).map(p => ({ code: p.code, name: p.name || "", status: p.status || "" })) }
    return list;
  }
  const STUDIO = "facelove-studio-v2";
  /* the Design Studio's full saved work (concepts, Code Studio items, references, kit), or null */
  const studio = () => { const v = page(STUDIO); return v && typeof v === "object" ? v : null };
  /* the Design Studio saves into the model's pages part */
  const saveStudio = data => savePart(STUDIO, data);
  /* the concepts (past Ideas) or Code Studio items a department can use for a project: that project's first, then the shared
     ones (no project); work linked to another project is left out unless keep(item) says it is already in use */
  function studioFor(kind, project, keep) {
    const st = studio() || {}; let list = arr(kind === "concepts" ? st.concepts : st.items).filter(Boolean);
    if (kind === "concepts") list = list.filter(c => c.stage !== "Ideas");
    if (!project) return list;
    const mine = list.filter(x => x.project === project), shared = list.filter(x => !x.project), other = list.filter(x => x.project && x.project !== project && keep && keep(x));
    return mine.concat(shared, other);
  }
  /* 2b: a department submits a deliverable for the Project Director's review. It is attached to the project's timeline task
     for that department's step (Booklet: Research, copy map: Product page copy, image set: Carousel and website images,
     Shopify build: Build on duplicate theme, concept: Wireframe, Code Studio item: Page design), and that task becomes
     "Waiting on approval", so it shows in the review queue with what was submitted. Saved through the model (writeHq).
     Nothing is sent to anyone. */
  const STEP_FOR = { "Marketer's Booklet": /^Research/i, "Research document": /^Research/i, "Copy map": /copy/i, "Image set": /image/i, "Shopify build": /^Build/i, "Design concept": /^Wireframe/i, "Code Studio item": /^Page design/i };
  function stepOf(p, dept, kind) {
    const ts = arr(p && p.tasks).filter(t => t && t.dept === dept); if (!ts.length) return null;
    const rx = STEP_FOR[kind]; return (rx && ts.find(t => rx.test(t.name || ""))) || ts.find(t => t.status !== "Done") || ts[0];
  }
  /* the task a deliverable would go to: { id, name, status, submission } or null */
  function reviewTask(project, dept, kind) {
    const S = readHq(), p = S && arr(S.projects).find(x => x.code === project), t = stepOf(p, dept, kind);
    return t ? { id: t.id, name: t.name, status: t.status, submission: t.submission || null, due: t.due } : null;
  }
  /* o = { dept, project, deliv: { id, kind, title, version, section, row }, note }. Returns { task, name } or { error }. */
  function submit(o) {
    if (!ls) return { error: "This device doesn't allow saving." };
    const S = readHq(); if (!S) return { error: "Open the CEO page once on this device first, so the Project Director's timeline exists." };
    const p = arr(S.projects).find(x => x.code === o.project); if (!p) return { error: "Pick a project first: a deliverable goes to review with its project." };
    const d = o.deliv || {}, t = stepOf(p, o.dept, d.kind); if (!t) return { error: "There's no " + o.dept + " task on " + p.code + "'s timeline." };
    if (t.status === "Done") return { error: t.id + " (" + t.name + ") is already approved. Ask the Project Director to reopen it before sending a new version." };
    if (t.status === "Waiting on approval" && t.submission && t.submission.id === d.id) return { error: "Already with the Project Director for review." };
    const sub = Object.assign({ at: today(), dept: o.dept, note: String(o.note || "").trim() }, pick(d, ["id", "kind", "title", "version", "section", "row"]));
    t.history = arr(t.history).concat([{ date: sub.at, what: "Submitted", title: sub.title || "", version: sub.version || "", note: sub.note, by: o.dept }]).slice(-20);
    if (t.returns) sub.after = t.returns; /* 2b-iii: a new version after N returns */
    t.submission = sub; t.status = "Waiting on approval";
    let err = writeHq(S);
    if (!err && sub.section && sub.row != null) { /* 2b-iii: a returned deliverable sent again is waiting on approval again */
      const key = "mawm-dept-" + String(sub.id || "").split(":")[0];
      if (SRC_KEYS.has(key)) { const dd = page(key), r = dd && dd.rows && arr(dd.rows[sub.section]).find(x => x && x._id === sub.row); if (r && r.status === "Returned") { r.status = "Waiting on approval"; err = savePart(key, dd) } }
    }
    return err ? { error: "Couldn't save the submission on this device. " + err } : { task: t.id, name: t.name };
  }
  /* 2b-ii: the Project Director approves a task from the review queue. The task becomes Done, its submitted deliverable is
     marked Approved (on the task and in the department's own records), and the next task(s) on the timeline move to
     "In progress": a "Not started" task starts once every earlier task that ends before it starts is Done (so the images
     step, which runs alongside Page design, starts with it, and Design approval waits for both). Nothing is sent to anyone.
     Returns { task, started: [{id,name,dept}], deliverable } or { error }. */
  const LINK = { "Marketer's Booklet": "index.html#/research/booklet", "Research document": "index.html#/research/documents", "Copy map": "index.html#/copy/copymaps", "Image set": "index.html#/graphic/images", "Shopify build": "index.html#/shopify/builds", "Design concept": "index.html#/uiux/concepts", "Code Studio item": "index.html#/uiux/library" };
  function nextReady(p) {
    const ts = arr(p.tasks), out = [];
    ts.forEach((t, j) => {
      if (!t || t.status !== "Not started") return;
      const before = ts.slice(0, j).filter(k => k && !(k.due >= t.start));
      if (before.length && before.every(k => k.status === "Done") && ts.slice(0, j).some(k => k && k.status === "Done")) out.push(t);
    });
    return out;
  }
  function approve(project, taskId, note) {
    if (!ls) return { error: "This device doesn't allow saving." };
    const S = readHq(); if (!S) return { error: "Open the CEO page once on this device first." };
    const p = arr(S.projects).find(x => x.code === project); if (!p) return { error: "That project no longer exists." };
    const t = arr(p.tasks).find(x => x.id === taskId); if (!t) return { error: "That task is no longer on " + project + "'s timeline." };
    if (t.status === "Done") return { error: t.id + " is already approved." };
    const at = today(); t.status = "Done"; t.doneAt = at;
    let deliv = null;
    if (t.submission) {
      t.submission.approved = at; t.submission.state = "Approved"; if (note) t.submission.pdNote = String(note).trim();
      deliv = t.submission;
    }
    t.history = arr(t.history).concat([{ date: at, what: "Approved", title: deliv ? deliv.title || "" : "", version: deliv ? deliv.version || "" : "", note: String(note || "").trim(), by: "Project Director" }]).slice(-20);
    const started = nextReady(p);
    started.forEach(n => { n.status = "In progress"; n.history = arr(n.history).concat([{ date: at, what: "Started", note: "After " + t.id + " was approved", by: "Project Director" }]).slice(-20) });
    if (arr(p.tasks).every(x => x.status === "Done")) p.status = "Launched"; else if (p.status !== "Planning") p.status = "Active";
    let err = writeHq(S);
    if (!err && deliv && deliv.section && deliv.row != null) {
      const key = "mawm-dept-" + String(deliv.id || "").split(":")[0];
      if (SRC_KEYS.has(key)) {
        const d = page(key), r = d && d.rows && arr(d.rows[deliv.section]).find(x => x && x._id === deliv.row);
        if (r) { r.status = "Approved"; r.approved = { at, task: t.id }; err = savePart(key, d) }
      }
    }
    return err ? { error: "Couldn't save the approval on this device. " + err } : { task: t.id, name: t.name, started: started.map(n => ({ id: n.id, name: n.name, dept: n.dept })), deliverable: deliv };
  }
  /* 2b-iii: the Project Director returns a task from the review queue with comments. The task goes back to "In progress",
     its deliverable is marked Returned (on the task and in the department's own records) with the comments, the number of
     returns is kept on the task, and an issue is logged in the Project Director's log; a task returned more than once is
     flagged as a repeated return (higher severity). Nothing is sent to anyone. Returns { task, issue, returns } or { error }. */
  function returnTask(project, taskId, comment) {
    if (!ls) return { error: "This device doesn't allow saving." };
    const S = readHq(); if (!S) return { error: "Open the CEO page once on this device first." };
    const p = arr(S.projects).find(x => x.code === project); if (!p) return { error: "That project no longer exists." };
    const t = arr(p.tasks).find(x => x.id === taskId); if (!t) return { error: "That task is no longer on " + project + "'s timeline." };
    if (t.status === "Done") return { error: t.id + " is already approved." };
    const c = String(comment || "").trim(); if (!c) return { error: "Say what must change before returning it." };
    const at = today(), n = (parseInt(t.returns, 10) || 0) + 1, deliv = t.submission || null;
    t.status = "In progress"; t.doneAt = undefined; t.returns = n;
    if (deliv) { deliv.state = "Returned"; deliv.returned = at; deliv.comments = c; deliv.returns = n }
    t.history = arr(t.history).concat([{ date: at, what: "Returned", title: deliv ? deliv.title || "" : "", version: deliv ? deliv.version || "" : "", note: c, by: "Project Director" }]).slice(-20);
    S.issues = arr(S.issues);
    const k = S.issues.reduce((mx, i) => Math.max(mx, parseInt(String(i && i.id || "").replace(/^\D+/, ""), 10) || 0), 0) + 1, id = "IS-" + String(k).padStart(3, "0");
    const rep = n > 1, what = (rep ? "Repeated return (" + n + (n === 2 ? "nd" : n === 3 ? "rd" : "th") + " time): " : "Returned: ") + t.name + (deliv && deliv.title ? " · " + deliv.title + (deliv.version ? " v" + deliv.version : "") : "") + " — " + c;
    S.issues.unshift({ id, date: at, project: p.code, dept: t.dept || (deliv && deliv.dept) || "—", what, type: rep ? "Repeated return" : "Error", sev: rep ? "Medium" : "Low", told: "—", decision: "—", status: "Open", task: t.id, returns: n });
    if (deliv) deliv.issue = id;
    if (p.status !== "Planning") p.status = "Active";
    let err = writeHq(S);
    if (!err && deliv && deliv.section && deliv.row != null) {
      const key = "mawm-dept-" + String(deliv.id || "").split(":")[0];
      if (SRC_KEYS.has(key)) {
        const d = page(key), r = d && d.rows && arr(d.rows[deliv.section]).find(x => x && x._id === deliv.row);
        if (r) { r.status = "Returned"; r.returned = { at, task: t.id, comments: c, returns: n, issue: id }; err = savePart(key, d) }
      }
    }
    return err ? { error: "Couldn't save the return on this device. " + err } : { task: t.id, name: t.name, issue: id, returns: n, repeated: rep };
  }
  /* 2b-iii: a department's tasks that came back from the Project Director and are not resubmitted yet, newest first */
  function returnedFor(dept) {
    const S = readHq(), out = []; if (!S) return out;
    arr(S.projects).forEach(p => arr(p.tasks).forEach(t => {
      const s = t && t.submission; if (!t || t.dept !== dept || t.status !== "In progress" || !s || s.state !== "Returned") return;
      out.push({ project: p.code, projectName: p.name || "", task: t.id, taskName: t.name, title: s.title || s.kind || "Deliverable", kind: s.kind || "", version: s.version || "", returned: s.returned, comments: s.comments || "", returns: s.returns || t.returns || 1, issue: s.issue || "", link: LINK[s.kind] || "", due: t.due });
    }));
    return out.sort((a, b) => a.returned < b.returned ? 1 : a.returned > b.returned ? -1 : 0);
  }
  /* 2b-ii: approved deliverables a department works from: for each project where it still has open work, what the other
     departments delivered and the Project Director approved on earlier tasks, newest first */
  function inputsFor(dept) {
    const S = readHq(), out = []; if (!S) return out;
    arr(S.projects).forEach(p => {
      const ts = arr(p.tasks), mine = ts.map((t, i) => [t, i]).filter(([t]) => t && t.dept === dept && t.status !== "Done");
      if (!mine.length) return; const last = mine[mine.length - 1][1], forT = mine[0][0];
      ts.forEach((t, i) => {
        const s = t && t.submission; if (i >= last || t.dept === dept || !s || !s.approved) return;
        out.push({ project: p.code, projectName: p.name || "", task: t.id, taskName: t.name, from: s.dept || t.dept, title: s.title || s.kind || "Deliverable", kind: s.kind || "", version: s.version || "", approved: s.approved, note: s.note || "", link: LINK[s.kind] || "", forTask: forT.id, forName: forT.name });
      });
    });
    return out.sort((a, b) => a.approved < b.approved ? 1 : a.approved > b.approved ? -1 : 0);
  }
  /* saves go straight into the model now, so there is nothing waiting to be written (kept for pages that call them) */
  const touch = () => { }, flush = () => { };
  /* the old keys are never written again: a write to one from this window (code that still saves the old way) goes into the
     model instead, and the old key stays as it was */
  try {
    const set = Storage.prototype.setItem;
    if (!set.__mawm) { const w = function (k, v) { if (this === ls && SRC_KEYS.has(k)) { const d = parse(v); if (d) savePart(k, d); return } set.call(this, k, v) }; w.__mawm = true; Storage.prototype.setItem = w }
  } catch (e) { }
  g.MAWM_DATA = { KEY, BACKUP, VERSION, SOURCES, SCHEMA, TASK_STATUSES, build, check, load, migrate, backupInfo, touch, flush, readHq, writeHq, decided, deptView, report, issue, hqReady, saveDept, projects, studio, saveStudio, studioFor, STUDIO, submit, reviewTask, approve, returnTask, returnedFor, inputsFor, LINK, HQ, page, savePart, retired: () => { const m = load(); return m && m.meta.retired || null }, sig, raw, error: () => lastError, today };
  migrate("load");
})(typeof window !== "undefined" ? window : globalThis);
