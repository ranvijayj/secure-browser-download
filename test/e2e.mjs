// End-to-end test in real Chrome with the unpacked extension loaded.
// A local server imitates Cloudflare: the PDF is only served to requests that carry the
// page's clearance cookie and don't come from the extension's own origin.
import http from "http"; import fs from "fs"; import os from "os"; import path from "path";
import { execFileSync } from "child_process";
import { chromium } from "playwright-core";
import * as PDFLib from "@cantoo/pdf-lib";

let fails = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };

const doc = await PDFLib.PDFDocument.create();
doc.addPage().drawText("E2E SECRET PDF", { x: 50, y: 700 });
const PDF = Buffer.from(await doc.save({ useObjectStreams: false }));
const CHALLENGE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;

const log = [];
const server = http.createServer((req, res) => {
  const cleared = /clear=1/.test(req.headers.cookie || "");
  // Real bot checks treat requests that don't look like the site's own traffic as suspicious.
  const site = req.headers["sec-fetch-site"];
  const fromExt = site !== "same-origin";
  log.push(`${req.url} cookie=${cleared} sec-fetch-site=${site} origin=${req.headers.origin || "-"}`);
  if (req.url === "/page") {
    res.writeHead(200, { "set-cookie": "clear=1; Path=/; SameSite=Lax", "content-type": "text/html" });
    return res.end('<a href="/protected.pdf">pdf</a>');
  }
  if (req.url === "/protected.pdf") {
    if (!cleared || fromExt) { res.writeHead(403, { "content-type": "text/html" }); return res.end(CHALLENGE); }
    res.writeHead(200, { "content-type": "application/pdf" }); return res.end(PDF);
  }
  if (req.url === "/downloads") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(["slow-statement.pdf", "slow-report.pdf", "setup.dmg", "tiny.pdf", "fake-invoice.pdf", "slow-other.pdf"]
      .map((f) => `<a id="${f.split(".")[0]}" href="/dl/${f}" download>${f}</a>`).join("<br>") + '<br><a id="fast2mb" href="/file-download/152">Download</a>');
  }
  if (req.url === "/blobs") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<button id="keep">keep</button><button id="revoke">revoke</button><script>
      function make(revoke) {
        const u = URL.createObjectURL(new Blob(["%PDF-1.4 statement from the page"], { type: "text/plain" }));
        const a = document.createElement("a"); a.href = u; a.download = revoke ? "page-made-revoked.txt" : "page-made.txt"; a.click();
        if (revoke) URL.revokeObjectURL(u);
      }
      keep.onclick = () => make(false); revoke.onclick = () => make(true);
    </script>`);
  }
  if (req.url === "/file-download/152") {
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024 - PDF.length, 0x20)]);
    res.writeHead(200, { "content-type": "application/pdf", "content-length": big.length, "content-disposition": 'attachment; filename="2mb.pdf"' });
    return res.end(big);
  }
  if (req.url.startsWith("/dl/")) {
    const f = req.url.slice(4);
    if (f === "fake-invoice.pdf") { const b = Buffer.alloc(2048); b.write("MZ"); res.writeHead(200, { "content-type": "application/pdf" }); return res.end(b); }
    const body = f.endsWith(".pdf") ? PDF : Buffer.alloc(300000, 7);
    res.writeHead(200, { "content-type": f.endsWith(".pdf") ? "application/pdf" : "application/x-apple-diskimage",
      "content-length": body.length, "content-disposition": `attachment; filename="${f}"` });
    if (!f.startsWith("slow")) return res.end(body);
    res.write(body.subarray(0, 100));                       // trickle: lets the extension pause it mid-way
    return setTimeout(() => res.end(body.subarray(100)), 4000);
  }
  if (req.url === "/login.pdf") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><h1>Please log in</h1>"); }
  if (req.url === "/photo.jpg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdl-dl-"));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sdl-prof-"));
fs.mkdirSync(path.join(profile, "Default"));
fs.writeFileSync(path.join(profile, "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: dlDir, prompt_for_download: false } }));
// The real flow gets per-tab access from the right-click (activeTab), which Playwright can't
// trigger. So the main run uses a copy of the extension with access already granted; a second
// run with the real manifest checks that the extension asks for access instead of failing.
const realExt = path.resolve("ext");
const grantedExt = fs.mkdtempSync(path.join(os.tmpdir(), "sdl-ext-"));
fs.cpSync(realExt, grantedExt, { recursive: true });
const man = JSON.parse(fs.readFileSync(path.join(grantedExt, "manifest.json")));
man.host_permissions = ["<all_urls>"]; delete man.optional_host_permissions;
fs.writeFileSync(path.join(grantedExt, "manifest.json"), JSON.stringify(man));
const ext = grantedExt;
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: "/usr/bin/google-chrome", headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"]
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
// IMPORTANT: Playwright normally takes over downloads, which skips Chrome's filename step that
// extensions hook (onDeterminingFilename). Restore Chrome's real behaviour so the tests see
// exactly what a user's Chrome does; files land in dlDir (set in Preferences above).
const realDownloads = async (c) => (await c.newCDPSession(c.pages()[0] || await c.newPage()))
  .send("Browser.setDownloadBehavior", { behavior: "default" });
await realDownloads(ctx);

// Files the extension saved (its own blob: downloads) since a given download id.
const lastId = () => sw.evaluate(async () => Math.max(0, ...(await chrome.downloads.search({})).map((d) => d.id)));
async function savedSince(id, wantCount = 1, timeout = 8000) {
  const end = Date.now() + timeout; let got = [];
  while (Date.now() < end) {
    got = await sw.evaluate(async (since) => (await chrome.downloads.search({ state: "complete" }))
      .filter((d) => d.id > since && d.url.startsWith("blob:chrome-extension")).map((d) => d.filename), id);
    if (got.length >= wantCount) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return got;
}

const site = await ctx.newPage(); await site.goto(base + "/page");
const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, base + "/page");

// Status is now a callout with data-state ok|error; tests compare against "✅ …" / "❌ …".
const statusOf = (p) => p.$eval("#status", (e) => (e.dataset.state === "ok" ? "✅ " : e.dataset.state === "error" ? "❌ " : "") + e.textContent);
async function attempt(file, password, { withTab = true } = {}) {
  const p = await ctx.newPage();
  const since = await lastId();
  await p.goto(`chrome-extension://${extId}/prompt.html?` +
    new URLSearchParams({ url: base + file, tabId: withTab ? tabId : "" }));
  await p.evaluate(() => { const orig = chrome.downloads.download.bind(chrome.downloads);
    window.__asked = []; chrome.downloads.download = (o) => { window.__asked.push(o.filename); return orig(o); }; });
  await p.click("#pw");
  await p.keyboard.type(password, { delay: 20 });           // real keystrokes
  const typed = await p.$eval("#pw", (e) => e.value);
  await p.click("#pw2"); await p.keyboard.type(password, { delay: 10 });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => ["ok","error"].includes(document.getElementById("status").dataset.state) || !document.getElementById("access").hidden, null, { timeout: 30000 });
  const status = await statusOf(p);
  const asked = await p.evaluate(() => window.__asked);
  const fallbackShown = await p.$eval("#fallback", (e) => !e.hidden).catch(() => false);
  const paths = status.includes("✅") ? await savedSince(since) : (await new Promise((r) => setTimeout(r, 800)), await savedSince(since, 1, 0));
  if (!p.isClosed()) await p.close();
  return { typed, status, fallbackShown, newFiles: paths.map((f) => path.basename(f)), paths, asked };
}

