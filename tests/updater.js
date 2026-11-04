// Desktop app self-update test (D1b): checks at startup and every few hours, downloads in the background,
// asks once per version, and only restarts when the CEO says yes.
// Run from the repo root: node tests/updater.js   (also run at the end of tests/smoke.js)
const assert = require("assert"), { EventEmitter } = require("events");
const { canSelfUpdate, startUpdates } = require("../desktop/updater");

module.exports = async function run() {
  // Who can update: packaged Windows app and Linux AppImage only.
  assert.strictEqual(canSelfUpdate({ platform: "win32", isPackaged: true }), true);
  assert.strictEqual(canSelfUpdate({ platform: "linux", isPackaged: true, env: { APPIMAGE: "/x.AppImage" } }), true);
  assert.strictEqual(canSelfUpdate({ platform: "linux", isPackaged: true, env: {} }), false);
  assert.strictEqual(canSelfUpdate({ platform: "darwin", isPackaged: true }), false);
  assert.strictEqual(canSelfUpdate({ platform: "win32", isPackaged: false }), false);

  const fake = new EventEmitter(); let checks = 0, installs = 0;
  fake.checkForUpdates = () => { checks++; return Promise.resolve({}); };
  fake.quitAndInstall = () => { installs++; };
  const timers = [], repeats = [], answers = [false, true]; const asked = [];
  const u = startUpdates({ updater: fake, ask: async (v) => { asked.push(v); return answers.shift(); },
    setTimer: (fn, ms) => (timers.push([fn, ms]), 1), setRepeat: (fn, ms) => (repeats.push([fn, ms]), 2), clearRepeat: () => {} });
  assert.strictEqual(fake.autoDownload, true); assert.strictEqual(fake.autoInstallOnAppQuit, true);
  assert.ok(timers[0][1] <= 60000, "first check soon after start"); assert.ok(repeats[0][1] >= 3600000, "then every few hours");

  await timers[0][0](); assert.strictEqual(checks, 1);
  fake.emit("update-not-available"); assert.strictEqual(u.state.status, "up-to-date");
  await repeats[0][0](); assert.strictEqual(checks, 2);
  fake.emit("update-available", { version: "1.0.9" }); assert.strictEqual(u.state.status, "downloading");
  await repeats[0][0](); assert.strictEqual(checks, 2, "no new check while downloading");

  // Downloaded: asks; "Later" never restarts, and the same version isn't asked again.
  fake.emit("update-downloaded", { version: "1.0.9" }); await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(asked, ["1.0.9"]); assert.strictEqual(installs, 0); assert.strictEqual(u.state.status, "ready");
  fake.emit("update-downloaded", { version: "1.0.9" }); await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(asked, ["1.0.9"]);
  // A newer version: "Restart to update" installs it.
  fake.emit("update-downloaded", { version: "1.0.10" }); await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(asked, ["1.0.9", "1.0.10"]); assert.strictEqual(installs, 1);

  // Errors (offline, no update files yet) are quiet and don't break later checks.
  const f2 = new EventEmitter(); let n = 0; f2.checkForUpdates = () => { n++; return Promise.reject(new Error("offline")); };
  const u2 = startUpdates({ updater: f2, ask: async () => true, setTimer: (fn) => (timers.push([fn]), 3), setRepeat: () => 4, clearRepeat: () => {} });
  await timers[timers.length - 1][0](); assert.strictEqual(u2.state.status, "error"); assert.strictEqual(n, 1);
  f2.emit("error", new Error("404")); assert.match(u2.state.error, /404/);
  return "desktop self-update: check, background download, ask before restart OK";
};

if (require.main === module) module.exports().then(m => console.log("OK: " + m), e => { console.error("FAILED\n" + (e.stack || e)); process.exit(1); });
