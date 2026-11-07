// Generates Chrome Web Store images from the real extension UI.
// Output: store/screenshot-1.png, screenshot-2.png (1280x800), promo-small.png (440x280)
import fs from "fs"; import os from "os"; import path from "path";
import { chromium } from "playwright-core";

const out = path.resolve("store"); fs.mkdirSync(out, { recursive: true });
const ext = path.resolve("ext");
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "sdl-shot-")), {
  executablePath: "/usr/bin/google-chrome", headless: false, deviceScaleFactor: 2,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];

// Real UI captures
const p = await ctx.newPage(); await p.setViewportSize({ width: 560, height: 380 });
await p.goto(`chrome-extension://${id}/prompt.html?` + new URLSearchParams({ url: "https://mybank.example/statements/2026-10.pdf",
  ask: "1", dlId: "999999", name: "Statement-2026-10.pdf", site: "mybank.example" }));
await p.fill("#pw", "correct horse battery"); await p.fill("#pw2", "correct horse battery");
await p.evaluate(() => { document.getElementById("src").hidden = true; document.querySelector(".foot").hidden = true; });
await p.evaluate(() => (document.body.style.margin = "10px auto"));
const prompt = (await p.screenshot()).toString("base64");
const q = await ctx.newPage(); await q.setViewportSize({ width: 340, height: 420 });
await q.goto(`chrome-extension://${id}/popup.html`);
const popup = (await q.screenshot()).toString("base64");
const icon = fs.readFileSync("assets/icon-512.png").toString("base64");

const frame = (inner) => `<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;
  font-family:-apple-system,system-ui,'Segoe UI',sans-serif;background:linear-gradient(135deg,#0b3d91,#1a73e8);color:#fff">${inner}</body></html>`;
// Frames render at exactly the store sizes (1x); the embedded UI captures above are 2x for sharpness.
const plain = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--headless=new", "--no-sandbox"] });
const shot = async (html, file, w = 1280, h = 800) => {
  const s = await plain.newPage({ deviceScaleFactor: 1 }); await s.setViewportSize({ width: w, height: h });
  await s.setContent(html); await s.screenshot({ path: path.join(out, file) }); await s.close();
};
const card = (b64, w) => `<img src="data:image/png;base64,${b64}" style="width:${w}px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.35)">`;

await shot(frame(`
  <div style="display:flex;align-items:center;gap:60px;padding:0 80px;height:100%">
    <div style="flex:0 0 520px">
      <img src="data:image/png;base64,${icon}" style="width:84px">
      <h1 style="font-size:48px;line-height:1.12;margin:24px 0 18px;white-space:nowrap">Downloads that arrive<br>already locked.</h1>
      <p style="font-size:21px;opacity:.92;line-height:1.55;white-space:nowrap">Stops sensitive downloads before they’re saved<br>and asks to <b>lock them with a password</b>.<br>
      Or right-click any link → <b>Download with password</b>.</p>
    </div>${card(prompt, 600)}</div>`), "screenshot-1.png");

await shot(frame(`
  <div style="padding:0 80px;height:100%;display:flex;flex-direction:column;justify-content:center">
    <h1 style="font-size:48px;margin:0 0 40px">Opens with a double-click. Nothing to install.</h1>
    <div style="display:flex;gap:36px">
      ${[["📄", "PDFs", "Saved as an AES-256 password-protected PDF. Preview, Acrobat and Chrome ask for the password."],
         ["🗂️", "Everything else", "Saved as a self-unlocking .html file (AES-256-GCM). Opens in any browser on Mac, Windows or phone."],
         ["🛡️", "Checked before saving", "Every file is test-opened with your password first. Fake documents and login pages are refused. 100% local, open source."]]
        .map(([e, t, d]) => `<div style="flex:1;background:rgba(255,255,255,.12);border-radius:20px;padding:36px">
          <div style="font-size:56px">${e}</div><h2 style="font-size:30px;margin:18px 0 12px">${t}</h2>
          <p style="font-size:21px;line-height:1.45;opacity:.92;margin:0">${d}</p></div>`).join("")}
    </div>
    <p style="font-size:20px;opacity:.85;margin-top:44px">Also: lock files already on disk, from the toolbar button.</p>
  </div>`), "screenshot-2.png");

await shot(frame(`<div style="display:flex;align-items:center;gap:22px;padding:0 34px;height:280px">
  <img src="data:image/png;base64,${icon}" style="width:110px">
  <div><div style="font-size:38px;font-weight:700">SecureDL</div>
  <div style="font-size:19px;opacity:.92;line-height:1.35;margin-top:6px">Password-protected<br>downloads. 100% local.</div></div></div>`),
  "promo-small.png", 440, 280);
fs.writeFileSync(path.join(out, "popup.png"), Buffer.from(popup, "base64"));
await ctx.close(); await plain.close(); console.log(fs.readdirSync(out));