// 1. Typing works (the original bug)
const r1 = await attempt("/protected.pdf", "hunter22");
ok(r1.typed === "hunter22", "real keyboard typing reaches the password box");

// 2. Cloudflare-style protected PDF succeeds via the page context
ok(r1.status.includes("✅"), "bot-protected PDF downloaded via page context: " + r1.status.trim());
ok(r1.newFiles.length === 1 && r1.newFiles[0] === "protected (locked).pdf", "saved locked PDF: " + r1.newFiles);
if (r1.paths[0]) {
  const f = r1.paths[0];
  const info = execFileSync("qpdf", ["--show-encryption", "--password=hunter22", f]).toString();
  ok(/R = 6/.test(info), "saved PDF is AES-256 encrypted with the typed password");
  execFileSync("qpdf", ["--password=hunter22", "--decrypt", "--qdf", f, path.join(os.tmpdir(), "e2e-dec.pdf")]);
  ok(fs.readFileSync(path.join(os.tmpdir(), "e2e-dec.pdf")).includes("E2E SECRET PDF"), "decrypted content is the real PDF");
}

// 3. Without the page context, the challenge is detected and NOTHING is saved
const r2 = await attempt("/protected.pdf", "hunter22", { withTab: false });
ok(r2.status.includes("bot check") && r2.newFiles.length === 0 && r2.fallbackShown,
  "challenge page detected, nothing saved, workaround shown: " + r2.status.trim());

