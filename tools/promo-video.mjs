// Builds the frames for the promo video from the real extension UI (see DESIGN.md).
// Output: /tmp/promo/frames/<scene>/<n>.jpg and /tmp/promo/plan.json (scene -> frames + durations).
// Then: bash tools/promo-video.sh  -> store/promo-video.mp4
import fs from "fs"; import os from "os"; import path from "path";
import { chromium } from "playwright-core";

const OUT = "/tmp/promo"; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + "/frames", { recursive: true });
const only = process.argv[2];                       // optional: render just one scene's frames for review
const ext = path.resolve("ext");
const b64 = (buf) => buf.toString("base64");
const font = (w) => `@font-face{font-family:Plex;font-weight:${w};src:url(data:font/woff2;base64,${b64(fs.readFileSync(`ext/fonts/ibm-plex-sans-latin-${w}-normal.woff2`))})}`;
const icon = b64(fs.readFileSync("assets/icon-512.png"));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "promo-")), {
  executablePath: "/usr/bin/google-chrome", headless: false, deviceScaleFactor: 2, colorScheme: "light",
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const stage = await (await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--headless=new", "--no-sandbox"] })).newPage({ deviceScaleFactor: 1 });
await stage.setViewportSize({ width: 1920, height: 1080 });

// ---------- one 1920x1080 frame: caption on the left, a browser window with the real UI on the right ----------
const CSS = `${font(400)}${font(500)}${font(600)}
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:Plex,sans-serif;background:#F3F5F8;color:#142033;position:relative}
  .band{position:absolute;inset:0 auto 0 0;width:40px;background:repeating-linear-gradient(-45deg,#C3CEDF 0 2.5px,transparent 2.5px 9px)}
  .row{position:absolute;inset:0;display:flex;align-items:center;gap:96px;padding:0 120px 0 168px}
  .cap{flex:0 0 640px} .cap h1{font-size:64px;line-height:74px;font-weight:600;letter-spacing:-.02em;margin:0}
  .cap p{font-size:30px;line-height:44px;color:#5A6577;margin:28px 0 0}
  .step{display:flex;gap:10px;margin-bottom:28px}.step i{width:44px;height:6px;border-radius:3px;background:#DCE2EA}.step i.on{background:#2242C7}
  .win{flex:1;border-radius:18px;background:#fff;border:1px solid #DCE2EA;overflow:hidden}
  .bar{height:56px;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid #DCE2EA;background:#F7F8FA}
  .bar b{width:13px;height:13px;border-radius:50%;background:#DCE2EA}.bar span{margin-left:18px;flex:1;height:32px;border-radius:8px;background:#fff;border:1px solid #E3E7EE;
    font-size:17px;line-height:30px;padding:0 14px;color:#5A6577}
  .win img{display:block;width:100%}`;
const steps = (n) => `<div class="step">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;
async function frame(file, { title, sub, ui, url, step }) {
  await stage.setContent(`<html><head><style>${CSS}</style></head><body><div class="band"></div><div class="row">
    <div class="cap">${step ? steps(step) : ""}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
    <div class="win"><div class="bar"><b></b><b></b><b></b><span>${url}</span></div><img src="data:image/jpeg;base64,${ui}"></div></div></body></html>`);
  await stage.waitForTimeout(60);
  await stage.screenshot({ path: file, type: "jpeg", quality: 92 });
}
async function card(file, html) {
  await stage.setContent(`<html><head><style>${CSS}
    .card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 0 0 168px}
    .card img{width:120px} .card h1{font-size:88px;line-height:98px;font-weight:600;letter-spacing:-.025em;margin:44px 0 0}
    .card p{font-size:34px;line-height:50px;color:#5A6577;margin:28px 0 0}</style></head>
    <body><div class="band"></div><div class="card">${html}</div></body></html>`);
  await stage.waitForTimeout(60);
  await stage.screenshot({ path: file, type: "jpeg", quality: 92 });
}

// ---------- real UI captures ----------
const W = 600, H = 600;
const page = await ctx.newPage(); await page.setViewportSize({ width: W, height: H });
const shotUI = async (p = page) => b64(await p.screenshot({ type: "jpeg", quality: 92 }));
const askUrl = `chrome-extension://${id}/prompt.html?` + new URLSearchParams({ url: "https://mybank.example/statements/2026-10.pdf",
  ask: "1", name: "Statement-2026-10.pdf", site: "mybank.example" });
