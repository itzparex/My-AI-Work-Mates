// Desktop app page source test (D1a): live website first, then the saved copy, then the built-in copy.
// Run from the repo root: node tests/desktop.js   (also run at the end of tests/smoke.js)
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { createHandler } = require("../desktop/serve");

module.exports = async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mawm-desktop-"));
  const root = path.join(tmp, "app"), cacheDir = path.join(tmp, "live-copy");
  fs.mkdirSync(path.join(root, "icons"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "built-in index");
  fs.writeFileSync(path.join(root, "only-built-in.html"), "built-in only");
  fs.writeFileSync(path.join(tmp, "secret.txt"), "secret");

  let liveIndex = "live index v1";
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (p === "/site/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(liveIndex); }
    if (p === "/site/runs/runs.json") { res.writeHead(200); return res.end('{"runs":[]}'); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, r));
  const live = `http://localhost:${server.address().port}/site/`;
  let clock = 1000; const now = () => clock;
  const handle = createHandler({ root, cacheDir, live, fetchLive: (u, o) => fetch(u, o), timeoutMs: 2000, offlineMs: 30000, now });
  const get = async (p) => { const r = await handle({ url: "app://mawm" + p, method: "GET" }); return { status: r.status, src: r.headers.get("X-MAWM-Source"), body: await r.text(), type: r.headers.get("Content-Type") }; };

  // Online: live copy wins and is saved for offline use (subfolders too).
  let r = await get("/index.html?v=123");
  assert.deepStrictEqual([r.src, r.body], ["live", "live index v1"]); assert.match(r.type, /text\/html/);
  r = await get("/"); assert.strictEqual(r.body, "live index v1");
  r = await get("/runs/runs.json"); assert.strictEqual(r.src, "live");
  await new Promise(res => setTimeout(res, 100));
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, "index.html"), "utf8"), "live index v1");
  assert.ok(fs.existsSync(path.join(cacheDir, "runs", "runs.json")));

  // A new push shows up on the next load.
  liveIndex = "live index v2"; r = await get("/index.html"); assert.strictEqual(r.body, "live index v2");

  // Live site doesn't have it: the built-in copy answers. Nowhere: 404. Paths outside the app: 404.
  r = await get("/only-built-in.html"); assert.deepStrictEqual([r.src, r.body], ["built-in", "built-in only"]);
  r = await get("/nope.html"); assert.strictEqual(r.status, 404);
  r = await get("/../secret.txt"); assert.strictEqual(r.status, 404);
  r = await get("/%2e%2e/secret.txt"); assert.strictEqual(r.status, 404);

  // Offline: the saved copy answers, then the built-in copy for anything never saved.
  await new Promise(res => setTimeout(res, 100));
  await new Promise(res => server.close(res));
  r = await get("/index.html"); assert.deepStrictEqual([r.src, r.body], ["saved", "live index v2"]);
  fs.rmSync(cacheDir, { recursive: true, force: true });
  r = await get("/index.html"); assert.deepStrictEqual([r.src, r.body], ["built-in", "built-in index"]);

  // Back online: after the short offline pause the live site is used again.
  const server2 = http.createServer((req, res) => { res.writeHead(200); res.end("live index v3"); });
  await new Promise(res => server2.listen(new URL(live).port, res));
  r = await get("/index.html"); assert.strictEqual(r.src, "built-in", "waits out the offline pause");
  clock += 31000; r = await get("/index.html"); assert.deepStrictEqual([r.src, r.body], ["live", "live index v3"]);
  await new Promise(res => server2.close(res));
  await new Promise(res => setTimeout(res, 150));
  fs.rmSync(tmp, { recursive: true, force: true });
  return "desktop page source: live → saved → built-in OK";
};

if (require.main === module) module.exports().then(m => console.log("OK: " + m), e => { console.error("FAILED\n" + (e.stack || e)); process.exit(1); });
