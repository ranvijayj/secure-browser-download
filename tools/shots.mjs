// Screenshot every SecureDL screen in light + dark. Usage: node shots.mjs <outdir>
import { chromium } from "playwright-core"; import fs from "fs"; import os from "os"; import path from "path";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const ext = path.resolve("ext");
for (const scheme of ["light", "dark"]) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "sh-")), {
    executablePath: "/usr/bin/google-chrome", headless: false, colorScheme: scheme, deviceScaleFactor: 1,
    args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  await sw.evaluate(() => chrome.storage.local.set({ mode: "ask-docs", neverAsk: ["intranet.example"], log: [
    { t: Date.now() - 20000, name: "Statement-Oct.pdf", site: "mybank.example", decision: "stopped and asked (nothing saved yet)" },
    { t: Date.now() - 90000, name: "setup.dmg", site: "apps.example", decision: "skipped: not a document or image" },
    { t: Date.now() - 200000, name: "report.pdf", site: "intranet.example", decision: "skipped: you chose “always save normally” for this site" }] }));
  const shot = async (name, url, w, h, prep) => {
    const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: h });
    await p.goto(`chrome-extension://${id}/${url}`); await p.waitForTimeout(300);
    if (prep) await prep(p); await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true }); await p.close();
  };
  const ask = "prompt.html?" + new URLSearchParams({ url: "https://www.examplefile.com/file-download/152", ask: "1", name: "Statement-2026-10.pdf", site: "mybank.example" });
  await shot("ask", ask, 720, 640);
  await shot("ask-filled", ask, 720, 640, async (p) => { await p.fill("#pw", "tangerine-kayak-41"); await p.fill("#pw2", "tangerine-kayak-41"); await p.dispatchEvent("#pw", "input"); await p.dispatchEvent("#pw2", "input"); });
  await shot("rightclick", "prompt.html?" + new URLSearchParams({ url: "https://mybank.example/statements/2026-10.pdf" }), 720, 560);
  await shot("success", ask, 720, 600, async (p) => { await p.evaluate(() => { savedId = 1; succeed("Statement-2026-10 (locked).pdf"); }); await p.waitForTimeout(600); });
  await shot("error", "prompt.html?" + new URLSearchParams({ url: "https://mybank.example/statements/2026-10.pdf" }), 720, 760, async (p) => {
    await p.fill("#pw", "tangerine-kayak-41"); await p.fill("#pw2", "tangerine-kayak-41"); await p.dispatchEvent("#pw", "input"); await p.dispatchEvent("#pw2", "input");
    await p.evaluate(() => { fail("The site showed a bot check (e.g. Cloudflare) instead of the file. Nothing was saved."); document.getElementById("fallback").hidden = false; }); });
  await shot("weak", ask, 720, 760, async (p) => { await p.fill("#pw", "password123"); await p.fill("#pw2", "password123"); await p.dispatchEvent("#pw", "input"); await p.dispatchEvent("#pw2", "input"); await p.click("#go"); });
  await shot("local", "prompt.html?local=1", 720, 600);
  await shot("popup", "popup.html", 340, 560);
  await shot("options", "options.html", 760, 760);
  const vp = await ctx.newPage(); await vp.setViewportSize({ width: 720, height: 600 });
  const vf = fs.readdirSync("samples").find((f) => f.endsWith(".html"));
  await vp.goto("file://" + path.resolve("samples", vf)); await vp.waitForTimeout(200);
  await vp.screenshot({ path: `${out}/vault-${scheme}.png` });
  await vp.fill("#p", "test1234"); await vp.press("#p", "Enter"); await vp.waitForTimeout(2500);
  await vp.screenshot({ path: `${out}/vault-unlocked-${scheme}.png` });
  await ctx.close();
}
