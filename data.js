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
   Step 2c: gates (gateView, gates, passGate, askOverride): Design approval and Launch approval show everything being approved
   in one view; the Project Director passes a clean gate, and guardrail hits become an Override decision only the CEO can allow.
   Step 2b-iv: the Design Studio submits too: a wireframe (concept), a page design (Code Studio item) and a QA report go to the
   project's Wireframe, Page design and QA tasks the same way; its own records keep only the rulebook checks and QA notes.
   Step 3a: export and import everything as one backup file. Step 3b-i: optional GitHub sync to the CEO's own private repo
   (connectSync, syncSave, syncPeek, syncApply); the token stays on this device. Step 3b-ii: once connected and synced by
   hand once, every save goes to GitHub by itself and a newer copy there is loaded on opening a page (newest wins, warned).
   Step 3b-iii: open pages refresh themselves: GitHub is checked every few minutes and when the tab comes back into view,
   and a change saved in another tab of this device reaches a tab in the background when it's shown again.
   Step W1b: the Auto-work switch (autowork, autoworkState, setAutowork): a main switch and one per work mate, CEO only.
   Used by hq.html, dept.html and studio.html as window.MAWM_DATA. No network unless the CEO connects GitHub sync. */
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
    ["facelove-studio-v2", "UI/UX Designer", "concepts, Code Studio items, QA reports"]
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
    arr(st.qa).forEach(q => q && m.deliverables.push({ id: "uiux:qa:" + q.id, project: q.project || "", dept: "UI/UX Designer", kind: "QA report", title: "QA report v" + (q.version || 1), status: "", version: String(q.version || 1), updated: q.date || "", source: { key: "facelove-studio-v2", path: "qa", row: q.id } }));
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
  const contentOf = x => JSON.stringify([x.projects, x.tasks, x.deliverables, x.decisions, x.issues, x.lessons, x.settings, x.pages]);
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
    /* 3b-ii: only a real change counts for sync (pages that save the same data again on opening don't) */
    if (!lastError && (!c.prev || sig(contentOf(c.prev)) !== sig(contentOf(m)))) markDirty();
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
     Shopify build: Build on duplicate theme, concept: Wireframe, Code Studio item: Page design, QA report: QA), and that task becomes
     "Waiting on approval", so it shows in the review queue with what was submitted. Saved through the model (writeHq).
     Nothing is sent to anyone. */
  const STEP_FOR = { "Marketer's Booklet": /^Research/i, "Research document": /^Research/i, "Copy map": /copy/i, "Image set": /image/i, "Shopify build": /^Build/i, "Design concept": /^Wireframe/i, "Code Studio item": /^Page design/i, "QA report": /^QA\b/i };
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
  const LINK = { "Marketer's Booklet": "index.html#/research/booklet", "Research document": "index.html#/research/documents", "Copy map": "index.html#/copy/copymaps", "Image set": "index.html#/graphic/images", "Shopify build": "index.html#/shopify/builds", "Design concept": "index.html#/uiux/concepts", "Code Studio item": "index.html#/uiux/library", "QA report": "index.html#/uiux/review" };
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
  /* 2c: gates. Design approval and Launch approval are the Project Director's gate tasks. gateView puts everything being
     approved in one place: every earlier task with what was submitted and approved on it (tasks before the previous gate are
     marked "earlier": they already passed it), the work that isn't approved yet (the gate waits for it; nobody can override
     that), and the guardrail hits that stop the Project Director passing it alone: open High issues on the project and CEO
     decisions still waiting on it. Open Medium and Low issues are shown as notes. Returns null when it isn't a gate. */
  function gateView(project, taskId, S0) {
    const S = S0 || readHq(), p = S && arr(S.projects).find(x => x.code === project); if (!p) return null;
    const ts = arr(p.tasks), g = ts.findIndex(t => t && t.id === taskId), gt = ts[g]; if (!gt || !gt.gate) return null;
    let from = 0; ts.slice(0, g).forEach((t, i) => { if (t && t.gate) from = i + 1 });
    const items = ts.slice(0, g).filter(Boolean).map((t, i) => { const s = t.submission || null;
      return { id: t.id, name: t.name, dept: t.dept, status: t.status, gate: !!t.gate, earlier: i < from, done: t.status === "Done", submission: s, link: s ? LINK[s.kind] || "" : "", gatePass: t.gatePass || null } });
    const missing = items.filter(x => !x.done);
    const linked = new Set(arr(S.decisions).map(d => d && d.issue).filter(Boolean));
    const open = arr(S.issues).filter(i => i && i.project === p.code && i.status !== "Resolved" && !linked.has(i.id) && !(i.task === gt.id && i.type === "Override request"));
    const guardrails = open.filter(i => i.sev === "High").map(i => ({ kind: "issue", id: i.id, text: i.id + " (High, " + (i.dept || "—") + "): " + (i.what || "") }))
      .concat(arr(S.decisions).filter(d => d && d.project === p.code && !d.gate).map(d => ({ kind: "decision", id: d.id, text: (d.type || "Decision") + " waiting on the CEO: " + (d.title || "") })));
    const notes = open.filter(i => i.sev !== "High").map(i => ({ id: i.id, text: i.id + " (" + (i.sev || "—") + ", " + (i.dept || "—") + "): " + (i.what || "") }));
    const asked = arr(S.decisions).find(d => d && d.gate && d.gate.project === p.code && d.gate.task === gt.id) || null;
    return { project: p.code, projectName: p.name || "", task: { id: gt.id, name: gt.name, status: gt.status, due: gt.due, gatePass: gt.gatePass || null }, items, missing, guardrails, notes, asked,
      ready: gt.status !== "Done" && !missing.length && !guardrails.length, canAsk: gt.status !== "Done" && !missing.length && guardrails.length > 0 && !asked };
  }
  /* every gate on a project, in timeline order */
  const gates = project => { const S = readHq(), p = S && arr(S.projects).find(x => x.code === project); return p ? arr(p.tasks).filter(t => t && t.gate).map(t => gateView(project, t.id, S)) : [] };
  /* the Project Director passes a gate: only when everything before it is approved; with guardrail hits only after the CEO
     allowed the override (o.override, set by the CEO's decision). The gate task becomes Done (approve), the next task starts,
     and what was approved is kept on the gate. o = { note, by, override }. Returns approve's result or { error }. */
  function passGate(project, taskId, o) {
    o = o || {}; const v = gateView(project, taskId); if (!v) return { error: "That isn't a gate on " + project + "'s timeline." };
    if (v.task.status === "Done") return { error: v.task.id + " (" + v.task.name + ") has already passed." };
    if (v.missing.length) return { error: "Not everything is approved yet: " + v.missing.map(x => x.id + " " + x.name).join(", ") + "." };
    if (v.guardrails.length && !o.override) return { error: "Guardrail hits need the CEO: ask for an override." };
    const res = approve(project, taskId, o.note || ""); if (res.error) return res;
    const S = readHq(), p = S && arr(S.projects).find(x => x.code === project), t = p && arr(p.tasks).find(x => x.id === taskId);
    if (t) { t.gatePass = { at: today(), by: o.by || "Project Director", override: !!o.override, note: String(o.note || "").trim(), approved: v.items.filter(x => !x.earlier).map(x => ({ id: x.id, name: x.name, title: x.submission ? x.submission.title || x.submission.kind || "" : "", version: x.submission ? x.submission.version || "" : "" })), guardrails: v.guardrails.map(x => x.text) }; const err = writeHq(S); if (err) return { error: "Passed, but the gate record couldn't be saved. " + err } }
    return res;
  }
  /* the Project Director informs the CEO: a gate with guardrail hits becomes an Override decision for the CEO (with
     everything being approved and every hit listed), and the request is logged in the issues log. Never contacts anyone. */
  function askOverride(project, taskId, rec) {
    const v = gateView(project, taskId); if (!v) return { error: "That isn't a gate on " + project + "'s timeline." };
    if (v.asked) return { error: "Already with the CEO." };
    if (!v.canAsk) return { error: v.missing.length ? "Wait until everything before the gate is approved." : v.task.status === "Done" ? "This gate has already passed." : "No guardrail hits: pass the gate yourself." };
    const r = String(rec || "").trim(); if (!r) return { error: "Give the CEO your recommendation." };
    const being = v.items.filter(x => !x.earlier && !x.gate).map(x => x.name + (x.submission ? " (" + (x.submission.title || x.submission.kind) + (x.submission.version ? " v" + x.submission.version : "") + ")" : "")).join("; ");
    const hits = v.guardrails.map(x => x.text);
    return report({ dept: "Project Director", project, issue: { what: v.task.name + " needs a guardrail override: " + hits.join(" · "), type: "Override request", sev: "High", told: r, decision: "Waiting on CEO", status: "Waiting on CEO", task: v.task.id },
      decision: { type: "Override", title: "Pass " + v.task.name + " for " + (v.projectName || project) + " despite " + hits.length + " guardrail hit" + (hits.length === 1 ? "" : "s"), detail: "Being approved: " + (being || "—") + ". Guardrail hits: " + hits.join(" · ") + ". If you allow it, the gate passes and the next step starts; if not, it waits until the hits are cleared.", rec: r, gate: { project, task: v.task.id }, hits } });
  }
  /* saves go straight into the model now, so there is nothing waiting to be written (kept for pages that call them) */
  const touch = () => { }, flush = () => { };
  /* the old keys are never written again: a write to one from this window (code that still saves the old way) goes into the
     model instead, and the old key stays as it was */
  /* 3a: export and import all data as one file (a backup, and a manual way to move data between devices).
     The file holds the shared model plus the few things saved beside it; caches that come from GitHub (run records,
     plan usage) and the old read-only backup keys are left out. Importing replaces this device's data, after keeping
     a safety copy of what was here so the CEO can undo it. Nothing is uploaded: the file only goes where the CEO saves it. */
  const FILE_FORMAT = "my-ai-work-mates-backup", FILE_VERSION = 1, BEFORE = "mawm-data-before-import";
  const EXTRA = [
    ["facelove-studio-v2-theme", "Design Studio theme library"],
    ["facelove-hq-v1-ui", "CEO page settings"],
    ["mawm-theme", "Light or dark choice"]
  ];
  const deviceName = () => { try { const u = g.navigator.userAgent || ""; return (/Electron/.test(u) ? "Desktop app" : /iPhone|iPad/.test(u) ? "iPhone or iPad" : /Android/.test(u) ? "Android" : "Browser") + (/Windows/.test(u) ? " on Windows" : /Mac OS X/.test(u) && !/iPhone|iPad/.test(u) ? " on Mac" : /Linux/.test(u) && !/Android/.test(u) ? " on Linux" : "") } catch (e) { return "Unknown device" } };
  /* everything worth keeping, as one object ready to save as a .json file */
  function exportAll() {
    flush(); migrate("load");
    const model = load(), extra = {};
    EXTRA.forEach(([k]) => { const s = raw(k); if (s != null) extra[k] = s });
    return { format: FILE_FORMAT, fileVersion: FILE_VERSION, modelVersion: VERSION, exported: stamp(), device: deviceName(), counts: model ? model.meta.counts : null, model, extra };
  }
  const fileName = d => "my-ai-work-mates-backup-" + (d || today()) + ".json";
  /* read a backup file's text: { ok, file, summary } or { ok: false, error } */
  function readBackup(text) {
    let f; try { f = JSON.parse(text) } catch (e) { return { ok: false, error: "This file isn't a My AI Work Mates backup (it couldn't be read as JSON)." } }
    if (!f || f.format !== FILE_FORMAT) return { ok: false, error: "This file isn't a My AI Work Mates backup." };
    if (f.fileVersion > FILE_VERSION || f.modelVersion !== VERSION) return { ok: false, error: "This backup was made by a different version of the app (data version " + f.modelVersion + "). Refresh the app and try again." };
    const m = f.model;
    if (m != null) {
      if (!m.meta || m.meta.version !== VERSION) return { ok: false, error: "The data inside this backup isn't in the expected shape." };
      const missing = Object.keys(SCHEMA).filter(c => !Array.isArray(m[c]));
      if (missing.length) return { ok: false, error: "The backup is missing parts of the data (" + missing.join(", ") + "). Nothing was changed." };
    }
    const counts = m ? Object.fromEntries(Object.keys(SCHEMA).map(c => [c, m[c].length])) : {};
    const extras = EXTRA.filter(([k]) => f.extra && typeof f.extra[k] === "string").map(e => e[1]);
    const bad = m ? check(m).filter(c => c[0] === "bad").map(c => c[1]) : [];
    return { ok: true, file: f, summary: { exported: f.exported, device: f.device || "", counts, extras, pages: m && m.pages ? Object.keys(m.pages).map(labelOf) : [], bad, empty: !m } };
  }
  /* what's on this device now, in the same terms as a backup summary */
  function summaryNow() { const m = load(); return { counts: m ? Object.fromEntries(Object.keys(SCHEMA).map(c => [c, m[c].length])) : {}, built: m && m.meta.built } }
  /* replace this device's data with a backup file (from readBackup). Returns "" or an error message. */
  function importAll(f, fromSync) {
    if (!ls) return "This device doesn't allow saving.";
    flush();
    /* safety copy of what's here now, so the import can be undone */
    const before = { at: stamp(), note: "This device's data just before a backup file was imported.", model: raw(KEY), extra: {} };
    EXTRA.forEach(([k]) => { const s = raw(k); if (s != null) before.extra[k] = s });
    try { ls.setItem(BEFORE, JSON.stringify(before)) } catch (e) { return "Not enough storage on this device to keep a safety copy, so nothing was imported." }
    const m = f.model ? clone(f.model) : null;
    if (m) {
      /* this device's own old keys stay read-only backups: note them as they are now, so they are never taken in over the imported data */
      const found = SOURCES.filter(([k]) => raw(k) != null).map(s => s[0]);
      m.meta.retired = { at: (m.meta.retired && m.meta.retired.at) || stamp(), keys: found, sigs: Object.fromEntries(SOURCES.map(([k]) => [k, sig(raw(k))])), adopted: [] };
      m.meta.imported = { at: stamp(), exported: f.exported || "", device: f.device || "" };
      m.meta.log = [[stamp(), "Imported from a backup file made " + (f.exported ? f.exported.slice(0, 10) : "earlier") + (f.device ? " on " + f.device : "") + " (" + countsText(m) + "); the data that was here before is kept as a safety copy"]].concat(arr(m.meta.log)).slice(0, 20);
    }
    try {
      if (m) ls.setItem(KEY, JSON.stringify(m)); else ls.removeItem(KEY);
      EXTRA.forEach(([k]) => { const v = f.extra && f.extra[k]; if (typeof v === "string") ls.setItem(k, v) });
    } catch (e) { restoreBefore(before); return "Not enough storage on this device for this backup. Your data was left as it was." }
    lastError = ""; if (!fromSync) markDirty(); return "";
  }
  function restoreBefore(b) {
    try { if (b.model != null) ls.setItem(KEY, b.model); else ls.removeItem(KEY); EXTRA.forEach(([k]) => { if (b.extra && b.extra[k] != null) ls.setItem(k, b.extra[k]) }) } catch (e) { return "Couldn't restore the safety copy on this device." }
    return "";
  }
  /* the safety copy kept by the last import, or null */
  function beforeImport() { const v = parse(raw(BEFORE)); return v && v.at ? { at: v.at, bytes: (raw(BEFORE) || "").length, empty: v.model == null } : null }
  /* undo the last import: put back the data that was here before it. Returns "" or an error message. */
  function undoImport() {
    const b = parse(raw(BEFORE)); if (!b || !b.at) return "There's no import to undo on this device.";
    const err = restoreBefore(b); if (err) return err;
    const m = load(); if (m) { m.meta.log = [[stamp(), "Import undone: the data from before it was put back"]].concat(arr(m.meta.log)).slice(0, 20); try { ls.setItem(KEY, JSON.stringify(m)) } catch (e) { } }
    try { ls.removeItem(BEFORE) } catch (e) { }
    markDirty(); return "";
  }

  /* 3b-i: GitHub sync (optional). The CEO connects a private repo of their own with a fine-grained token; the token and
     settings are kept only on this device (never in backup files). "Save to GitHub" writes the same file as a backup
     (exportAll) to one path in that repo; "Load from GitHub" reads it back and imports it the same way as a backup file
     (with the safety copy and undo). If the copy on GitHub changed since this device last synced (another device saved),
     saving stops with a warning and the CEO chooses. Only api.github.com is contacted (3b-ii adds automatic sync below). */
  const SYNC = "mawm-sync-github", SYNC_STATE = "mawm-sync-state", GH = "https://api.github.com", SYNC_PATH = "my-ai-work-mates-data.json";
  const syncConfig = () => { const v = parse(raw(SYNC)); return v && v.repo && v.token ? v : null };
  const syncState = () => parse(raw(SYNC_STATE)) || {};
  const setSyncState = o => { try { ls.setItem(SYNC_STATE, JSON.stringify(Object.assign(syncState(), o))) } catch (e) { } };
  const b64enc = s => { const b = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < b.length; i += 32768) out += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(out) };
  const b64dec = s => { const bin = atob(String(s || "").replace(/\s/g, "")), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b) };
  const encPath = p => String(p).split("/").map(encodeURIComponent).join("/");
  function ghErr(status, body, what) {
    if (status === 0) return "Couldn't reach GitHub. Check the internet connection and try again.";
    if (status === 401) return "GitHub didn't accept the token (it may be wrong, expired or revoked). Make a new one and connect again.";
    if (status === 403 && /rate limit/i.test(body || "")) return "GitHub's hourly limit was reached. Try again in a while.";
    if (status === 403) return "The token isn't allowed to do this. Give it access to this repo with Contents: Read and write.";
    if (status === 404) return what === "repo" ? "Repo not found, or the token can't see it. Check the name (owner/repo) and that the token has access to it." : "Not found on GitHub.";
    if (status === 409) return "GitHub reported a conflict (the copy there changed at the same moment). Try again.";
    if (status === 422) return "GitHub refused the file (" + ((parse(body) || {}).message || "invalid request") + ").";
    return "GitHub answered with an error (" + status + ").";
  }
  async function gh(cfg, path, init) {
    init = init || {}; let res;
    try { res = await g.fetch(GH + path, Object.assign({}, init, { cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + cfg.token, "X-GitHub-Api-Version": "2022-11-28" }, init.headers || {}) })) }
    catch (e) { return { status: 0, body: "" } }
    return { status: res.status, body: await res.text().catch(() => "") };
  }
  /* connect: check the repo exists, the token can see it, and it is private. Saves the settings on this device only. */
  async function connectSync(o) {
    if (!ls) return { error: "This device doesn't allow saving." };
    const repo = String(o.repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$|\/$/g, ""), token = String(o.token || "").trim(), path = String(o.path || "").trim().replace(/^\/+/, "") || SYNC_PATH;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: "Write the repo as owner/name, for example itzparex/my-agency-data." };
    if (!token) return { error: "Paste the fine-grained token." };
    if (!/\.json$/i.test(path)) return { error: "The file name should end in .json." };
    const cfg = { repo, token, path }, r = await gh(cfg, "/repos/" + repo);
    if (r.status !== 200) return { error: ghErr(r.status, r.body, "repo") };
    const info = parse(r.body) || {};
    if (!info.private) return { error: "That repo is public, so anyone could read your agency's data. Use a private repo." };
    try { ls.setItem(SYNC, JSON.stringify({ repo: info.full_name || repo, token, path, branch: info.default_branch || "", connected: stamp() })); ls.removeItem(SYNC_STATE) } catch (e) { return { error: "Not enough storage on this device to keep the settings." } }
    return { ok: true, repo: info.full_name || repo };
  }
  function disconnectSync() { try { ls.removeItem(SYNC); ls.removeItem(SYNC_STATE) } catch (e) { } }
  /* the copy on GitHub: { missing } or { sha, text, size } or { error } */
  async function remoteGet(cfg) {
    const p = "/repos/" + cfg.repo + "/contents/" + encPath(cfg.path);
    const r = await gh(cfg, p); if (r.status === 404) return { missing: true }; if (r.status !== 200) return { error: ghErr(r.status, r.body), status: r.status };
    const j = parse(r.body) || {}; if (j.type && j.type !== "file") return { error: cfg.path + " in the repo is a folder, not a file. Pick another file name." };
    let text = j.content ? b64dec(j.content) : "";
    if (!text && j.size) { const rr = await gh(cfg, p, { headers: { Accept: "application/vnd.github.raw+json" } }); if (rr.status !== 200) return { error: ghErr(rr.status, rr.body), status: rr.status }; text = rr.body }
    return { sha: j.sha, text, size: j.size || text.length };
  }
  /* what is on GitHub, read like a backup file: { missing } or { ok, summary, file, sha } or { error } */
  async function syncPeek() {
    const cfg = syncConfig(); if (!cfg) return { error: "GitHub sync isn't connected on this device." };
    const r = await remoteGet(cfg); if (r.error || r.missing) return r;
    const b = readBackup(r.text); if (!b.ok) return { error: "The file on GitHub can't be used: " + b.error };
    return Object.assign(b, { sha: r.sha });
  }
  /* save this device's data to GitHub. Stops with { conflict, remote } when the copy there changed since this device last
     synced (or this device never synced and a copy exists), unless o.force. Returns { ok, bytes } or { error }. */
  async function syncSave(o) {
    o = o || {}; const cfg = syncConfig(); if (!cfg) return { error: "GitHub sync isn't connected on this device." };
    const st = syncState(), r = await remoteGet(cfg); if (r.error) return r;
    if (!r.missing && r.sha !== st.sha && !o.force) { const b = readBackup(r.text); return { conflict: true, never: !st.sha, remote: b.ok ? b.summary : null } }
    return writeRemote(cfg, r, o, st);
  }
  /* write this device's data over the copy read as r (its sha), and note it. o = { force, auto, warning } */
  async function writeRemote(cfg, r, o, st) {
    const dirtyWas = st.dirty || ""; let f; exporting = true;
    try { f = exportAll() } catch (e) { return { error: "Couldn't gather the data on this device." } } finally { exporting = false }
    const text = JSON.stringify(f, null, 1), body = { message: (o.auto ? "Synced automatically from " : "Saved from ") + f.device + (f.counts ? " (" + Object.entries(f.counts).map(([k, n]) => n + " " + k).join(", ") + ")" : ""), content: b64enc(text) };
    if (!r.missing) body.sha = r.sha; if (cfg.branch) body.branch = cfg.branch;
    const w = await gh(cfg, "/repos/" + cfg.repo + "/contents/" + encPath(cfg.path), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (w.status !== 200 && w.status !== 201) return { error: ghErr(w.status, w.body), status: w.status };
    const j = parse(w.body) || {}, at = stamp();
    const warning = o.warning || (o.force && !r.missing ? "Replaced a newer copy on GitHub " + (st.sha ? "saved from another device" : "that was there before this device connected") : "");
    const upd = { sha: j.content && j.content.sha, lastSave: at, lastSync: at, remoteExported: f.exported, remoteDevice: f.device, offline: false, error: "" };
    if (warning) Object.assign(upd, { warning, warningAt: at }); else if (!o.auto) Object.assign(upd, { warning: "", warningAt: "" });
    if ((syncState().dirty || "") === dirtyWas) upd.dirty = "";
    setSyncState(upd);
    if (!o.auto || warning) { const m = load(); if (m) { m.meta.log = [[at, (o.auto ? "Synced to GitHub automatically" : "Saved to GitHub") + " (" + cfg.repo + ")" + (o.force && !r.missing ? ", replacing the copy that was there" : "")]].concat(arr(m.meta.log)).slice(0, 20); try { ls.setItem(KEY, JSON.stringify(m)) } catch (e) { } } }
    return { ok: true, bytes: text.length };
  }
  /* load what syncPeek read: replaces this device's data like a backup import (safety copy kept, undo works) */
  function syncApply(peek, o) {
    o = o || {}; if (!peek || !peek.ok) return "Nothing to load.";
    const err = importAll(peek.file, true); if (err) return err;
    const at = stamp(), cfg = syncConfig() || {};
    setSyncState({ sha: peek.sha, lastLoad: at, lastSync: at, remoteExported: peek.file.exported, remoteDevice: peek.file.device || "", warning: o.warning || "", warningAt: o.warning ? at : "", dirty: "", offline: false, error: "" });
    const m = load(); if (m) { m.meta.log = [[at, (o.auto ? "Loaded a newer copy from GitHub automatically (" : "Loaded from GitHub (") + (cfg.repo || "repo") + "), saved there " + (peek.file.exported ? peek.file.exported.slice(0, 10) : "earlier") + (peek.file.device ? " from " + peek.file.device : "")]].concat(arr(m.meta.log)).slice(0, 20); try { ls.setItem(KEY, JSON.stringify(m)) } catch (e) { } }
    return "";
  }
  /* what the page shows: connected repo and file (never the token), last save and load */
  function syncStatus() { const c = syncConfig(); if (!c) return null; const s = syncState(); return { repo: c.repo, path: c.path, connected: c.connected, lastSave: s.lastSave || "", lastLoad: s.lastLoad || "", lastSync: s.lastSync || "", remoteDevice: s.remoteDevice || "", warning: s.warning || "", warningAt: s.warningAt || "", tokenEnd: c.token.slice(-4),
    auto: c.auto !== false, first: !s.sha, dirty: s.dirty || "", offline: !!s.offline, error: s.error || "", busy: !!(s.busy && Date.now() - Date.parse(s.busy) < 60000), waiting: !!s.waiting, lastCheck: s.lastCheck || "", every: CHECK_EVERY } }
  const dismissSyncWarning = () => setSyncState({ warning: "", warningAt: "" });

  /* 3b-ii: automatic sync. While connected (and "Sync automatically" is on), every save marks this device's data as
     changed and is sent to GitHub by itself a few seconds later; on opening a page a newer copy on GitHub is loaded.
     It starts once this device has saved or loaded by hand (so a new device never overwrites or replaces anything on its
     own). If both changed, the newest wins: the newer copy is kept and a warning shows on the Data card and in the header
     (a replaced local copy is kept as the safety copy, so Undo last import brings it back; a replaced GitHub copy stays
     in the repo's history). Offline saves wait and go when the device is back online. Only api.github.com is contacted. */
  const LOCK = "mawm-sync-lock", DELAY = 3000, OPEN_GAP = 20000, CHECK_EVERY = 3 * 60000, LID = Math.random().toString(36).slice(2);
  let timer = null, running = false, exporting = false;
  const autoOn = () => { const c = syncConfig(); return !!(c && c.auto !== false) };
  const emit = d => { try { g.dispatchEvent(new CustomEvent("mawm-sync", { detail: d || {} })) } catch (e) { } };
  function setAutoSync(on) { const c = syncConfig(); if (!c) return; c.auto = !!on; try { ls.setItem(SYNC, JSON.stringify(c)) } catch (e) { } emit({ auto: !!on }); if (on) autoTick("save") }
  function markDirty() { if (exporting || !syncConfig()) return; setSyncState({ dirty: stamp() }); if (autoOn()) pushSoon(DELAY) }
  function pushSoon(ms) { clearTimeout(timer); timer = setTimeout(() => autoTick("save"), ms) }
  /* one sync at a time across this device's tabs and frames */
  function lock() { const v = parse(raw(LOCK)), now = Date.now(); if (v && v.id !== LID && now - v.at < 30000) return false; try { ls.setItem(LOCK, JSON.stringify({ id: LID, at: now })) } catch (e) { return false } return (parse(raw(LOCK)) || {}).id === LID }
  const unlock = () => { const v = parse(raw(LOCK)); if (v && v.id === LID) try { ls.removeItem(LOCK) } catch (e) { } };
  const typing = () => { try { const a = g.document.activeElement; return !!(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) } catch (e) { return false } };
  const when = iso => { try { return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) } catch (e) { return iso || "" } };
  async function autoTick(why) {
    const cfg = syncConfig(); if (!cfg || cfg.auto === false || running) return;
    const st = syncState(); if (!st.sha) return; /* starts after this device's first Save or Load */
    if (why === "open" && !st.dirty && st.lastCheck && Date.now() - Date.parse(st.lastCheck) < OPEN_GAP) return;
    if (why !== "open" && !st.dirty) return;
    if (g.navigator && g.navigator.onLine === false) { if (st.dirty) { setSyncState({ offline: true }); emit() } return }
    if (!lock()) { pushSoon(DELAY * 2); return }
    running = true; setSyncState({ busy: stamp() }); emit({ busy: true });
    try { await autoRun(cfg) } catch (e) { setSyncState({ error: "Automatic sync stopped unexpectedly. Try Save to GitHub." }) }
    finally { running = false; unlock(); setSyncState({ busy: "", lastCheck: stamp() }); emit({}) }
  }
  function failed(r) {
    if (r.status === 0) { setSyncState({ offline: true }); pushSoon(60000) }
    else if (r.status === 409) pushSoon(DELAY);
    else setSyncState({ error: r.error, errorAt: stamp() });
  }
  async function autoRun(cfg) {
    const st = syncState(), r = await remoteGet(cfg); if (r.error) return failed(r);
    const dirty = st.dirty || "";
    if (r.missing || r.sha === st.sha) { /* GitHub has what this device last synced */
      if (!dirty) return setSyncState({ offline: false, error: "" });
      const w = await writeRemote(cfg, r, { auto: true }, st); if (w.error) failed(w); return;
    }
    const b = readBackup(r.text); if (!b.ok) return setSyncState({ error: "The file on GitHub can't be used: " + b.error });
    const remoteAt = b.file.exported || "", from = b.file.device ? " from " + b.file.device : "";
    if (dirty && dirty > remoteAt) { /* newest wins: this device changed after the copy on GitHub was saved */
      const w = await writeRemote(cfg, r, { auto: true, force: true, warning: "Both changed: this device's newer changes (" + when(dirty) + ") replaced the copy on GitHub saved " + when(remoteAt) + from + ". That version stays in the repo's history on GitHub." }, st);
      if (w.error) failed(w); return;
    }
    const warning = dirty ? "Both changed: a newer copy on GitHub (saved " + when(remoteAt) + from + ") replaced this device's changes from " + when(dirty) + ". Undo last import on CEO → Data puts this device's version back." : "";
    const peek = Object.assign(b, { sha: r.sha });
    if (typing()) { setSyncState({ waiting: true }); offerLoad(peek, warning); return }
    const err = syncApply(peek, { auto: true, warning }); if (err) return setSyncState({ error: err });
    emit({ loaded: true }); softReload();
  }
  /* the CEO is typing: don't swap the data underneath; offer to load it */
  function offerLoad(peek, warning) {
    bar("Newer data is on GitHub" + (peek.file.device ? " (saved from " + String(peek.file.device).replace(/[<>&"]/g, "") + ")" : "") + ".", "Load it",
      el => { const err = syncApply(peek, { auto: true, warning }); if (err) { el.querySelector("span").textContent = err; return } softReload() });
  }
  function bar(text, label, go) {
    const d = g.document; if (!d || !d.body || d.getElementById("mawmSyncBar")) return;
    const el = d.createElement("div"); el.id = "mawmSyncBar"; el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:200;background:var(--ink,#24152b);color:var(--bg,#fff);padding:10px 12px 10px 16px;border-radius:12px;display:flex;gap:12px;align-items:center;font:600 13px/1.4 var(--f-body,system-ui,sans-serif);box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:calc(100% - 32px)";
    el.innerHTML = '<span></span><button type="button" style="all:unset;cursor:pointer;background:var(--accent,#6a35e8);color:var(--accent-ink,#fff);padding:6px 12px;border-radius:8px;font-weight:700;white-space:nowrap"></button>';
    el.querySelector("span").textContent = text; el.querySelector("button").textContent = label;
    el.querySelector("button").onclick = () => go(el);
    d.body.appendChild(el);
  }
  /* 3b-iii: reload the page in place (same view, same scroll position) so it shows the newest data */
  const SCROLL = "mawm-scroll:";
  function softReload() {
    try { const k = SCROLL + g.location.pathname + g.location.search + g.location.hash; g.sessionStorage.setItem(k, JSON.stringify({ y: g.scrollY || 0, at: Date.now() })) } catch (e) { }
    try { g.location.reload() } catch (e) { }
  }
  function restoreScroll() {
    let v = null; const k = SCROLL + g.location.pathname + g.location.search + g.location.hash;
    try { v = JSON.parse(g.sessionStorage.getItem(k) || "null"); g.sessionStorage.removeItem(k) } catch (e) { }
    if (!v || !(Date.now() - v.at < 15000) || !v.y) return;
    const go = () => { try { g.scrollTo(0, v.y) } catch (e) { } };
    if (g.document.readyState === "complete") setTimeout(go, 60); else g.addEventListener("load", () => setTimeout(go, 60));
  }
  /* the CEO is busy (typing, or a form or pop-up open): never swap the page underneath */
  const busy = () => { if (typing()) return true; try { const d = g.document; return !!d.querySelector("dialog[open], .inline-input, #modalRoot:not(:empty), #uForm:not(:empty)") } catch (e) { return false } };
  /* 3b-iii: open pages refresh themselves. Every few minutes while the tab is shown, and whenever it comes back into view,
     GitHub is checked for a newer copy (when connected). A change saved in another tab of this device (or loaded there from
     GitHub) is drawn at once by pages that update live; a tab in the background refreshes itself when it's shown again,
     unless the CEO is busy there, in which case it offers a Refresh button instead. */
  let stale = false;
  function dataChanged(e) {
    if (!e || e.key !== KEY || e.newValue == null) return;
    const a = parse(e.oldValue), b = parse(e.newValue);
    if (a && b && sig(contentOf(a)) === sig(contentOf(b))) return; /* saved again, nothing new */
    try { g.dispatchEvent(new CustomEvent("mawm-data", { detail: { from: "tab" } })) } catch (err) { }
    if (g.document.hidden) stale = true;
  }
  function shown() {
    if (g.document.hidden) return;
    if (stale) { stale = false; if (busy()) bar("This data was updated in another tab.", "Refresh", softReload); else return softReload() }
    autoTick("open");
  }


  /* W1b: the Auto-work switch (CEO only). One main switch plus one per work mate, saved in the CEO's settings in the model
     (settings.hq.autowork), so it travels in backups and GitHub sync and every device and agent sees it. Every change is kept
     with its date and time. A paused work mate's scheduled runs do nothing but log "Skipped: paused by CEO"; a "Run now" the
     CEO starts still works. Turning it back on changes nothing else: each agent picks up its work where it stopped. */
  const MATES = ["Project Director", "Research & Strategist", "Copywriter", "UI/UX Designer", "Graphic Designer", "Shopify Developer"];
  const isState = v => v === "On" || v === "Paused";
  function autoworkOf(S) {
    const a = S && S.autowork && typeof S.autowork === "object" ? S.autowork : {};
    const mates = {}; MATES.forEach(n => { const v = a.mates && a.mates[n] != null ? a.mates[n] : a[n]; mates[n] = isState(v) ? v : "On" });
    return { main: isState(a.main) ? a.main : "On", mates, log: arr(a.log).filter(x => x && x.at).slice(0, 100), setUp: !!(a.main || a.mates) };
  }
  /* the switch as saved: { main, mates: {name: "On"|"Paused"}, log: [{at, who, state, note}] newest first } */
  const autowork = () => autoworkOf(readHq());
  /* whether one work mate may do scheduled work now: { paused, why ("main" | "own" | ""), text } */
  function autoworkState(name, aw) {
    aw = aw || autowork(); const own = aw.mates[name] === "Paused", main = aw.main === "Paused";
    const why = main ? "main" : own ? "own" : "";
    return { paused: !!why, why, main: aw.main, own: aw.mates[name] || "On", text: why === "main" ? "Paused by CEO (all work mates)" : why === "own" ? "Paused by CEO" : "On" };
  }
  /* the CEO flips a switch: who = "all" (the main switch) or a work mate's name; state = "On" | "Paused".
     Saved through the model (writeHq) with the date and time. Returns { aw } or { error }. */
  function setAutowork(who, state, note) {
    if (!ls) return { error: "This device doesn't allow saving." };
    if (!isState(state)) return { error: "The switch is On or Paused." };
    if (who !== "all" && !MATES.includes(who)) return { error: "Not a work mate: " + who };
    flush();
    const S = readHq(); if (!S) return { error: "Open the CEO page once on this device first." };
    const aw = autoworkOf(S);
    if ((who === "all" ? aw.main : aw.mates[who]) === state) return { aw };
    if (who === "all") aw.main = state; else aw.mates[who] = state;
    aw.log.unshift(Object.assign({ at: stamp(), who: who === "all" ? "All work mates" : who, state, by: "CEO" }, note ? { note: String(note).slice(0, 200) } : {}));
    S.autowork = { main: aw.main, mates: aw.mates, log: aw.log.slice(0, 100) };
    const err = writeHq(S);
    return err ? { error: err } : { aw: autoworkOf(S) };
  }

  try {
    const set = Storage.prototype.setItem;
    if (!set.__mawm) { const w = function (k, v) { if (this === ls && SRC_KEYS.has(k)) { const d = parse(v); if (d) savePart(k, d); return } set.call(this, k, v) }; w.__mawm = true; Storage.prototype.setItem = w }
  } catch (e) { }
  g.MAWM_DATA = { KEY, connectSync, disconnectSync, syncPeek, syncSave, syncApply, syncStatus, setAutoSync, dismissSyncWarning, syncNow: () => autoTick("save"), syncCheck: () => autoTick("open"), SYNC_PATH, BACKUP, VERSION, exportAll, readBackup, importAll, undoImport, beforeImport, summaryNow, fileName, EXTRA, BEFORE, SOURCES, SCHEMA, TASK_STATUSES, build, check, load, migrate, backupInfo, touch, flush, readHq, writeHq, decided, deptView, report, issue, hqReady, saveDept, projects, studio, saveStudio, studioFor, STUDIO, submit, reviewTask, approve, returnTask, gateView, gates, passGate, askOverride, returnedFor, inputsFor, LINK, HQ, page, savePart, retired: () => { const m = load(); return m && m.meta.retired || null }, sig, raw, error: () => lastError, today, MATES, autowork, autoworkOf, autoworkState, setAutowork };
  migrate("load");
  /* 3b-ii: on opening a page, load a newer copy from GitHub (or send changes still waiting); go again when back online */
  if (g.document && syncConfig()) {
    setSyncState({ waiting: false });
    setTimeout(() => autoTick("open"), 400);
    g.addEventListener("online", () => { setSyncState({ offline: false }); autoTick("save") });
    g.addEventListener("offline", () => { if (syncState().dirty) { setSyncState({ offline: true }); emit() } });
  }
  /* 3b-iii: open pages refresh themselves (GitHub every few minutes and on coming back into view; other tabs of this device) */
  if (g.document && g.addEventListener) {
    restoreScroll();
    g.addEventListener("storage", dataChanged);
    g.document.addEventListener("visibilitychange", shown);
    setInterval(() => { if (!g.document.hidden && syncConfig()) autoTick("open") }, CHECK_EVERY);
  }
})(typeof window !== "undefined" ? window : globalThis);
