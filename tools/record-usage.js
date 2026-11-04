#!/usr/bin/env node
// Saves one automatic reading of the CEO's Claude plan usage in runs/usage.json.
// Optional: only the "Usage reader" scheduled task uses it, on the CEO's own computer with the Claude desktop app on
// (playbook: agents/usage-reader.md). The CEO page shows the newest reading, labeled "read automatically",
// next to readings the CEO notes by hand ("noted by CEO"). No packages needed. Run from the repo root:
//
//   node tools/record-usage.js --pct 42 --reset 2026-11-04T20:00:00Z [--at 2026-11-04T16:58:00Z] [--note "Current session"]
//
// --pct is the percentage used shown on the usage page (0-100). --reset is when that limit resets (leave out if not shown).
// --at is when the page was read (defaults to now). Nothing is ever guessed: if the page couldn't be read, don't run this.
const fs = require("fs"), path = require("path");
const FILE = path.resolve(__dirname, "..", "runs", "usage.json");
const KEEP = 200;
const args = {}; const list = process.argv.slice(2);
for (let i = 0; i < list.length; i++) { const a = list[i]; if (!a.startsWith("--")) continue; args[a.slice(2)] = list[i + 1] && !list[i + 1].startsWith("--") ? list[++i] : "true"; }
const fail = m => { console.error("record-usage: " + m); process.exit(1); };
const pct = Number(String(args.pct ?? "").replace("%", ""));
if (args.pct === undefined || !Number.isFinite(pct) || pct < 0 || pct > 100) fail("--pct must be a number from 0 to 100");
const at = args.at || new Date().toISOString(); if (isNaN(new Date(at))) fail("--at must be a date like 2026-11-04T16:58:00Z");
if (args.reset && isNaN(new Date(args.reset))) fail("--reset must be a date like 2026-11-04T20:00:00Z");
const data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { version: 1, readings: [] };
data.readings = data.readings || [];
const reading = { pct: Math.round(pct), reset: args.reset ? new Date(args.reset).toISOString() : null, at: new Date(at).toISOString(), source: "auto", by: "Usage reader", ...(args.note ? { note: String(args.note).slice(0, 120) } : {}) };
data.readings = data.readings.filter(r => r.at !== reading.at).concat(reading).sort((a, b) => a.at < b.at ? -1 : 1).slice(-KEEP);
data.version = 1; data.updated = new Date().toISOString();
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`record-usage: ${reading.pct}% used · read ${reading.at}${reading.reset ? " · resets " + reading.reset : ""}`);
