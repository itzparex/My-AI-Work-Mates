// D1b: the desktop app updates itself on Windows and Linux (AppImage).
// It checks the Releases page at startup and every few hours, downloads a new version in the background,
// then asks "Restart to update". It never restarts without asking; if the CEO picks "Later",
// the update is installed the next time the app is closed.
// Mac is left out here (no paid code signing): see D1c.

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

module.exports = { canSelfUpdate, startUpdates, setupAutoUpdates, CHECK_EVERY_MS };
