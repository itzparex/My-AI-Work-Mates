// D1b: the desktop app updates itself on Windows and Linux (AppImage).
// It checks the Releases page at startup and every few hours, downloads a new version in the background,
// then asks "Restart to update". It never restarts without asking; if the CEO picks "Later",
// the update is installed the next time the app is closed.
// Mac can't replace itself without paid code signing, so it gets a notice instead (D1c): it reads the version
// number from the Releases page on the same schedule and, when it's newer, shows "A new version is available"
// with a Download button that opens the Releases page. Nothing is downloaded or installed by the app itself.

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // every 4 hours
const FIRST_CHECK_MS = 15 * 1000;          // shortly after the app opens

// Can this copy of the app update itself?
function canSelfUpdate({ platform = process.platform, isPackaged, env = process.env } = {}) {
  if (!isPackaged) return false;                 // running from source (npm start)
  if (platform === "win32") return true;         // installed with the Windows installer
  if (platform === "linux") return !!env.APPIMAGE; // only the AppImage can replace itself
  return false;
}

// updater: electron-updater's autoUpdater. ask(version) → Promise<boolean> (true = restart now).
// Returns { check, stop, state } so it can be tested without Electron.
function startUpdates({ updater, ask, log = () => {}, setTimer = setTimeout, setRepeat = setInterval, clearRepeat = clearInterval,
  firstMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS }) {
  const state = { status: "idle", version: null, asked: new Set(), error: null };
  updater.autoDownload = true;          // download in the background
  updater.autoInstallOnAppQuit = true;  // "Later" = install when the app is next closed
  if (updater.logger !== undefined) updater.logger = null;

  updater.on("checking-for-update", () => { state.status = "checking"; });
  updater.on("update-not-available", () => { state.status = "up-to-date"; });
  updater.on("update-available", (info) => { state.status = "downloading"; state.version = info && info.version; log("Downloading version " + state.version); });
  updater.on("error", (e) => { state.status = "error"; state.error = String((e && e.message) || e); log("Update check failed: " + state.error); });
  updater.on("update-downloaded", async (info) => {
    state.status = "ready"; state.version = (info && info.version) || state.version;
    if (state.asked.has(state.version)) return; // ask once per version
    state.asked.add(state.version);
    let yes = false;
    try { yes = await ask(state.version); } catch { yes = false; }
    if (yes) { state.status = "restarting"; updater.quitAndInstall(false, true); }
  });

  const check = () => {
    if (state.status === "downloading" || state.status === "ready" || state.status === "restarting") return Promise.resolve(null);
    return Promise.resolve().then(() => updater.checkForUpdates()).catch((e) => { state.status = "error"; state.error = String((e && e.message) || e); return null; });
  };
  const first = setTimer(check, firstMs);
  const repeat = setRepeat(check, everyMs);
  const stop = () => { clearTimeout(first); clearRepeat(repeat); };
  return { check, stop, state };
}

// Wire it up inside Electron (called from main.js once the window is open).
function setupAutoUpdates({ app, dialog, getWindow }) {
  if (!canSelfUpdate({ isPackaged: app.isPackaged })) return null;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return null; }
  return startUpdates({
    updater: autoUpdater,
    log: (m) => console.log("[updates] " + m),
    ask: async (version) => {
      const opts = {
        type: "info",
        buttons: ["Restart to update", "Later"],
        defaultId: 0, cancelId: 1,
        title: "Update ready",
        message: "A new version of My AI Work Mates is ready" + (version ? " (" + version + ")" : "") + ".",
        detail: "Restart now to use it. Your saved data stays as it is. If you choose Later, it installs the next time you close the app."
      };
      const win = getWindow();
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      return response === 0;
    }
  });
}

// ---- Mac: update notice (D1c) ----
const RELEASES_PAGE = "https://github.com/itzparex/My-AI-Work-Mates/releases/tag/desktop-latest";
const VERSION_FILE = "https://github.com/itzparex/My-AI-Work-Mates/releases/download/desktop-latest/latest-linux.yml";

// Mac copies that were installed from the .dmg (not running from source).
function needsUpdateNotice({ platform = process.platform, isPackaged } = {}) {
  return !!isPackaged && platform === "darwin";
}

// "version: 1.0.21" line of an electron-builder latest*.yml file → "1.0.21" (or null).
function readVersion(yml) {
  const m = /^version:\s*['"]?([0-9]+(?:\.[0-9]+)*)/m.exec(String(yml || ""));
  return m ? m[1] : null;
}

// Is version a newer than version b? (1.0.10 > 1.0.9)
function isNewer(a, b) {
  if (!a || !b) return false;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// fetchText(url) → Promise<string>; ask(version) → Promise<boolean> (true = open the Releases page).
function startUpdateNotice({ current, fetchText, ask, openPage, log = () => {}, setTimer = setTimeout, setRepeat = setInterval,
  clearRepeat = clearInterval, firstMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS, url = VERSION_FILE, page = RELEASES_PAGE }) {
  const state = { status: "idle", latest: null, asked: new Set(), error: null, busy: false };
  const check = async () => {
    if (state.busy) return null;
    state.busy = true; state.status = "checking";
    try {
      const latest = readVersion(await fetchText(url));
      if (!latest) throw new Error("no version number in " + url);
      state.latest = latest; state.error = null;
      if (!isNewer(latest, current)) { state.status = "up-to-date"; return latest; }
      state.status = "available";
      if (state.asked.has(latest)) return latest; // tell once per version
      state.asked.add(latest);
      log("Version " + latest + " is available (this is " + current + ")");
      let yes = false;
      try { yes = await ask(latest); } catch { yes = false; }
      if (yes) openPage(page);
      return latest;
    } catch (e) {
      state.status = "error"; state.error = String((e && e.message) || e); log("Update check failed: " + state.error);
      return null;
    } finally { state.busy = false; }
  };
  const first = setTimer(check, firstMs);
  const repeat = setRepeat(check, everyMs);
  const stop = () => { clearTimeout(first); clearRepeat(repeat); };
  return { check, stop, state };
}

function setupUpdateNotice({ app, dialog, shell, net, getWindow }) {
  if (!needsUpdateNotice({ isPackaged: app.isPackaged })) return null;
  return startUpdateNotice({
    current: app.getVersion(),
    fetchText: async (u) => { const r = await net.fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); },
    openPage: (u) => shell.openExternal(u),
    log: (m) => console.log("[updates] " + m),
    ask: async (version) => {
      const opts = {
        type: "info",
        buttons: ["Download", "Later"],
        defaultId: 0, cancelId: 1,
        title: "Update available",
        message: "A new version of My AI Work Mates is available (" + version + ").",
        detail: "Download opens the Releases page. Get the Mac .dmg for your chip, open it and drag the app to Applications to replace this one. Your saved data stays as it is."
      };
      const win = getWindow();
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      return response === 0;
    }
  });
}

module.exports = { canSelfUpdate, startUpdates, setupAutoUpdates, CHECK_EVERY_MS,
  needsUpdateNotice, readVersion, isNewer, startUpdateNotice, setupUpdateNotice, RELEASES_PAGE, VERSION_FILE };
