// Desktop app: opens My AI Work Mates in its own window. Pages are served under app://mawm so browser storage works
// like it does on the website (and saved data stays put). Each page comes from the live website first, so updates
// appear at once; offline it uses the last saved copy, then the copy built into the app (see serve.js).
// Outside links open in the normal browser. On Windows and Linux the app also updates itself; on Mac it shows a notice
// with a Download button when a new version is out (see updater.js).
const { app, BrowserWindow, protocol, net, shell, dialog } = require("electron");
const path = require("path");
const { createHandler } = require("./serve");
const { setupAutoUpdates, setupUpdateNotice } = require("./updater");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
const ROOT = path.join(__dirname, "app");

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: "My AI Work Mates",
    icon: path.join(ROOT, "icons", "icon-512.png"),
    backgroundColor: "#f8f5fa",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.loadURL("app://mawm/index.html#/home");
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://")) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  return win;
}

app.on("second-instance", () => {
  const [w] = BrowserWindow.getAllWindows();
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

app.whenReady().then(() => {
  protocol.handle("app", createHandler({
    root: ROOT,
    cacheDir: path.join(app.getPath("userData"), "live-copy"),
    fetchLive: (url, opts) => net.fetch(url, opts)
  }));
  createWindow();
  const getWindow = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  setupAutoUpdates({ app, dialog, getWindow });
  setupUpdateNotice({ app, dialog, shell, net, getWindow });
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
