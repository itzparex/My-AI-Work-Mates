// D1a: where the desktop app gets its pages from.
// Every page is still served under app://mawm (so the app's saved data stays exactly where it was),
// but each file now comes from the live website first, so whatever the build loop pushes shows up at once.
// Order: live website → last copy saved on this computer (when offline) → copy built into the app.
const fs = require("fs");
const path = require("path");

const LIVE = "https://itzparex.github.io/My-AI-Work-Mates/";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp"
};
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";

function inside(dir, p) {
  const f = path.normalize(path.join(dir, p));
  return f.startsWith(dir + path.sep) ? f : null;
}

// root: built-in copy; cacheDir: where live files are saved for offline use; fetchLive: Electron's net.fetch.
function createHandler({ root, cacheDir, fetchLive, live = LIVE, timeoutMs = 6000, offlineMs = 30000, now = Date.now }) {
  root = path.resolve(root); cacheDir = path.resolve(cacheDir);
  let offlineUntil = 0; // after a network failure, skip the live site for a short while so pages don't wait on every file

  const reply = (body, type, source) => new Response(body, {
    status: 200, headers: { "Content-Type": type, "Cache-Control": "no-store", "X-MAWM-Source": source }
  });
  async function fromDisk(dir, p, source) {
    const f = inside(dir, p); if (!f) return null;
    try { return reply(await fs.promises.readFile(f), typeOf(f), source); } catch { return null; }
  }

  return async function handle(req) {
    let p;
    try { p = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response("Bad request", { status: 400 }); }
    if (!p || p === "/") p = "/index.html";
    if (!inside(root, p)) return new Response("Not found", { status: 404 });

    if ((req.method || "GET") === "GET" && now() >= offlineUntil) {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchLive(new URL(p.slice(1), live).toString(), { signal: ac.signal, cache: "no-cache" });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          clearTimeout(timer);
          const saved = inside(cacheDir, p);
          if (saved) fs.promises.mkdir(path.dirname(saved), { recursive: true }).then(() => fs.promises.writeFile(saved, buf)).catch(() => {});
          return reply(buf, typeOf(p), "live");
        }
        clearTimeout(timer); // the live site answered but doesn't have it: try the copies below
      } catch {
        clearTimeout(timer); offlineUntil = now() + offlineMs;
      }
    }
    return (await fromDisk(cacheDir, p, "saved")) || (await fromDisk(root, p, "built-in")) || new Response("Not found", { status: 404 });
  };
}

module.exports = { createHandler, LIVE };