// 4. Login page instead of file -> refused
const r3 = await attempt("/login.pdf", "hunter22");
ok(r3.status.includes("❌") && r3.newFiles.length === 0, "login page refused: " + r3.status.trim());

// 5. Non-PDF -> self-unlocking .html
const r4 = await attempt("/photo.jpg", "hunter22");
ok(r4.newFiles[0] === "photo.jpg.locked.html", "non-PDF saved as " + r4.newFiles);

// 6. Unlock the vault in Chrome with real typing (vault had the same typing bug)
if (r4.paths[0]) {
  const v = await ctx.newPage();
  await v.goto("file://" + r4.paths[0]);
  await v.click("#p"); await v.keyboard.type("wrong-pw"); await v.keyboard.press("Enter");
  await v.waitForFunction(() => document.getElementById("m").dataset.state === "error");
  ok(true, "vault rejects wrong password in Chrome");
  await v.fill("#p", ""); await v.click("#p"); await v.keyboard.type("hunter22", { delay: 20 });
  await v.keyboard.press("Enter");
  await v.waitForFunction(() => document.getElementById("m").dataset.state === "ok");
  const out = path.join(dlDir, "photo.jpg");
  await new Promise((r) => setTimeout(r, 1500));
  ok(!fs.existsSync(out) && await v.$eval(".view img", (i) => i.complete && i.src.startsWith("blob:")),
    "vault opens the photo in the page and saves nothing on its own");
  await v.click(".save");                                      // explicit "Save an unlocked copy"
  for (let i = 0; i < 40 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 200));
  ok(fs.existsSync(out) && fs.readFileSync(out).equals(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])),
    "Save an unlocked copy restores exact photo.jpg");
}

// ---------- Automatic detection ("ask" mode) ----------
const setMode = (mode, neverAsk = []) => sw.evaluate(([m, n]) => chrome.storage.local.set({ mode: m, neverAsk: n }), [mode, neverAsk]);
const dlState = (name) => sw.evaluate(async (n) => (await chrome.downloads.search({}))
  .filter((d) => d.url.endsWith("/dl/" + n)).map((d) => ({ state: d.state, exists: d.exists, paused: d.paused, file: d.filename })), name);
const dlPage = await ctx.newPage(); await dlPage.goto(base + "/downloads");
const askTab = () => ctx.waitForEvent("page", { predicate: (pg) => pg.url().includes("ask=1"), timeout: 8000 }).catch(() => null);
async function lockIn(p, pw = "tangerine-kayak-41") {
  const since = await lastId();
  await p.evaluate(() => { const o = chrome.downloads.download.bind(chrome.downloads);
    window.__asked = []; chrome.downloads.download = (x) => { window.__asked.push(x.filename); return o(x); }; });
  await p.fill("#pw", pw); await p.fill("#pw2", pw); await p.click("#go");
  await p.waitForFunction(() => ["ok","error"].includes(document.getElementById("status").dataset.state), null, { timeout: 30000 });
  const out = { status: await statusOf(p), asked: await p.evaluate(() => window.__asked) };
  out.saved = out.status.includes("✅") ? await savedSince(since) : [];
  await new Promise((r) => setTimeout(r, 1500));
  return out;
}