const tidy = (p) => p.evaluate(() => { document.documentElement.style.overflow = "hidden"; document.querySelector(".brand").hidden = true; document.querySelector(".foot").hidden = true;
  document.querySelector(".page").style.margin = "32px auto 8px"; document.activeElement?.blur(); });

const plan = [];
const scene = (name) => { const s = { name, frames: [] }; plan.push(s); fs.mkdirSync(`${OUT}/frames/${name}`, { recursive: true }); return s; };
const add = async (s, dur, fn) => { const f = `${OUT}/frames/${s.name}/${String(s.frames.length).padStart(3, "0")}.jpg`; await fn(f); s.frames.push({ f, dur }); };
const want = (n) => !only || only === n;

// 1. title
if (want("title")) { const s = scene("title");
  await add(s, 3.2, (f) => card(f, `<img src="data:image/png;base64,${icon}"><h1>Sensitive downloads,<br>saved locked.</h1><p>SecureDL for Chrome</p>`)); }

// 2. the bank page and its download button (a made-up bank on an example domain)
if (want("bank")) { const s = scene("bank");
  const bank = await ctx.newPage(); await bank.setViewportSize({ width: W, height: H });
  await bank.setContent(`<html><body style="margin:0;font:16px -apple-system,system-ui,sans-serif;color:#1d2a3a;background:#fff">
    <div style="background:#0e3b43;color:#fff;padding:18px 28px;font-weight:600;font-size:18px">Example Bank</div>
    <div style="padding:28px"><div style="font-size:24px;font-weight:600;margin-bottom:6px">Statements</div>
    <div style="color:#667;margin-bottom:22px">Checking account ending 4821</div>
    ${["October 2026", "September 2026", "August 2026"].map((m, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-top:1px solid #e5e8ec">
      <span>${m} statement</span><span id="b${i}" style="padding:9px 16px;border:1px solid #0e3b43;border-radius:6px;color:#0e3b43;font-weight:600">Download PDF</span></div>`).join("")}
    </div></body></html>`);
  await add(s, 1.6, async (f) => frame(f, { step: 1, title: "You download a bank statement.", sub: "Usually it lands in Downloads with no password, and stays there.", ui: await shotUI(bank), url: "mybank.example/statements" }));
  await bank.evaluate(() => { const b = document.getElementById("b0"); b.style.background = "#0e3b43"; b.style.color = "#fff"; });
  await add(s, 1.6, async (f) => frame(f, { step: 1, title: "You download a bank statement.", sub: "Usually it lands in Downloads with no password, and stays there.", ui: await shotUI(bank), url: "mybank.example/statements" }));
  await bank.close(); }

// 3. stopped
await page.goto(askUrl); await page.waitForTimeout(300); await tidy(page);
const askFrame = async (s, dur, title, sub, step) => add(s, dur, async (f) => frame(f, { step, title, sub, ui: await shotUI(), url: "SecureDL" }));
if (want("stopped")) { const s = scene("stopped");
  await askFrame(s, 3.4, "SecureDL stops it before it's saved.", "Nothing reaches your disk while you decide.", 2); }

// 4. typing a password (real fields, real strength meter)
if (want("typing")) { const s = scene("typing"); const pw = "correct horse battery";
  for (let i = 1; i <= pw.length; i += 2) {
    await page.fill("#pw", pw.slice(0, i)); await page.dispatchEvent("#pw", "input"); await page.evaluate(() => document.activeElement?.blur());
    await askFrame(s, 0.15, "Choose a password.", "The strength meter and match check update as you type.", 3);
  }
  await page.fill("#pw", pw); await page.dispatchEvent("#pw", "input");
  for (let i = 3; i <= pw.length; i += 3) {
    await page.fill("#pw2", pw.slice(0, i)); await page.dispatchEvent("#pw2", "input"); await page.evaluate(() => document.activeElement?.blur());
    await askFrame(s, 0.12, "Choose a password.", "The strength meter and match check update as you type.", 3);
  }
  await page.fill("#pw2", pw); await page.dispatchEvent("#pw2", "input"); await page.evaluate(() => document.activeElement?.blur());
  await askFrame(s, 2.0, "Choose a password.", "The strength meter and match check update as you type.", 3); }
else { await page.fill("#pw", "correct horse battery"); await page.fill("#pw2", "correct horse battery"); await page.dispatchEvent("#pw2", "input"); }

// 5. locked: busy -> the envelope seals (the real 280 ms animation, sampled)
if (want("locked")) { const s = scene("locked"); const T = "Only the locked copy is saved.", S = "Every file is test-opened with your password before it's saved.";
  await page.evaluate(() => { document.getElementById("neverRow").hidden = true; busy(true, "Locking…"); setStatus("busy", "Encrypting and test-opening the locked file…"); });
  await askFrame(s, 0.8, T, S, 4);
  await page.evaluate(() => { document.querySelector(".label").style.setProperty("--x", "0"); savedId = 1; succeed("Statement-2026-10 (locked).pdf"); document.activeElement?.blur(); });
  for (const t of [60, 140, 220, 320]) { await page.waitForTimeout(t === 60 ? 60 : 80); await askFrame(s, 0.08, T, S, 4); }
  await page.waitForTimeout(400); await askFrame(s, 2.6, T, S, 4); }

// 6. opening a locked file (the self-unlocking page for non-PDF files)
if (want("opens")) { const s = scene("opens"); const T = "Opens with a double&#8209;click.", S = "PDFs open in Preview with your password. Other files unlock in any browser. Nothing to install.";
  const vf = fs.readdirSync("samples").find((f) => f.endsWith(".html"));
  const v = await ctx.newPage(); await v.setViewportSize({ width: W, height: H });
  await v.goto("file://" + path.resolve("samples", vf)); await v.evaluate(() => { document.querySelector("main").style.margin = "40px auto 8px"; document.documentElement.style.overflow = "hidden"; });
  await add(s, 1.3, async (f) => frame(f, { step: 5, title: T, sub: S, ui: await shotUI(v), url: "sample-note.txt.locked.html" }));
  await v.fill("#p", "test1234"); await v.evaluate(() => document.activeElement.blur());
  await add(s, 0.7, async (f) => frame(f, { step: 5, title: T, sub: S, ui: await shotUI(v), url: "sample-note.txt.locked.html" }));
  await v.click("#b"); await v.waitForFunction(() => document.getElementById("m").dataset.state === "ok"); await v.evaluate(() => document.activeElement.blur());
  await add(s, 2.6, async (f) => frame(f, { step: 5, title: T, sub: S, ui: await shotUI(v), url: "sample-note.txt.locked.html" })); }

// 7. end card
if (want("end")) { const s = scene("end");
  await add(s, 4.2, (f) => card(f, `<img src="data:image/png;base64,${icon}"><h1>SecureDL</h1><p>Free and open source. Everything stays on your computer.<br>github.com/ranvijayj/secure-browser-download</p>`)); }

fs.writeFileSync(`${OUT}/plan.json`, JSON.stringify(plan, null, 1));
console.log(plan.map((s) => `${s.name}: ${s.frames.length} frames, ${s.frames.reduce((a, f) => a + f.dur, 0).toFixed(2)}s`).join("\n"));
await ctx.close(); process.exit(0);
