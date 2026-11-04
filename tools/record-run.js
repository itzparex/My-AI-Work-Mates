#!/usr/bin/env node
// Records one scheduled run (the build loop now, every work mate later) in runs/runs.json.
// The CEO command center reads that file to show each agent's last run, next run and token use.
// No packages needed. Run from the repo root at the end of every run, even when it failed or skipped:
//
//   node tools/record-run.js --agent "Build loop" --result success \
//     --summary "C2b: run records on the CEO page" --produced "C2b" --commit abc1234 \
//     --started 2026-11-04T10:55:00Z [--tokens-in 120000 --tokens-out 9000 | --tokens 129000]
//
// --result is success, failure or skipped. Token numbers are optional: leave them out when the
// session doesn't report them (the page then says "not reported" instead of guessing).
// --schedule-cron "55 */2 * * *" --schedule-tz Asia/Manila --schedule-label "Every 2 hours at :55"
// saves or updates the agent's schedule, which the page uses to work out the next run.
const fs = require("fs"), path = require("path");
const FILE = path.resolve(__dirname, "..", "runs", "runs.json");
const KEEP = 500;
const AGENTS = ["Build loop", "Usage reader", "Project Director", "Research & Strategist", "Copywriter", "UI/UX Designer", "Graphic Designer", "Shopify Developer"];

const args = {}; const list = process.argv.slice(2);
for (let i = 0; i < list.length; i++) {
  const a = list[i]; if (!a.startsWith("--")) continue;
  const k = a.slice(2), v = list[i + 1] && !list[i + 1].startsWith("--") ? list[++i] : "true";
  (args[k] = args[k] || []).push(v);
}
const one = k => args[k] ? args[k][args[k].length - 1] : undefined;
const fail = m => { console.error("record-run: " + m); process.exit(1); };
const num = k => { const v = one(k); if (v === undefined) return null; const n = Number(String(v).replace(/[, _]/g, "")); if (!Number.isFinite(n) || n < 0) fail(`--${k} must be a number`); return Math.round(n); };
const isoOk = s => s && !isNaN(new Date(s));

const agent = one("agent"); if (!agent) fail("--agent is required (" + AGENTS.join(", ") + ")");
if (!AGENTS.includes(agent)) fail(`unknown agent "${agent}". Use one of: ${AGENTS.join(", ")}`);

const data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { version: 1, schedules: {}, runs: [] };
data.schedules = data.schedules || {}; data.runs = data.runs || [];

if (one("schedule-cron")) {
  const cron = one("schedule-cron").trim(); if (cron.split(/\s+/).length !== 5) fail("--schedule-cron needs 5 fields");
  data.schedules[agent] = { ...(data.schedules[agent] || {}), cron, tz: one("schedule-tz") || "UTC", label: one("schedule-label") || cron, ...(one("schedule-task") ? { task: one("schedule-task") } : {}) };
}
if (one("unschedule")) delete data.schedules[agent];

if (one("result")) {
  const result = one("result"); if (!["success", "failure", "skipped"].includes(result)) fail("--result must be success, failure or skipped");
  const finished = one("finished") || new Date().toISOString(), started = one("started") || null;
  if (!isoOk(finished) || (started && !isoOk(started))) fail("--started and --finished must be dates like 2026-11-04T10:55:00Z");
  let ti = num("tokens-in"), to = num("tokens-out"), tt = num("tokens");
  if (tt === null && ti !== null && to !== null) tt = ti + to;
  const run = {
    id: agent.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + new Date(finished).toISOString().replace(/[-:]/g, "").slice(0, 13),
    agent, task: one("task") || (data.schedules[agent] && data.schedules[agent].task) || null,
    started: started && new Date(started).toISOString(), finished: new Date(finished).toISOString(), result,
    summary: one("summary") || "", produced: (args.produced || []).flatMap(p => p.split(",")).map(s => s.trim()).filter(Boolean),
    project: one("project") || null, commit: one("commit") || null,
    tokens: { input: ti, output: to, total: tt }, source: one("source") || "run"
  };
  data.runs = data.runs.filter(r => r.id !== run.id).concat(run).sort((a, b) => a.finished < b.finished ? -1 : 1).slice(-KEEP);
  console.log(`record-run: ${agent} · ${result} · ${run.finished}${tt !== null ? " · " + tt + " tokens" : ""}`);
} else if (!one("schedule-cron") && !one("unschedule")) fail("nothing to record: pass --result (and/or --schedule-cron)");

data.version = 1; data.updated = new Date().toISOString();
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