const inDir = (n) => fs.existsSync(path.join(dlDir, n));
const waitFile = async (n, ms = 10000) => { for (let i = 0; i < ms / 200 && !inDir(n); i++) await new Promise((r) => setTimeout(r, 200)); return inDir(n); };
const partials = () => fs.readdirSync(dlDir).filter((f) => f.endsWith(".crdownload"));

await setMode("ask-docs");
// A. PDF -> stopped immediately, asked, locked
let tabP = askTab(); await dlPage.click("#slow-statement");
let ask = await tabP;
ok(!!ask, "ask mode: download of a PDF opens the 'Lock this download?' tab");
if (ask) {
  await ask.waitForLoadState();
  ok((await ask.$eval("#askName", (e) => e.textContent)) === "slow-statement.pdf", "ask tab names the file");
  const st = await dlState("slow-statement.pdf");
  ok(st.every((d) => d.state !== "in_progress" && d.state !== "complete") && !inDir("slow-statement.pdf") && partials().length === 0,
    "original download was stopped at once: nothing (not even a partial file) on disk");
  const r = await lockIn(ask);
  ok(r.status.includes("✅") && path.basename(r.saved[0] || "") === "slow-statement (locked).pdf" && fs.existsSync(r.saved[0]), "chose Lock: saved " + path.basename(r.saved[0] || "-"));
  ok(!inDir("slow-statement.pdf"), "no unprotected slow-statement.pdf in the downloads folder");
}
// B. Save normally -> download restarted under its real name
tabP = askTab(); await dlPage.click("#slow-report");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await ask.click("#skip");
  ok(await waitFile("slow-report.pdf", 12000), "chose Save normally: download restarted and saved as slow-report.pdf");
} else ok(false, "ask tab for slow-report.pdf");
// C. installer is ignored in documents-only mode
tabP = askTab(); await dlPage.click("#setup");
ok(!(await tabP) && await waitFile("setup.dmg"), "documents-only mode ignores a .dmg installer (saved normally)");
// D. instant tiny file -> nothing lands while the form is unfilled
tabP = askTab(); await dlPage.click("#tiny");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await new Promise((r) => setTimeout(r, 2500));
  ok(!inDir("tiny.pdf") && partials().length === 0, "instant tiny download: nothing on disk while the form is unfilled");
  const r = await lockIn(ask);
  ok(r.status.includes("✅") && !inDir("tiny.pdf"), "after locking, no unprotected tiny.pdf exists");
} else ok(false, "ask tab for tiny.pdf");
// E. program disguised as a PDF is refused
tabP = askTab(); await dlPage.click("#fake-invoice");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); const r = await lockIn(ask);
  ok(r.status.includes("actually a program") && r.asked.length === 0 && !inDir("fake-invoice.pdf"), "disguised program refused: " + r.status.trim());
  await ask.close();
} else ok(false, "ask tab for fake-invoice.pdf");
// F. "always save normally" site is not asked about
await setMode("ask-docs", [new URL(base).host]);
tabP = askTab(); await dlPage.click("#slow-other");
ok(!(await tabP) && await waitFile("slow-other.pdf"), "'always save normally' site is not asked about (saved normally)");
fs.rmSync(path.join(dlDir, "slow-other.pdf"));
// G. closing the ask tab without choosing: nothing is saved, and the log says so
await setMode("ask-all");
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await dlPage.click("#slow-other");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await new Promise((r) => setTimeout(r, 500)); await ask.close();
  await new Promise((r) => setTimeout(r, 6000));
  const { log: l } = await sw.evaluate(() => chrome.storage.local.get("log"));
  ok(!inDir("slow-other.pdf") && partials().length === 0 && l[0]?.decision.includes("closed without choosing"),
    "closing the ask tab saves nothing and is logged: " + l[0]?.decision);
} else ok(false, "ask tab for slow-other.pdf (ask-all)");
// M. User's case: fast 2 MB PDF from a URL with no extension (/file-download/152), slow typist
await setMode("ask-docs", []);
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await dlPage.click("#fast2mb");
ask = await tabP;
ok(!!ask, "fast 2 MB PDF download (no extension in URL) opens the ask tab");
if (ask) {
  await ask.waitForLoadState();
  const name = await ask.$eval("#askName", (e) => e.textContent);
  ok(name === "2mb.pdf", "ask tab shows the real filename from the server: " + name);
  // Longer than Chrome's ~10 s limit for holding a download and its ~30 s worker idle limit.
  await new Promise((r) => setTimeout(r, 45000));
  const files = fs.readdirSync(dlDir).filter((f) => f.startsWith("2mb") || f.endsWith(".crdownload"));
  ok(files.length === 0, "after 45 s with the form unfilled, nothing is on disk: " + JSON.stringify(files));
  const r = await lockIn(ask);
  ok(r.status.includes("✅") && path.basename(r.saved[0] || "") === "2mb (locked).pdf", "locked as '2mb (locked).pdf' after 45 s");
  const left = fs.readdirSync(dlDir).filter((f) => (f.startsWith("2mb") && f !== "2mb (locked).pdf") || f.endsWith(".crdownload"));
  ok(left.length === 0, "downloads folder has no unprotected 2mb.pdf or partial file: " + JSON.stringify(left));
}

