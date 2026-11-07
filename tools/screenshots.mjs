// Generates Chrome Web Store images from the real extension UI (see DESIGN.md).
// Output: store/screenshot-1.png, screenshot-2.png (1280x800), promo-small.png (440x280)
import fs from "fs"; import os from "os"; import path from "path";
import { chromium } from "playwright-core";

const out = path.resolve("store"); fs.mkdirSync(out, { recursive: true });
const ext = path.resolve("ext");
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "sdl-shot-")), {
  executablePath: "/usr/bin/google-chrome", headless: false, deviceScaleFactor: 2, colorScheme: "light",
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const b64 = (buf) => buf.toString("base64");

// ---- real UI captures ----
async function capture(url, w, h, prep) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: h });
  await p.goto(url); await p.waitForTimeout(300); if (prep) await prep(p); await p.waitForTimeout(500);
  const img = await p.screenshot(); await p.close(); return b64(img);
}
const askUrl = `chrome-extension://${id}/prompt.html?` + new URLSearchParams({ url: "https://mybank.example/statements/2026-10.pdf",
  ask: "1", name: "Statement-2026-10.pdf", site: "mybank.example" });
const hideChrome = (p) => p.evaluate(() => { document.querySelector(".brand").hidden = true; document.querySelector(".foot").hidden = true;
  document.querySelector(".page").style.margin = "28px auto 8px"; });
const ask = await capture(askUrl, 520, 600, async (p) => {
  await hideChrome(p);
  for (const s of ["#pw", "#pw2"]) { await p.fill(s, "correct horse battery"); await p.dispatchEvent(s, "input"); }
});
const sealed = await capture(askUrl, 520, 420, async (p) => { await hideChrome(p); await p.evaluate(() => { savedId = 1; succeed("Statement-2026-10 (locked).pdf"); document.activeElement.blur(); }); });
const vaultFile = fs.readdirSync("samples").find((f) => f.endsWith(".html"));
const vault = await capture("file://" + path.resolve("samples", vaultFile), 520, 420, async (p) => {
  await p.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.querySelector("main").style.margin = "28px auto 8px";
    document.querySelector("small").style.display = "none"; });
  await p.fill("#p", "correct horse"); await p.evaluate(() => document.activeElement.blur()); });
const icon = b64(fs.readFileSync("assets/icon-512.png"));
const font = (w) => `@font-face{font-family:Plex;font-weight:${w};src:url(data:font/woff2;base64,${b64(fs.readFileSync(`ext/fonts/ibm-plex-sans-latin-${w}-normal.woff2`))})}`;

// ---- frames: canvas + security-envelope band, ink type (no gradients) ----
const frame = (inner) => `<!doctype html><html><head><style>${font(400)}${font(600)}
  body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:Plex,sans-serif;background:#F3F5F8;color:#142033;position:relative}
  .band{position:absolute;inset:0 auto 0 0;width:28px;background:repeating-linear-gradient(-45deg,#C3CEDF 0 2px,transparent 2px 7px)}
  h1{font-weight:600;letter-spacing:-.02em;margin:0} p{color:#5A6577;margin:0}
  .shot{border-radius:14px;border:1px solid #DCE2EA;background:#fff;display:block}
</style></head><body><div class="band"></div>${inner}</body></html>`;
const plain = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--headless=new", "--no-sandbox"] });
const shot = async (html, file, w = 1280, h = 800) => {
  const s = await plain.newPage({ deviceScaleFactor: 1 }); await s.setViewportSize({ width: w, height: h });
  await s.setContent(html); await s.waitForTimeout(300); await s.screenshot({ path: path.join(out, file) }); await s.close();
};

await shot(frame(`
  <div style="display:flex;align-items:center;gap:64px;padding:0 72px 0 104px;height:100%">
    <div style="flex:0 0 470px">
      <img src="data:image/png;base64,${icon}" style="width:64px">
      <h1 style="font-size:46px;line-height:54px;margin:28px 0 20px;white-space:nowrap">Sensitive downloads,<br>saved locked.</h1>
      <p style="font-size:21px;line-height:32px">SecureDL stops a bank statement or tax form before it's saved and asks for a password. Only the locked copy reaches your disk.</p>
    </div>
    <img class="shot" src="data:image/png;base64,${ask}" style="width:520px">
  </div>`), "screenshot-1.png");

await shot(frame(`
  <div style="padding:88px 72px 0 104px">
    <h1 style="font-size:40px;line-height:48px">Opens with a double-click. Nothing to install.</h1>
    <p style="font-size:20px;line-height:30px;margin-top:12px;max-width:820px">PDFs become standard password-protected PDFs that Preview and Acrobat open. Other files unlock in any browser. Everything stays on your computer.</p>
    <div style="display:flex;gap:40px;margin-top:48px;align-items:flex-start">
      <div><img class="shot" src="data:image/png;base64,${sealed}" style="width:520px"><p style="font-size:17px;margin-top:14px">Every file is test-opened with your password before it's saved.</p></div>
      <div><img class="shot" src="data:image/png;base64,${vault}" style="width:520px"><p style="font-size:17px;margin-top:14px">What a locked non-PDF file looks like when opened.</p></div>
    </div>
  </div>`), "screenshot-2.png");

await shot(frame(`<div style="display:flex;align-items:center;gap:20px;padding:0 24px 0 56px;height:280px">
  <img src="data:image/png;base64,${icon}" style="width:84px">
  <div><h1 style="font-size:32px;line-height:38px">SecureDL</h1>
  <p style="font-size:16px;line-height:23px;margin-top:6px">Password-protected downloads.<br>Nothing leaves your computer.</p></div></div>`),
  "promo-small.png", 440, 280);
await ctx.close(); await plain.close(); console.log(fs.readdirSync(out).filter((f) => f.endsWith(".png")));
