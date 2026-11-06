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

const site = await ctx.newPage(); await site.goto(base + "/page");
const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, base + "/page");

async function attempt(file, password, { withTab = true } = {}) {
  const p = await ctx.newPage();
  const downloads = [];
  p.on("download", (d) => downloads.push(d));
  await p.goto(`chrome-extension://${extId}/prompt.html?` +
    new URLSearchParams({ url: base + file, tabId: withTab ? tabId : "" }));
  // Record the filename the extension asks Chrome to save (Playwright renames the actual files).
  await p.evaluate(() => { const orig = chrome.downloads.download.bind(chrome.downloads);
    window.__asked = []; chrome.downloads.download = (o) => { window.__asked.push(o.filename); return orig(o); }; });
  await p.click("#pw");
  await p.keyboard.type(password, { delay: 20 });           // real keystrokes
  const typed = await p.$eval("#pw", (e) => e.value);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => /✅|❌/.test(document.getElementById("status").textContent), null, { timeout: 30000 });
  const status = await p.$eval("#status", (e) => e.textContent);
  const asked = await p.evaluate(() => window.__asked);
  const fallbackShown = await p.$eval("#fallback", (e) => !e.hidden).catch(() => false);
  await new Promise((r) => setTimeout(r, 800));
  const newFiles = [];
  for (const d of downloads) { const tmp = path.join(dlDir, String(Math.random())); await d.saveAs(tmp); newFiles.push(asked[newFiles.length] ?? "?"); fs.renameSync(tmp, path.join(dlDir, newFiles.at(-1))); }
  if (!p.isClosed()) await p.close();
  return { typed, status, fallbackShown, newFiles };
}

// 1. Typing works (the original bug)
const r1 = await attempt("/protected.pdf", "hunter22");
ok(r1.typed === "hunter22", "real keyboard typing reaches the password box");

// 2. Cloudflare-style protected PDF succeeds via the page context
ok(r1.status.includes("✅"), "bot-protected PDF downloaded via page context: " + r1.status.trim());
ok(r1.newFiles.length === 1 && r1.newFiles[0].endsWith("(locked).pdf"), "saved locked PDF: " + r1.newFiles);
if (r1.newFiles[0]) {
  const f = path.join(dlDir, r1.newFiles[0]);
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
if (r4.newFiles[0]) {
  const v = await ctx.newPage();
  await v.goto("file://" + path.join(dlDir, r4.newFiles[0]));
  await v.click("#p"); await v.keyboard.type("wrong-pw"); await v.keyboard.press("Enter");
  await v.waitForFunction(() => document.getElementById("m").textContent.includes("❌"));
  ok(true, "vault rejects wrong password in Chrome");
  await v.fill("#p", ""); await v.click("#p"); await v.keyboard.type("hunter22", { delay: 20 });
  const [dl] = await Promise.all([v.waitForEvent("download", { timeout: 20000 }).catch(() => null), v.keyboard.press("Enter")]);
  await v.waitForFunction(() => document.getElementById("m").textContent.includes("✅"));
  const bytes = dl ? fs.readFileSync(await dl.path()) : null;
  ok(dl && dl.suggestedFilename() === "photo.jpg" && bytes.equals(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])),
    "vault unlocks in Chrome (typed password) and restores exact photo.jpg");
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
  const perms = await w2.evaluate(() => chrome.runtime.getManifest());
  ok(!perms.host_permissions && perms.optional_host_permissions?.[0] === "<all_urls>",
    "shipped manifest requests no site access up front (optional only)");
  const p = await c2.newPage();
  const dls = []; p.on("download", (d) => dls.push(d));
  await p.goto(`chrome-extension://${id2}/prompt.html?` + new URLSearchParams({ url: base + "/protected.pdf", tabId: "" }));
  await p.click("#pw"); await p.keyboard.type("hunter22"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => !document.getElementById("access").hidden || /❌|✅/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
  const shown = await p.$eval("#access", (e) => !e.hidden);
  const host = await p.$eval("#accessHost", (e) => e.textContent);
  ok(shown && host === new URL(base).host && dls.length === 0, `without access: asks to allow "${host}", nothing saved`);
  await c2.close();
} server.close();
console.log("\nserver saw:\n  " + log.join("\n  "));
console.log(fails ? `\n${fails} FAILED` : "\nALL E2E PASSED"); process.exit(fails ? 1 : 0);