// H. Right-click flow while detection is on: no second "Lock this download?" tab, no "always save normally" link
await setMode("ask-all", []);
{
  const extra = askTab();
  const r = await attempt("/photo.jpg", "hunter22");
  ok(r.status.includes("✅") && !(await extra), "right-click lock while detection is on doesn't trigger a second ask tab");
  const rc = await ctx.newPage();
  await rc.goto(`chrome-extension://${extId}/prompt.html?` + new URLSearchParams({ url: base + "/photo.jpg", tabId }));
  ok(await rc.$eval("#neverRow", (e) => e.hidden) && await rc.$eval("#skip", (e) => e.hidden),
    "right-click prompt shows only the password form (no 'save normally' options)");
  await rc.close();
}
// I. Page-made (blob:) download -> asked, locked via the page
const blobPage = await ctx.newPage(); await blobPage.goto(base + "/blobs");
const blobState = (name) => sw.evaluate(async (n) => (await chrome.downloads.search({}))
  .filter((d) => d.filename.endsWith(n) || (d.url.startsWith("blob:") && d.mime === "text/plain"))
  .map((d) => ({ id: d.id, state: d.state, exists: d.exists, file: d.filename, url: d.url })), name);
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await blobPage.click("#keep");
ask = await tabP;
ok(!!ask, "page-made (blob:) download opens the ask tab");
if (ask) {
  await ask.waitForLoadState(); await new Promise((r) => setTimeout(r, 600));
  ok((await ask.$eval("#askName", (e) => e.textContent)) === "page-made.txt", "ask tab shows the page-made file's real name");
  const r = await lockIn(ask);
  ok(r.status.includes("✅") && path.basename(r.saved[0] || "") === "page-made.txt.locked.html",
    "page-made file locked via the page: " + path.basename(r.saved[0] || "-"));
  ok(!fs.existsSync(path.join(dlDir, "page-made.txt")), "no unprotected page-made.txt in the downloads folder");
  const left = (await blobState("page-made.txt")).filter((d) => d.file && fs.existsSync(d.file));
  ok(left.length === 0, "no unprotected page-made file left on disk");
}
// J. Page-made download whose blob is already revoked -> "download it normally, then lock it"
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await blobPage.click("#revoke");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await new Promise((r) => setTimeout(r, 600));
  await ask.fill("#pw", "tangerine-kayak-41"); await ask.fill("#pw2", "tangerine-kayak-41"); await ask.click("#go");
  await ask.waitForFunction(() => ["ok","error"].includes(document.getElementById("status").dataset.state), null, { timeout: 20000 });
  ok(await ask.$eval("#pick", (e) => !e.hidden), "revoked page-made file can't be fetched: offers 'download it normally, then lock it'");
  await ask.click("#pickStart");
  await ask.waitForFunction(() => /click the download button/i.test(document.getElementById("pickHint").textContent), null, { timeout: 5000 });
  ok(true, "tells the user to click the site's download button again");
  const lockP = ctx.waitForEvent("page", { predicate: (pg) => pg.url().includes("pick=1"), timeout: 10000 }).catch(() => null);
  await blobPage.click("#revoke");                              // user clicks again; this one is let through
  const lockPage = await lockP;
  ok(!!lockPage && inDir("page-made-revoked.txt"), "let-through download finished and a 'Lock the downloaded file' page opened");
  if (lockPage) {
    await lockPage.waitForLoadState();
    await lockPage.waitForFunction(() => !document.getElementById("pickFileWrap").hidden, null, { timeout: 5000 });
    const since = await lastId();
    await lockPage.fill("#pw", "tangerine-kayak-41"); await lockPage.fill("#pw2", "tangerine-kayak-41");
    await lockPage.setInputFiles("#pickFile", path.join(dlDir, "page-made-revoked.txt"));
    await lockPage.waitForFunction(() => ["ok","error"].includes(document.getElementById("status").dataset.state), null, { timeout: 20000 });
    const st = await statusOf(lockPage);
    const saved = await savedSince(since);
    await new Promise((r) => setTimeout(r, 800));
    ok(st.includes("✅") && path.basename(saved[0] || "") === "page-made-revoked.txt.locked.html" && !inDir("page-made-revoked.txt"),
      "picked file locked and the unprotected copy deleted: " + st.trim());
  }
  if (!ask.isClosed()) await ask.close();
} else ok(false, "ask tab for revoked page-made download");
// N. Page-made download -> Save normally (fetched from the page, saved as-is)
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await blobPage.click("#keep");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await ask.click("#skip");
  ok(await waitFile("page-made (1).txt", 8000) || await waitFile("page-made.txt", 100), "page-made file, Save normally: saved without a password");
} else ok(false, "ask tab for page-made Save normally");
// K. "Always save normally from <site>" resumes and stops asking
await setMode("ask-docs", []);
await sw.evaluate(() => chrome.downloads.erase({}));
tabP = askTab(); await dlPage.click("#slow-other");
ask = await tabP;
if (ask) {
  await ask.waitForLoadState(); await ask.click("#never");
  const done = await waitFile("slow-other.pdf", 12000);
  const { neverAsk } = await sw.evaluate(() => chrome.storage.local.get("neverAsk"));
  ok(neverAsk?.includes(new URL(base).host) && done, "'Always save normally' remembers the site and saves the download");
  tabP = askTab(); await dlPage.click("#slow-report");
  ok(!(await tabP), "...and the next download from that site isn't asked about");
} else ok(false, "ask tab for 'always save normally'");
// L. Activity log explains decisions
const { log: actLog } = await sw.evaluate(() => chrome.storage.local.get("log"));
ok(actLog.some((e) => e.decision.includes("not a document")) && actLog.some((e) => e.decision.includes("always save normally")) &&
   actLog.some((e) => e.decision.startsWith("stopped and asked")), "activity log records why each download was or wasn't intercepted");
await setMode("off", []);

// M. v1.5: welcome tab, suggested password, review prompt, compact window
ok(ctx.pages().some((pg) => pg.url().endsWith("/welcome.html")), "welcome tab opens on install");
{
  const w = ctx.pages().find((pg) => pg.url().endsWith("/welcome.html"));
  if (w) { await w.reload(); ok(await w.$$eval('input[name="mode"]', (r) => r.length === 3), "welcome page shows the three modes"); }
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/prompt.html?` + new URLSearchParams({ url: base + "/protected.pdf", tabId }));
  await p.click("#suggest");
  const [a, b, str, shown] = await p.evaluate(() => [pw.value, pw2.value, document.querySelector("#meter, .meter")?.textContent || document.body.innerText, !suggestBox.hidden]);
  ok(a && a === b && /^[a-z]+(-[a-z]+){3}-\d\d$/.test(a) && shown, "suggest fills both fields with a 4-word passphrase: " + a);
  await sw.evaluate(() => chrome.storage.local.set({ lockCount: 4, reviewAsked: false }));
  await p.click("#pw2"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => ["ok","error"].includes(document.getElementById("status").dataset.state), null, { timeout: 30000 });
  ok(await p.$eval("#rate", (e) => !e.hidden), "review prompt appears after the 5th lock");
  const st = await sw.evaluate(() => chrome.storage.local.get(["lockCount", "reviewAsked"]));
  ok(st.reviewAsked === true, "review prompt is only shown once");
  if (!p.isClosed()) await p.close();
}

await ctx.close();

// 7. Real manifest (no blanket access): extension asks for this one site, saves nothing.
{
  const prof2 = fs.mkdtempSync(path.join(os.tmpdir(), "sdl-prof2-"));
  const c2 = await chromium.launchPersistentContext(prof2, {
    executablePath: "/usr/bin/google-chrome", headless: false,
    args: ["--headless=new", `--disable-extensions-except=${realExt}`, `--load-extension=${realExt}`, "--no-sandbox"] });
  let [w2] = c2.serviceWorkers(); if (!w2) w2 = await c2.waitForEvent("serviceworker");
  const id2 = w2.url().split("/")[2];
  await realDownloads(c2);
  const perms = await w2.evaluate(() => chrome.runtime.getManifest());
  ok(!perms.host_permissions && perms.optional_host_permissions?.[0] === "<all_urls>",
    "shipped manifest requests no site access up front (optional only)");
  const p = await c2.newPage();
  const dls = [];
  await p.goto(`chrome-extension://${id2}/prompt.html?` + new URLSearchParams({ url: base + "/protected.pdf", tabId: "" }));
  await p.click("#pw"); await p.keyboard.type("hunter22"); await p.fill("#pw2", "hunter22"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => !document.getElementById("access").hidden || ["ok","error"].includes(document.getElementById("status").dataset.state), null, { timeout: 15000 });
  const shown = await p.$eval("#access", (e) => !e.hidden);
  const host = await p.$eval("#accessHost", (e) => e.textContent);
  ok(shown && host === new URL(base).host && dls.length === 0, `without access: asks to allow "${host}", nothing saved`);

  // Bug repro: choosing a detection mode in the popup must be saved even though Chrome's access
  // dialog is still open (on macOS that dialog closes the popup).
  const pop = await c2.newPage(); await pop.goto(`chrome-extension://${id2}/popup.html`);
  const optP = c2.waitForEvent("page", { predicate: (pg) => pg.url().includes("options.html"), timeout: 8000 }).catch(() => null);
  await pop.click('input[name="mode"][value="ask-all"]');
  await new Promise((r) => setTimeout(r, 1500));
  const stored = await w2.evaluate(() => chrome.storage.local.get("mode"));
  ok(stored.mode === "ask-all", "popup: detection setting is saved immediately (before any access dialog)");
  const opt = await optP;
  ok(!!opt && (await opt.$eval("#grant", (e) => !e.hidden)), "popup: opens Settings with a 'Give SecureDL access' button");
  ok(await w2.evaluate(() => chrome.action.getBadgeText({})) === "!", "toolbar icon shows '!' while access is missing");
  ok(await pop.$eval("#needAccess", (e) => !e.hidden), "popup explains that detection isn't working yet");
  // A download in this state is logged as not intercepted, instead of silently ignored.
  const s2 = await c2.newPage(); await s2.goto(base + "/downloads"); await s2.click("#tiny");
  await new Promise((r) => setTimeout(r, 1500));
  const { log: log2 } = await w2.evaluate(() => chrome.storage.local.get("log"));
  ok(log2?.[0]?.decision.includes("NOT intercepted"), "download without access is logged: " + log2?.[0]?.decision);
  await c2.close();
} server.close();
console.log("\nserver saw:\n  " + log.join("\n  "));
console.log(fails ? `\n${fails} FAILED` : "\nALL E2E PASSED"); process.exit(fails ? 1 : 0);
